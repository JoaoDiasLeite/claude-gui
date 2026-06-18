import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { priceFor } from './config'
import { getWslClaudeRoots } from './wsl'
import { storeGet, storeSet } from './store'

// ─── Sources (local + WSL distros) ──────────────────────────────────────────

export interface SourceAccount {
  email?: string
  org?: string
  plan?: string
}

export interface ClaudeSource {
  id: string // 'local' | 'wsl:<distro>'
  label: string // 'Local' | distro name
  kind: 'local' | 'wsl'
  distro?: string
  projectsDir: string
  claudeJsonPath: string
  account?: SourceAccount
}

function readAccount(claudeJsonPath: string): SourceAccount | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
    const a = raw.oauthAccount
    if (!a || typeof a !== 'object') return undefined
    const plan =
      a.organizationType === 'claude_team'
        ? 'Team'
        : a.billingType === 'stripe_subscription'
          ? 'Pro'
          : a.billingType
            ? 'Paid'
            : 'Free'
    return { email: a.emailAddress, org: a.organizationName, plan }
  } catch {
    return undefined
  }
}

export function localSource(): ClaudeSource {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json')
  return {
    id: 'local',
    label: 'Local',
    kind: 'local',
    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
    claudeJsonPath,
    account: readAccount(claudeJsonPath)
  }
}

// Cache discovered sources briefly so navigating Usage/Projects doesn't re-probe WSL.
let sourceCache: { at: number; sources: ClaudeSource[] } | null = null

export async function getSources(force = false): Promise<ClaudeSource[]> {
  const now = Date.now()
  if (!force && sourceCache && now - sourceCache.at < 30000) return sourceCache.sources
  const sources: ClaudeSource[] = [localSource()]
  try {
    for (const root of await getWslClaudeRoots()) {
      sources.push({
        id: `wsl:${root.distro}`,
        label: root.distro,
        kind: 'wsl',
        distro: root.distro,
        projectsDir: root.projectsDir,
        claudeJsonPath: root.claudeJsonPath,
        account: readAccount(root.claudeJsonPath)
      })
    }
  } catch {
    // WSL probing failed — local only
  }
  sourceCache = { at: now, sources }
  return sources
}

export async function resolveSource(id: string): Promise<ClaudeSource | null> {
  if (id === 'local') return localSource()
  return (await getSources()).find((s) => s.id === id) ?? null
}

export interface SourceInfo {
  id: string
  label: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}
export async function listSources(): Promise<SourceInfo[]> {
  return (await getSources(true)).map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    distro: s.distro,
    account: s.account
  }))
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CCProject {
  encodedDir: string
  realPath: string
  name: string
  sessionCount: number
  lastActive: number
  sourceId: string
  sourceLabel: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}

export interface CCSessionMeta {
  sessionId: string
  encodedDir: string
  realPath: string
  title: string
  preview: string
  messageCount: number
  model?: string
  createdAt: number
  updatedAt: number
  sourceId: string
  kind: 'local' | 'wsl'
  distro?: string
}

export interface CCTranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  toolCalls: { id: string; tool: string; input: unknown; result?: string; isError?: boolean }[]
  timestamp: number
}

// ─── Path helpers ───────────────────────────────────────────────────────────

function realPathMap(claudeJsonPath: string): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const raw = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
    if (raw.projects && typeof raw.projects === 'object') {
      for (const realPath of Object.keys(raw.projects)) {
        map.set(encodePath(realPath), realPath)
      }
    }
  } catch {
    // ignore
  }
  return map
}

function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function decodeFallback(encoded: string): string {
  let s = encoded.replace(/-/g, '/').replace(/\/{2,}/g, '/')
  s = s.replace(/^([A-Za-z])\//, '$1:/')
  return s
}

function cwdFromSessions(dir: string): string | null {
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  for (const file of files) {
    try {
      const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n')
      for (const line of lines) {
        if (!line.includes('"cwd"')) continue
        try {
          const obj = JSON.parse(line)
          if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd
        } catch {
          /* keep scanning */
        }
      }
    } catch {
      /* next file */
    }
  }
  return null
}

function resolveRealPath(src: ClaudeSource, encodedDir: string, pathMap: Map<string, string>): string {
  return (
    pathMap.get(encodedDir) ??
    cwdFromSessions(path.join(src.projectsDir, encodedDir)) ??
    decodeFallback(encodedDir)
  )
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function parseTimestamp(v: unknown): number {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return 0
}

// ─── Projects / sessions ────────────────────────────────────────────────────

function projectsForSource(src: ClaudeSource): CCProject[] {
  if (!fs.existsSync(src.projectsDir)) return []
  const pathMap = realPathMap(src.claudeJsonPath)
  const result: CCProject[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(src.projectsDir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(src.projectsDir, entry.name)
    let jsonlFiles: string[]
    try {
      jsonlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    if (jsonlFiles.length === 0) continue
    let lastActive = 0
    for (const f of jsonlFiles) {
      const st = safeStat(path.join(dir, f))
      if (st && st.mtimeMs > lastActive) lastActive = st.mtimeMs
    }
    const realPath = resolveRealPath(src, entry.name, pathMap)
    result.push({
      encodedDir: entry.name,
      realPath,
      name: realPath.split(/[\\/]/).filter(Boolean).pop() ?? entry.name,
      sessionCount: jsonlFiles.length,
      lastActive,
      sourceId: src.id,
      sourceLabel: src.label,
      kind: src.kind,
      distro: src.distro,
      account: src.account
    })
  }
  return result
}

export async function getAllProjects(): Promise<CCProject[]> {
  const sources = await getSources()
  const all: CCProject[] = []
  for (const src of sources) all.push(...projectsForSource(src))
  return all.sort((a, b) => b.lastActive - a.lastActive)
}

export async function listSessions(sourceId: string, encodedDir: string): Promise<CCSessionMeta[]> {
  const src = await resolveSource(sourceId)
  if (!src) return []
  const dir = path.join(src.projectsDir, encodedDir)
  if (!fs.existsSync(dir)) return []
  const realPath = resolveRealPath(src, encodedDir, realPathMap(src.claudeJsonPath))

  const sessions: CCSessionMeta[] = []
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '')
    const full = path.join(dir, file)
    const st = safeStat(full)
    let title = ''
    let preview = ''
    let model: string | undefined
    let messageCount = 0
    let createdAt = 0
    let updatedAt = st?.mtimeMs ?? 0
    try {
      for (const line of fs.readFileSync(full, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        let obj: any
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (obj.type === 'ai-title' && obj.aiTitle) title = obj.aiTitle
        if (obj.type === 'assistant' && obj.message) {
          messageCount++
          if (obj.message.model) model = obj.message.model
          const ts = parseTimestamp(obj.timestamp)
          if (ts && !createdAt) createdAt = ts
          if (ts) updatedAt = Math.max(updatedAt, ts)
        }
        if (obj.type === 'user' && obj.message) {
          messageCount++
          if (!preview) {
            const c = obj.message.content
            if (typeof c === 'string') preview = c.slice(0, 120)
            else if (Array.isArray(c)) {
              const tb = c.find((b: any) => b.type === 'text' || typeof b.text === 'string')
              if (tb) preview = String(tb.text ?? '').slice(0, 120)
            }
          }
        }
      }
    } catch {
      /* skip */
    }
    sessions.push({
      sessionId,
      encodedDir,
      realPath,
      title: title || preview || sessionId.slice(0, 8),
      preview,
      messageCount,
      model,
      createdAt: createdAt || (st?.birthtimeMs ?? 0),
      updatedAt,
      sourceId: src.id,
      kind: src.kind,
      distro: src.distro
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export interface SearchHit {
  sessionId: string
  encodedDir: string
  realPath: string
  projectName: string
  title: string
  snippet: string
  updatedAt: number
  model?: string
  sourceId: string
  kind: 'local' | 'wsl'
  distro?: string
  account?: SourceAccount
}

function plainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b.type === 'text' ? b.text ?? '' : b.type === 'thinking' ? b.thinking ?? '' : ''))
      .join(' ')
  }
  return ''
}

/** Full-text search across every session in every source (local + WSL). */
export async function searchSessions(query: string, limit = 100): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const sources = await getSources()
  const hits: SearchHit[] = []

  for (const src of sources) {
    if (!fs.existsSync(src.projectsDir)) continue
    const pathMap = realPathMap(src.claudeJsonPath)
    let dirs: fs.Dirent[]
    try {
      dirs = fs.readdirSync(src.projectsDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue
      const realPath = resolveRealPath(src, entry.name, pathMap)
      const projectName = realPath.split(/[\\/]/).filter(Boolean).pop() ?? entry.name
      const dir = path.join(src.projectsDir, entry.name)
      let files: string[]
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const file of files) {
        const sessionId = file.replace(/\.jsonl$/, '')
        const full = path.join(dir, file)
        const st = safeStat(full)
        let content = ''
        try {
          content = fs.readFileSync(full, 'utf-8')
        } catch {
          continue
        }
        const projectMatch = projectName.toLowerCase().includes(q)
        if (!projectMatch && !content.toLowerCase().includes(q)) continue

        // Extract title + a snippet around the first textual match.
        let title = ''
        let snippet = ''
        let updatedAt = st?.mtimeMs ?? 0
        let model: string | undefined
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          let obj: any
          try {
            obj = JSON.parse(line)
          } catch {
            continue
          }
          if (obj.type === 'ai-title' && obj.aiTitle) title = obj.aiTitle
          if (obj.type === 'assistant' && obj.message?.model) model = obj.message.model
          const ts = parseTimestamp(obj.timestamp)
          if (ts) updatedAt = Math.max(updatedAt, ts)
          if (!snippet && (obj.type === 'assistant' || obj.type === 'user') && obj.message) {
            const txt = plainText(obj.message.content)
            const idx = txt.toLowerCase().indexOf(q)
            if (idx >= 0) snippet = txt.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ').trim()
          }
        }
        hits.push({
          sessionId,
          encodedDir: entry.name,
          realPath,
          projectName,
          title: title || snippet || sessionId.slice(0, 8),
          snippet: snippet || (projectMatch ? `(matches project ${projectName})` : ''),
          updatedAt,
          model,
          sourceId: src.id,
          kind: src.kind,
          distro: src.distro,
          account: src.account
        })
      }
    }
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

function blockText(content: unknown): { text: string; thinking: string; tools: any[] } {
  let text = ''
  let thinking = ''
  const tools: any[] = []
  if (typeof content === 'string') return { text: content, thinking, tools }
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text') text += b.text ?? ''
      else if (b.type === 'thinking') thinking += b.thinking ?? ''
      else if (b.type === 'tool_use') tools.push({ id: b.id, tool: b.name, input: b.input })
    }
  }
  return { text, thinking, tools }
}

export async function readSession(
  sourceId: string,
  encodedDir: string,
  sessionId: string
): Promise<CCTranscriptMessage[]> {
  const src = await resolveSource(sourceId)
  if (!src) return []
  const full = path.join(src.projectsDir, encodedDir, `${sessionId}.jsonl`)
  if (!fs.existsSync(full)) return []
  const messages: CCTranscriptMessage[] = []
  const toolResults = new Map<string, { result: string; isError: boolean }>()

  let lines: string[]
  try {
    lines = fs.readFileSync(full, 'utf-8').split('\n')
  } catch {
    return []
  }

  for (const line of lines) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const b of obj.message.content) {
        if (b.type === 'tool_result') {
          const txt =
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? b.content.map((c: any) => c.text ?? '').join('')
                : ''
          toolResults.set(b.tool_use_id, { result: txt.slice(0, 4000), isError: !!b.is_error })
        }
      }
    }
  }

  for (const line of lines) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if ((obj.type === 'assistant' || obj.type === 'user') && obj.message) {
      const { text, thinking, tools } = blockText(obj.message.content)
      const isToolResultOnly =
        obj.type === 'user' &&
        Array.isArray(obj.message.content) &&
        obj.message.content.every((b: any) => b.type === 'tool_result')
      if (isToolResultOnly) continue
      if (!text && !thinking && tools.length === 0) continue
      messages.push({
        role: obj.type === 'assistant' ? 'assistant' : 'user',
        text,
        thinking: thinking || undefined,
        toolCalls: tools.map((t) => ({ ...t, ...(toolResults.get(t.id) ?? {}) })),
        timestamp: parseTimestamp(obj.timestamp)
      })
    }
  }
  return messages
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export interface UsageEntry {
  day: string // YYYY-MM-DD
  model: string
  project: string
  source: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  costUsd: number
}

export interface UsageWindows {
  hour: { costUsd: number; tokens: number }
  session: { costUsd: number; tokens: number } // rolling 5h
  week: { costUsd: number; tokens: number }
}

export interface UsageReport {
  entries: UsageEntry[]
  windows: UsageWindows
  generatedAt: number
}

const HOUR = 3600_000
const SESSION = 5 * HOUR
const WEEK = 7 * 24 * HOUR

function collectUsage(
  src: ClaudeSource,
  agg: Map<string, UsageEntry>,
  win: UsageWindows,
  now: number,
  seen: Set<string>
): void {
  if (!fs.existsSync(src.projectsDir)) return
  const pathMap = realPathMap(src.claudeJsonPath)
  let dirs: fs.Dirent[]
  try {
    dirs = fs.readdirSync(src.projectsDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    const realPath = resolveRealPath(src, entry.name, pathMap)
    const projectName = realPath.split(/[\\/]/).filter(Boolean).pop() ?? entry.name
    const dir = path.join(src.projectsDir, entry.name)
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      let lines: string[]
      try {
        lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n')
      } catch {
        continue
      }
      for (const line of lines) {
        if (!line.includes('"usage"')) continue
        let obj: any
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (obj.type !== 'assistant' || !obj.message?.usage) continue
        // Resume re-logs the same assistant message 2–3× (same message.id / requestId,
        // different uuid). Count each real API response once or usage inflates ~2.3×.
        const dedupKey = obj.message?.id ?? obj.requestId ?? obj.uuid
        if (dedupKey) {
          if (seen.has(dedupKey)) continue
          seen.add(dedupKey)
        }
        const u = obj.message.usage
        const inTok = u.input_tokens ?? 0
        const outTok = u.output_tokens ?? 0
        const cacheCreate = u.cache_creation_input_tokens ?? 0
        const cacheRead = u.cache_read_input_tokens ?? 0
        const cacheTok = cacheCreate + cacheRead
        const model = obj.message.model ?? 'unknown'
        const p = priceFor(model)
        const cost =
          (inTok * p.inputPrice) / 1e6 +
          (outTok * p.outputPrice) / 1e6 +
          (cacheCreate * p.inputPrice * 1.25) / 1e6 +
          (cacheRead * p.inputPrice * 0.1) / 1e6
        const tokens = inTok + outTok
        const ts = parseTimestamp(obj.timestamp)
        const day = ts ? new Date(ts).toISOString().slice(0, 10) : 'unknown'

        const key = `${src.id}|${day}|${model}|${projectName}`
        const e = agg.get(key)
        if (e) {
          e.inputTokens += inTok
          e.outputTokens += outTok
          e.cacheTokens += cacheTok
          e.costUsd += cost
        } else {
          agg.set(key, {
            day,
            model,
            project: projectName,
            source: src.id,
            inputTokens: inTok,
            outputTokens: outTok,
            cacheTokens: cacheTok,
            costUsd: cost
          })
        }

        // Rolling windows (need message-level timestamps).
        if (ts) {
          const age = now - ts
          if (age <= HOUR) {
            win.hour.costUsd += cost
            win.hour.tokens += tokens
          }
          if (age <= SESSION) {
            win.session.costUsd += cost
            win.session.tokens += tokens
          }
          if (age <= WEEK) {
            win.week.costUsd += cost
            win.week.tokens += tokens
          }
        }
      }
    }
  }
}

const USAGE_CACHE_TTL = 12 * HOUR
// Bump when the usage computation changes so stale cached reports are discarded.
// v2: dedupe re-logged assistant messages (was inflating cost/tokens ~2.3×).
const USAGE_CACHE_VERSION = 2

export async function getUsage(force = false): Promise<UsageReport> {
  const now = Date.now()
  if (!force) {
    const cached = storeGet<{ report: UsageReport; at: number; v?: number } | null>('usageCache', null)
    if (cached && cached.v === USAGE_CACHE_VERSION && now - cached.at < USAGE_CACHE_TTL) return cached.report
  }
  const agg = new Map<string, UsageEntry>()
  const win: UsageWindows = {
    hour: { costUsd: 0, tokens: 0 },
    session: { costUsd: 0, tokens: 0 },
    week: { costUsd: 0, tokens: 0 }
  }
  const seen = new Set<string>()
  for (const src of await getSources()) {
    try {
      collectUsage(src, agg, win, now, seen)
    } catch {
      // skip unreadable source
    }
  }
  const report: UsageReport = { entries: [...agg.values()], windows: win, generatedAt: now }
  storeSet('usageCache', { report, at: now, v: USAGE_CACHE_VERSION })
  return report
}
