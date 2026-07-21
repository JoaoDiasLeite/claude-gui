import type { query as QueryFn } from '@anthropic-ai/claude-agent-sdk'

/**
 * Provider-neutral engine seam.
 *
 * Every AI run in the app is described by an `EngineRequest` and executed by an
 * `AiEngine`. Today the only engine is Claude (wrapping the Agent SDK), but the
 * request shape is deliberately provider-agnostic so OpenAI/Gemini engines can
 * drop in behind the same interface without touching call sites.
 *
 * The request fields intentionally line up 1:1 with the `ResolvedPolicy` returned
 * by ai-policy.ts (model / settingSources / allowedTools / disallowedTools /
 * maxTurns), so a call site can spread a policy straight into a request.
 */

// Derive the exact SDK option/prompt/message types from the SDK's own `query`
// signature, so the seam stays in lockstep with the installed SDK version
// without hand-maintaining a parallel type.
type SdkOptions = NonNullable<Parameters<typeof QueryFn>[0]['options']>
type SdkPrompt = Parameters<typeof QueryFn>[0]['prompt']
type SdkQuery = ReturnType<typeof QueryFn>
/** The message type yielded by a query stream (SDKMessage), extracted structurally. */
export type EngineMessage = SdkQuery extends AsyncIterable<infer M> ? M : never

export interface EngineRequest {
  /** Plain string (fast path) or the structured streaming-input generator for images. */
  prompt: SdkPrompt
  model: string
  cwd: string
  env: Record<string, string | undefined>
  abortController: AbortController
  settingSources: NonNullable<SdkOptions['settingSources']>
  permissionMode: NonNullable<SdkOptions['permissionMode']>
  /** Explicit tool allowlist. Omit to leave tools unrestricted for the profile. */
  allowedTools?: string[]
  /** Tools removed from context entirely (cannot be invoked even under bypass). */
  disallowedTools?: string[]
  /** Agentic-turn cap. Omit for uncapped (interactive chat). */
  maxTurns?: number
  mcpServers?: SdkOptions['mcpServers']
  systemPrompt?: SdkOptions['systemPrompt']
  /** Claude Code session id to resume. */
  resume?: string
  /** Stream partial assistant deltas (interactive chat wants this; headless does not). */
  includePartialMessages?: boolean
  /** Per-tool approval callback (interactive 'ask' mode). */
  canUseTool?: SdkOptions['canUseTool']
}

export interface AiEngine {
  readonly id: string
  /** Execute the request, yielding normalized messages (SDKMessage-shaped). */
  run(req: EngineRequest): AsyncIterable<EngineMessage>
}
