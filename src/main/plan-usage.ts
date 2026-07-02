import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { listConfigDirs } from './accounts'

// Real plan usage straight from Anthropic, the way community HUDs (claude-hud,
// claudeline, ccusage-style statuslines) do it: GET api.anthropic.com/api/oauth/usage
// with the Claude Code OAuth token from ~/.claude/.credentials.json. UNDOCUMENTED
// endpoint — it can change without notice, so parsing is deliberately tolerant and
// every failure degrades to a status the UI can explain instead of an exception.

export interface PlanWindow {
  key: string
  label: string
  /** 0–100 (the endpoint reports percentages). */
  utilization: number
  /** ISO 8601 timestamp when this window resets, if reported. */
  resetsAt?: string
}

export interface PlanUsage {
  status: 'ok' | 'no-credentials' | 'unauthorized' | 'rate-limited' | 'error'
  error?: string
  /** True when `windows` is carried over from an older successful fetch. */
  stale?: boolean
  subscriptionType?: string
  rateLimitTier?: string
  fetchedAt: number
  windows: PlanWindow[]
}

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const CACHE_TTL_MS = 5 * 60_000
// Failed lookups retry sooner than the happy path, but never hammer the endpoint —
// it 429s readily.
const ERROR_TTL_MS = 90_000
// How long a previous good result stays worth showing alongside an error.
const STALE_OK_MS = 30 * 60_000

// Known window spellings across endpoint revisions / community reports.
const WINDOW_SHAPES: { key: string; label: string; alts: string[] }[] = [
  { key: 'five_hour', label: 'Session (5h)', alts: ['five_hour', 'current', 'session'] },
  { key: 'seven_day', label: 'Week · all models', alts: ['seven_day', 'weekly'] },
  { key: 'seven_day_opus', label: 'Week · Opus', alts: ['seven_day_opus'] },
  { key: 'seven_day_sonnet', label: 'Week · Sonnet', alts: ['seven_day_sonnet'] }
]

let cache: PlanUsage | null = null
// Last successful fetch, kept so transient failures (429s especially) degrade to
// slightly-old numbers instead of an empty error panel.
let lastGood: PlanUsage | null = null

// On failure, surface the last good windows (if recent) as stale data with the
// failure status attached, so the UI can show bars + a hint instead of nothing.
function failure(partial: Omit<PlanUsage, 'fetchedAt' | 'windows'>): PlanUsage {
  const carryOver = lastGood && Date.now() - lastGood.fetchedAt < STALE_OK_MS
  cache = {
    ...partial,
    fetchedAt: Date.now(),
    windows: carryOver ? lastGood!.windows : [],
    stale: carryOver || undefined,
    subscriptionType: partial.subscriptionType ?? lastGood?.subscriptionType,
    rateLimitTier: partial.rateLimitTier ?? lastGood?.rateLimitTier
  }
  return cache
}

interface OauthCreds {
  accessToken: string
  expiresAt?: number
  subscriptionType?: string
  rateLimitTier?: string
}

function readCredentialsFile(dir: string): OauthCreds | null {
  try {
    const p = path.join(dir, '.credentials.json')
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>
    const o = (raw.claudeAiOauth ?? raw) as Record<string, unknown>
    if (typeof o?.accessToken !== 'string' || !o.accessToken) return null
    return {
      accessToken: o.accessToken,
      expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : undefined,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined
    }
  } catch {
    return null
  }
}

/** Hunt across the machine default + every managed account's config dir for the
 *  freshest token. Chats run under app-managed accounts refresh THEIR credentials,
 *  not ~/.claude's — so only checking the default dir misses valid logins. */
function bestCredentials(): { creds: OauthCreds; expired: boolean } | null {
  const dirs = new Set(listConfigDirs().map((d) => d ?? path.join(os.homedir(), '.claude')))
  const all: OauthCreds[] = []
  for (const d of dirs) {
    const c = readCredentialsFile(d)
    if (c) all.push(c)
  }
  if (all.length === 0) return null
  // 60s skew: a token about to lapse mid-request counts as expired.
  const cutoff = Date.now() + 60_000
  const freshest = (arr: OauthCreds[]) =>
    [...arr].sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0]
  const valid = all.filter((c) => !c.expiresAt || c.expiresAt > cutoff)
  if (valid.length > 0) return { creds: freshest(valid), expired: false }
  return { creds: freshest(all), expired: true }
}

function extractWindows(body: Record<string, unknown>): PlanWindow[] {
  // Some revisions nest the windows under rate_limits; accept both.
  const src = (body.rate_limits && typeof body.rate_limits === 'object'
    ? body.rate_limits
    : body) as Record<string, unknown>
  const windows: PlanWindow[] = []
  for (const shape of WINDOW_SHAPES) {
    for (const alt of shape.alts) {
      const v = src[alt]
      if (!v || typeof v !== 'object') continue
      const rec = v as Record<string, unknown>
      const u = rec.utilization
      if (typeof u !== 'number' || !isFinite(u)) continue
      windows.push({
        key: shape.key,
        label: shape.label,
        utilization: Math.max(0, Math.min(100, u)),
        resetsAt: typeof rec.resets_at === 'string' ? rec.resets_at : undefined
      })
      break
    }
  }
  return windows
}

// When the endpoint said 429 with a Retry-After, don't touch it again before this.
let retryAt = 0

export async function getPlanUsage(force = false): Promise<PlanUsage> {
  if (cache) {
    const age = Date.now() - cache.fetchedAt
    // Backoff wins even over a forced refresh — the endpoint 429s readily (and
    // escalates: repeated bad calls earn multi-minute Retry-After lockouts).
    if (cache.status === 'rate-limited' && Date.now() < retryAt) return cache
    if (cache.status !== 'ok' && age < ERROR_TTL_MS) return cache
    if (cache.status === 'ok' && !force && age < CACHE_TTL_MS) return cache
  }

  const found = bestCredentials()
  if (!found) return failure({ status: 'no-credentials' })
  const { creds, expired } = found
  if (expired) {
    // Never spend a request on a token we can already see is dead — repeated
    // expired-token calls are what trigger the edge-level 429 lockout.
    return failure({
      status: 'unauthorized',
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier
    })
  }

  try {
    const res = await fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-gui'
      }
    })
    if (res.status === 401 || res.status === 403) {
      // Token rejected despite a future expiry — Claude Code rotates it on its next
      // run; nothing to do here. Deliberately NOT refreshing with the refresh token:
      // rotating it out from under Claude Code could invalidate the CLI's session.
      return failure({
        status: 'unauthorized',
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier
      })
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      retryAt =
        Date.now() + Math.min(isFinite(ra) && ra > 0 ? ra * 1000 : ERROR_TTL_MS, 3600_000)
      return failure({ status: 'rate-limited', error: 'HTTP 429' })
    }
    if (!res.ok) {
      return failure({ status: 'error', error: `HTTP ${res.status}` })
    }
    const body = (await res.json()) as Record<string, unknown>
    cache = lastGood = {
      status: 'ok',
      fetchedAt: Date.now(),
      windows: extractWindows(body),
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier
    }
    return cache
  } catch (err) {
    return failure({
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
