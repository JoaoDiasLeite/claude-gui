import { getConfig } from './config'

/**
 * Least-privilege policy for every AI/SDK call in the app.
 *
 * Each call site declares a capability *profile* rather than assembling raw SDK
 * options ad-hoc. The profile decides three cost/safety levers centrally:
 *   1. which settings tiers load (user-tier plugin/skill marketplaces are the
 *      big per-turn context tax — headless work never loads them),
 *   2. which tools are reachable (mutating tools are stripped from context, not
 *      merely gated, so a bypassPermissions run cannot invoke them), and
 *   3. the model ceiling + turn cap (pure-reasoning utility calls must never
 *      burn Opus/Fable budget, and no headless run may loop unbounded).
 *
 * Strict by default: profiles grant the minimum. Callers opt into more via the
 * explicit `routine-full` / `interactive-*` profiles.
 */

export type AiProfile =
  /** User-facing chat. Keeps this project's settings/CLAUDE.md; drops the user tier. */
  | 'interactive-chat'
  /** User-facing chat in light mode: full isolation, no settings tiers. */
  | 'interactive-light'
  /** One-shot utility reasoning (summarize, standup, planner assist, suggestions). */
  | 'headless-reasoning'
  /** Scheduled routine, read-only intent: mutating tools removed from context. */
  | 'routine-readonly'
  /** Scheduled routine, full intent: the explicit opt-in to unrestricted tools. */
  | 'routine-full'
  /** Ask a question over configured MCP servers + read-only file tools. */
  | 'mcp-ask'

export interface ResolvePolicyInput {
  profile: AiProfile
  /**
   * Model the caller/user asked for (payload.model, run.model). Undefined falls
   * back to config.defaultModel. For `headless-reasoning` this is a ceiling, not
   * a guarantee — see clampToSonnet below.
   */
  requestedModel?: string
  /** `mcp-ask` only: MCP server names to expose as `mcp__<name>` tools. */
  mcpServerNames?: string[]
}

export interface ResolvedPolicy {
  model: string
  settingSources: ('user' | 'project' | 'local')[]
  /** Present only when the profile pins an explicit tool allowlist. */
  allowedTools?: string[]
  /** Present only when the profile removes tools from context. */
  disallowedTools?: string[]
  /** Present only when the profile caps agentic turns. */
  maxTurns?: number
}

/** Tools that mutate the filesystem or run commands. Stripped for read-only work. */
export const MUTATING_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'KillShell',
  'KillBash'
]

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

/** Sonnet is the ceiling for utility reasoning — capable, but ~5× cheaper than Opus. */
const SONNET = 'claude-sonnet-4-6'

// Turn caps. Reasoning calls use no tools, so they cannot exceed one assistant
// turn — the cap is belt-and-suspenders. Routines and MCP asks loop over tools,
// so the cap is the real backstop against runaway spend (alongside the timeout).
const REASONING_MAX_TURNS = 2
const ROUTINE_MAX_TURNS = 40
const MCP_ASK_MAX_TURNS = 15

/** Coarse model-family tier for ceiling comparisons. Higher = more expensive. */
function tierOf(model: string): number {
  if (model.startsWith('claude-haiku')) return 1
  if (model.startsWith('claude-sonnet')) return 2
  if (model.startsWith('claude-opus')) return 3
  if (model.startsWith('claude-fable')) return 4
  return 2 // unknown ids treated as Sonnet-equivalent
}

/**
 * Resolve the requested model to a concrete id, clamping down to the Sonnet
 * ceiling. Cheaper requests (e.g. Haiku) pass through untouched; Opus/Fable are
 * demoted to Sonnet.
 */
function clampToSonnet(requested: string | undefined, fallback: string): string {
  const base = requested && requested.trim() ? requested.trim() : fallback
  return tierOf(base) > tierOf(SONNET) ? SONNET : base
}

/** The caller's explicit model, or the configured default. No ceiling applied. */
function requestedOrDefault(requested: string | undefined, fallback: string): string {
  return requested && requested.trim() ? requested.trim() : fallback
}

export function resolvePolicy(input: ResolvePolicyInput): ResolvedPolicy {
  const fallback = getConfig().defaultModel
  const { requestedModel } = input

  switch (input.profile) {
    case 'interactive-chat':
      return {
        model: requestedOrDefault(requestedModel, fallback),
        settingSources: ['project', 'local']
      }

    case 'interactive-light':
      return {
        model: requestedOrDefault(requestedModel, fallback),
        settingSources: []
      }

    case 'headless-reasoning':
      return {
        model: clampToSonnet(requestedModel, fallback),
        settingSources: [],
        allowedTools: [],
        maxTurns: REASONING_MAX_TURNS
      }

    case 'routine-readonly':
      return {
        model: requestedOrDefault(requestedModel, fallback),
        settingSources: ['project'],
        disallowedTools: MUTATING_TOOLS,
        maxTurns: ROUTINE_MAX_TURNS
      }

    case 'routine-full':
      return {
        model: requestedOrDefault(requestedModel, fallback),
        settingSources: ['project'],
        maxTurns: ROUTINE_MAX_TURNS
      }

    case 'mcp-ask':
      return {
        model: clampToSonnet(requestedModel, fallback),
        settingSources: ['project', 'local'],
        allowedTools: [
          ...(input.mcpServerNames ?? []).map((n) => `mcp__${n}`),
          ...READ_ONLY_TOOLS
        ],
        maxTurns: MCP_ASK_MAX_TURNS
      }
  }
}
