import type { AiEngine } from './types'
import { claudeEngine } from './claude'

/**
 * Engine registry. B2 wires only Claude; B3/B4 register OpenAI and Gemini here
 * so `getEngine(providerId)` returns the right adapter with no call-site change.
 */
const engines: Record<string, AiEngine> = {
  [claudeEngine.id]: claudeEngine
}

/** The default engine when a call site doesn't specify a provider. */
export const DEFAULT_ENGINE_ID = claudeEngine.id

/** Resolve an engine by id, falling back to the default (Claude) for unknown ids. */
export function getEngine(id: string = DEFAULT_ENGINE_ID): AiEngine {
  return engines[id] ?? claudeEngine
}
