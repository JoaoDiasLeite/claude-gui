import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Anthropic from '@anthropic-ai/sdk'
import { MODELS, ModelInfo } from './config'
import { resolveCodex } from './providers/cli-resolve'
import { readJsonFile } from './json-file'

const execFileAsync = promisify(execFile)

function overridesPath(): string {
  return path.join(app.getPath('userData'), 'models.json')
}

// User-writable override/extension file — `{ "models": [...] }`, same shape as
// the bundled MODELS array. Entries here win over bundled defaults by id, and
// unknown ids are added as new catalog entries.
function loadOverrides(): ModelInfo[] {
  try {
    const p = overridesPath()
    if (!fs.existsSync(p)) return []
    const raw = readJsonFile<{ models?: ModelInfo[] }>(p)
    return Array.isArray(raw.models) ? raw.models : []
  } catch {
    return []
  }
}

// Best-effort: ask the installed Codex CLI for its own model catalog so a
// model it already knows about but we haven't added yet still shows up
// (flagged `discovered: true`) instead of silently missing. Never throws —
// a missing CLI, a parse failure, or a timeout all just skip discovery.
async function discoverCodexModelIds(): Promise<string[]> {
  try {
    const { command, prefixArgs } = resolveCodex()
    const { stdout } = await execFileAsync(command, [...prefixArgs, 'debug', 'models', '--json'], {
      timeout: 4000
    })
    if (!stdout) return []
    const parsed = JSON.parse(stdout)
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.models) ? parsed.models : []
    return list
      .map((m: unknown) => (typeof m === 'string' ? m : (m as { id?: string })?.id))
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

// Best-effort: ask the Anthropic API for its own live model catalog (GET
// /v1/models, via the SDK's `client.models.list()`) so a Claude model that's
// been released but that we haven't added to config.ts yet still shows up
// (flagged `discovered: true`) instead of silently missing — mirrors the
// Codex discovery above. Requires an API key in the environment; without one
// there's no way to call the endpoint, so we skip discovery rather than
// guess at a static id list (pricing for a discovered id is never known, so
// callers must treat it as "pricing not yet catalogued" — see below). Never
// throws — a missing/invalid key, a network failure, or a timeout all just
// skip discovery. A short client-side timeout (matching the 4s used for the
// Codex CLI call) keeps a hung request from stalling catalog build.
async function discoverClaudeModelIds(): Promise<string[]> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return []
    const client = new Anthropic({ apiKey, timeout: 4000, maxRetries: 0 })
    const ids: string[] = []
    for await (const model of client.models.list()) {
      if (model?.id) ids.push(model.id)
    }
    return ids
  } catch {
    return []
  }
}

/**
 * Effective model catalog at launch: bundled defaults from config.ts, overridden
 * or extended by a user-writable models.json under userData, then cross-checked
 * against a best-effort live discovery pass so a model the installed CLI already
 * knows about — but that isn't in our catalog yet — still shows up, flagged.
 */
export async function buildModelsCatalog(): Promise<ModelInfo[]> {
  const byId = new Map<string, ModelInfo>()
  for (const m of MODELS) byId.set(m.id, { ...m })
  for (const m of loadOverrides()) byId.set(m.id, { ...m })

  // Run both discovery calls concurrently — one CLI/API being slow (or
  // hanging up to its own timeout) shouldn't serialize with the other.
  const [codexIds, claudeIds] = await Promise.all([discoverCodexModelIds(), discoverClaudeModelIds()])

  for (const id of codexIds) {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: id,
        inputPrice: 0,
        outputPrice: 0,
        context: '?',
        provider: 'codex',
        discovered: true
      })
    }
  }

  for (const id of claudeIds) {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: id,
        inputPrice: 0,
        outputPrice: 0,
        context: '?',
        provider: 'claude',
        discovered: true
      })
    }
  }

  return [...byId.values()]
}
