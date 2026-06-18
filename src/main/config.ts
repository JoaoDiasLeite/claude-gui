import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface ModelInfo {
  id: string
  label: string
  /** USD per 1M tokens */
  inputPrice: number
  outputPrice: number
  context: string
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', inputPrice: 5, outputPrice: 25, context: '1M' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', inputPrice: 5, outputPrice: 25, context: '1M' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', inputPrice: 5, outputPrice: 25, context: '1M' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', inputPrice: 3, outputPrice: 15, context: '1M' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', inputPrice: 1, outputPrice: 5, context: '200K' },
  { id: 'claude-fable-5', label: 'Fable 5', inputPrice: 10, outputPrice: 50, context: '1M' }
]

export function priceFor(modelId: string): ModelInfo {
  return MODELS.find((m) => modelId.startsWith(m.id)) ?? MODELS[0]
}

export interface UsageLimits {
  hourUsd: number
  sessionUsd: number
  weekUsd: number
}

export interface UiPrefs {
  theme: 'dark' | 'light'
  /** Color palette id (see global.css [data-palette]). 'warm-rust' is the default. */
  palette: string
  density: 'comfortable' | 'compact'
  fontSize: 'sm' | 'md' | 'lg'
  onboarded: boolean
}

interface AppConfig {
  defaultModel: string
  limits: UsageLimits
  ui: UiPrefs
}

const configPath = path.join(app.getPath('userData'), 'config.json')
let config: AppConfig = {
  defaultModel: 'claude-opus-4-8',
  // 0 = no personal budget set (no % bar shown). These are user budgets, NOT Anthropic
  // plan limits, which are metered server-side and not readable locally.
  limits: { hourUsd: 0, sessionUsd: 0, weekUsd: 0 },
  ui: { theme: 'dark', palette: 'warm-rust', density: 'comfortable', fontSize: 'md', onboarded: false }
}

export function loadConfig(): void {
  try {
    if (fs.existsSync(configPath)) {
      const loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      config = {
        ...config,
        ...loaded,
        limits: { ...config.limits, ...(loaded.limits ?? {}) },
        ui: { ...config.ui, ...(loaded.ui ?? {}) }
      }
    }
  } catch {
    // keep defaults
  }
}

function saveConfig(): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function getConfig(): AppConfig {
  return config
}

export function setDefaultModel(modelId: string): void {
  config.defaultModel = modelId
  saveConfig()
}

export function setLimits(limits: Partial<UsageLimits>): UsageLimits {
  config.limits = { ...config.limits, ...limits }
  saveConfig()
  return config.limits
}

export function setUiPrefs(prefs: Partial<UiPrefs>): UiPrefs {
  config.ui = { ...config.ui, ...prefs }
  saveConfig()
  return config.ui
}

// ─── Claude Code's own settings.json (effort, model) ──────────────────────────

const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')

export function getClaudeSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(claudeSettingsPath)) {
      return JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return {}
}
