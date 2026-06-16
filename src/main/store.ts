import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * A tiny JSON-backed key/value store for cached values and persisted user choices
 * (hidden distros, usage cache, …). Kept separate from config.json so volatile cache
 * data doesn't churn the user's settings file.
 */
const storePath = path.join(app.getPath('userData'), 'store.json')

let data: Record<string, unknown> = {}
let loaded = false

function ensureLoaded(): void {
  if (loaded) return
  try {
    if (fs.existsSync(storePath)) data = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
  } catch {
    data = {}
  }
  loaded = true
}

function persist(): void {
  try {
    fs.writeFileSync(storePath, JSON.stringify(data))
  } catch {
    // best-effort
  }
}

export function storeGet<T>(key: string, fallback: T): T {
  ensureLoaded()
  return key in data ? (data[key] as T) : fallback
}

export function storeSet(key: string, value: unknown): void {
  ensureLoaded()
  data[key] = value
  persist()
}

// ─── Hidden distros ───────────────────────────────────────────────────────────

export function getHiddenDistros(): string[] {
  return storeGet<string[]>('hiddenDistros', [])
}

export function setDistroHidden(distro: string, hidden: boolean): string[] {
  const set = new Set(getHiddenDistros())
  if (hidden) set.add(distro)
  else set.delete(distro)
  const next = [...set]
  storeSet('hiddenDistros', next)
  return next
}
