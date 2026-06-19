import { app, Notification } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { query as QueryFn } from '@anthropic-ai/claude-agent-sdk'
import { buildSubprocessEnv } from './auth'
import { getConfig } from './config'
import { accountConfigDir } from './accounts'

// ─── Data model ────────────────────────────────────────────────────────────

export interface ScheduledRunCadence {
  kind: 'interval'
  everyMinutes: number
}

export interface DailyCadence {
  kind: 'daily'
  time: string // "HH:MM"
}

export interface WeeklyCadence {
  kind: 'weekly'
  day: number // 0=Sun..6=Sat
  time: string
}

export type Cadence = ScheduledRunCadence | DailyCadence | WeeklyCadence

export interface ScheduledRun {
  id: string
  name: string
  prompt: string
  model?: string
  projectPath?: string
  accountId?: string
  cadence: Cadence
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastResult?: { ok: boolean; summary: string; costUsd: number; at: number }
  nextRunAt?: number
}

// ─── Persistence ───────────────────────────────────────────────────────────

const schedulerDir = path.join(app.getPath('userData'), 'scheduler')

function ensureDir(): void {
  if (!fs.existsSync(schedulerDir)) fs.mkdirSync(schedulerDir, { recursive: true })
}

function fileFor(id: string): string {
  return path.join(schedulerDir, `${id}.json`)
}

export function listScheduledRuns(): ScheduledRun[] {
  ensureDir()
  try {
    return fs
      .readdirSync(schedulerDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(schedulerDir, f), 'utf-8')) as ScheduledRun)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function upsertScheduledRun(run: ScheduledRun): ScheduledRun {
  ensureDir()
  fs.writeFileSync(fileFor(run.id), JSON.stringify(run, null, 2))
  return run
}

export function deleteScheduledRun(id: string): ScheduledRun[] {
  const p = fileFor(id)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  return listScheduledRuns()
}

export function setScheduledRunEnabled(id: string, enabled: boolean): ScheduledRun[] {
  const p = fileFor(id)
  if (!fs.existsSync(p)) return listScheduledRuns()
  try {
    const run = JSON.parse(fs.readFileSync(p, 'utf-8')) as ScheduledRun
    const updated: ScheduledRun = { ...run, enabled }
    if (enabled) {
      updated.nextRunAt = computeNextRun(updated, Date.now())
    }
    fs.writeFileSync(p, JSON.stringify(updated, null, 2))
  } catch {
    // best-effort
  }
  return listScheduledRuns()
}

// ─── Next-run computation ───────────────────────────────────────────────────

export function computeNextRun(run: ScheduledRun, fromTime: number): number {
  const { cadence } = run
  if (cadence.kind === 'interval') {
    return fromTime + cadence.everyMinutes * 60 * 1000
  }

  // Parse HH:MM into hours and minutes
  const [hStr, mStr] = cadence.time.split(':')
  const targetH = parseInt(hStr, 10)
  const targetM = parseInt(mStr, 10)

  if (cadence.kind === 'daily') {
    const d = new Date(fromTime)
    const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), targetH, targetM, 0, 0)
    // If today's time has already passed, schedule for tomorrow
    if (candidate.getTime() <= fromTime) {
      candidate.setDate(candidate.getDate() + 1)
    }
    return candidate.getTime()
  }

  if (cadence.kind === 'weekly') {
    const d = new Date(fromTime)
    const targetDay = cadence.day // 0=Sun
    let daysAhead = targetDay - d.getDay()
    if (daysAhead < 0) daysAhead += 7
    const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysAhead, targetH, targetM, 0, 0)
    if (candidate.getTime() <= fromTime) {
      candidate.setDate(candidate.getDate() + 7)
    }
    return candidate.getTime()
  }

  // Fallback
  return fromTime + 60 * 60 * 1000
}

// ─── SDK loading (mirrors index.ts pattern) ──────────────────────────────────

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  s: string
) => Promise<unknown>

let queryFn: typeof QueryFn | null = null

async function getQuery(): Promise<typeof QueryFn> {
  if (!queryFn) {
    const mod = (await dynamicImport('@anthropic-ai/claude-agent-sdk')) as {
      query: typeof QueryFn
    }
    queryFn = mod.query
  }
  return queryFn
}

// ─── Headless execution ────────────────────────────────────────────────────

const MAX_SUMMARY = 4000

async function executeHeadless(run: ScheduledRun): Promise<{ ok: boolean; summary: string; costUsd: number }> {
  const query = await getQuery()
  const config = getConfig()

  const model = run.model || config.defaultModel
  const cwd = run.projectPath && fs.existsSync(run.projectPath) ? run.projectPath : os.homedir()

  const env = buildSubprocessEnv()
  const configDir = accountConfigDir(run.accountId)
  if (configDir) {
    env.CLAUDE_CONFIG_DIR = configDir
    delete env.ANTHROPIC_API_KEY
  }

  let summary = ''
  let costUsd = 0
  let ok = true

  try {
    const stream = query({
      prompt: run.prompt,
      options: {
        model,
        cwd,
        env,
        // Non-interactive: bypass all permission prompts
        permissionMode: 'bypassPermissions',
        includePartialMessages: false
      }
    })

    for await (const message of stream) {
      if ((message as any).type === 'assistant') {
        const content = (message as any).message?.content ?? []
        for (const block of content) {
          if (block.type === 'text') {
            summary += block.text
          }
        }
      }
      if ((message as any).type === 'result') {
        const m = message as any
        costUsd = m.total_cost_usd ?? 0
        if (m.subtype !== 'success') {
          ok = false
          if (m.result) summary = m.result
        }
      }
    }
  } catch (err) {
    ok = false
    summary = err instanceof Error ? err.message : String(err)
  }

  // Truncate to reasonable storage length
  if (summary.length > MAX_SUMMARY) {
    summary = summary.slice(0, MAX_SUMMARY) + '…'
  }

  return { ok, summary, costUsd }
}

// ─── Run a single scheduled run now ────────────────────────────────────────

// Guard against overlapping runs of the same routine
const inFlight = new Set<string>()

export async function runScheduledRunNow(id: string): Promise<{ ok: boolean; summary: string; costUsd: number } | null> {
  const p = fileFor(id)
  if (!fs.existsSync(p)) return null

  let run: ScheduledRun
  try {
    run = JSON.parse(fs.readFileSync(p, 'utf-8')) as ScheduledRun
  } catch {
    return null
  }

  if (inFlight.has(id)) return null
  inFlight.add(id)

  let result: { ok: boolean; summary: string; costUsd: number }
  try {
    result = await executeHeadless(run)
  } catch (err) {
    result = { ok: false, summary: err instanceof Error ? err.message : String(err), costUsd: 0 }
  } finally {
    inFlight.delete(id)
  }

  const now = Date.now()
  const updated: ScheduledRun = {
    ...run,
    lastRunAt: now,
    lastResult: { ...result, at: now },
    nextRunAt: run.enabled ? computeNextRun(run, now) : run.nextRunAt
  }
  try {
    fs.writeFileSync(p, JSON.stringify(updated, null, 2))
  } catch {
    // best-effort
  }

  // Desktop notification
  if (Notification.isSupported()) {
    const n = new Notification({
      title: run.name,
      body: result.ok
        ? `Routine completed · $${result.costUsd.toFixed(4)}`
        : `Routine failed: ${result.summary.slice(0, 100)}`,
      silent: false
    })
    n.show()
  }

  return result
}

// ─── Timer loop ────────────────────────────────────────────────────────────

let timerHandle: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  const now = Date.now()
  const runs = listScheduledRuns()
  for (const run of runs) {
    if (!run.enabled) continue
    if (inFlight.has(run.id)) continue
    const due = run.nextRunAt ?? computeNextRun(run, run.lastRunAt ?? run.createdAt)
    if (due <= now) {
      // Fire and forget — errors are recorded inside runScheduledRunNow
      runScheduledRunNow(run.id).catch(() => {
        // swallow — recorded in lastResult
      })
    }
  }
}

export function startScheduler(): void {
  // Recompute nextRunAt for all enabled runs on startup
  const runs = listScheduledRuns()
  for (const run of runs) {
    if (!run.enabled) continue
    if (!run.nextRunAt || run.nextRunAt < Date.now()) {
      const updated: ScheduledRun = {
        ...run,
        nextRunAt: computeNextRun(run, Date.now())
      }
      try {
        fs.writeFileSync(fileFor(run.id), JSON.stringify(updated, null, 2))
      } catch {
        // best-effort
      }
    }
  }

  if (timerHandle) clearInterval(timerHandle)
  // Check every 30 seconds
  timerHandle = setInterval(() => {
    tick().catch(() => {
      // swallow tick errors
    })
  }, 30_000)
}
