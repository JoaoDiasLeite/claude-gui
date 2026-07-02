import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

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
  status: 'ok' | 'no-credentials' | 'unauthorized' | 'error'
  error?: string
  subscriptionType?: string
  rateLimitTier?: string
  fetchedAt: number
  windows: PlanWindow[]
}

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const CACHE_TTL_MS = 5 * 60_000

// Known window spellings across endpoint revisions / community reports.
const WINDOW_SHAPES: { key: string; label: string; alts: string[] }[] = [
  { key: 'five_hour', label: 'Session (5h)', alts: ['five_hour', 'current', 'session'] },
  { key: 'seven_day', label: 'Week · all models', alts: ['seven_day', 'weekly'] },
  { key: 'seven_day_opus', label: 'Week · Opus', alts: ['seven_day_opus'] },
  { key: 'seven_day_sonnet', label: 'Week · Sonnet', alts: ['seven_day_sonnet'] }
]

let cache: PlanUsage | null = null

interface OauthCreds {
  accessToken: string
  subscriptionType?: string
  rateLimitTier?: string
}

function readCredentials(): OauthCreds | null {
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json')
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>
    const o = (raw.claudeAiOauth ?? raw) as Record<string, unknown>
    if (typeof o?.accessToken !== 'string' || !o.accessToken) return null
    return {
      accessToken: o.accessToken,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined
    }
  } catch {
    return null
  }
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

export async function getPlanUsage(force = false): Promise<PlanUsage> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache

  const creds = readCredentials()
  if (!creds) {
    cache = { status: 'no-credentials', fetchedAt: Date.now(), windows: [] }
    return cache
  }

  try {
    const res = await fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20'
      }
    })
    if (res.status === 401 || res.status === 403) {
      // Token expired — Claude Code rotates it on its next run; nothing to do here.
      // Deliberately NOT refreshing with the refresh token: rotating it out from
      // under Claude Code could invalidate the CLI's session.
      cache = {
        status: 'unauthorized',
        fetchedAt: Date.now(),
        windows: [],
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier
      }
      return cache
    }
    if (!res.ok) {
      cache = { status: 'error', error: `HTTP ${res.status}`, fetchedAt: Date.now(), windows: [] }
      return cache
    }
    const body = (await res.json()) as Record<string, unknown>
    cache = {
      status: 'ok',
      fetchedAt: Date.now(),
      windows: extractWindows(body),
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier
    }
    return cache
  } catch (err) {
    cache = {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: Date.now(),
      windows: []
    }
    return cache
  }
}
