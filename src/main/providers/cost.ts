import { priceFor } from '../config'

/**
 * Codex/Gemini don't report a pre-computed USD cost the way the Claude Agent SDK
 * does (`total_cost_usd`) — only raw token counts. Same formula Claude transcript
 * parsing already uses (see `claude-data.ts`), templated for any provider's model.
 */
export function costFromTokens(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
): number {
  const p = priceFor(modelId)
  return (
    (usage.inputTokens * p.inputPrice) / 1e6 +
    (usage.outputTokens * p.outputPrice) / 1e6 +
    (usage.cacheCreationTokens * p.inputPrice * 1.25) / 1e6 +
    (usage.cacheReadTokens * p.inputPrice * 0.1) / 1e6
  )
}
