// Pure account-scoping helpers, extracted from Sidebar.tsx so they can be unit-tested
// without mounting React. These decide which provider/account a chat belongs to, and
// which chats are visible for the currently-selected provider + account. Keep this file
// side-effect-free (no React, no window.electronAPI) — Sidebar.tsx and App.tsx are the
// only callers that know about state.
import { ModelInfo, ProviderId, Session } from '../types'

// Resolve a model id to the provider that serves it (falls back to 'claude' for unknown
// / legacy model ids that predate the model catalog).
export function provOf(models: ModelInfo[], modelId?: string): ProviderId {
  return models.find((m) => (modelId ?? '').startsWith(m.id))?.provider ?? 'claude'
}

// The app-wide default account per provider, as tracked in App.tsx state. Passed in
// (rather than imported) so this module has no dependency on App's state shape.
export interface AccountDefaults {
  defaultAccountId?: string
  codexDefaultAccountId?: string
  geminiDefaultAccountId?: string
}

// Which account a chat is filed under. Fallbacks mirror how an unbound chat actually
// RUNS (see App.tsx's buildAgentPayload), so a chat is never filed under an account it
// wouldn't run on. A legacy chat with no accountId/codexAccountId/geminiAccountId runs
// on that provider's current default account — Claude, Codex and Gemini all resolve the
// same way now. (Previously Codex fell through to the literal 'default' account instead
// of codexDefaultAccountId, which could file/scope an unbound Codex chat under the wrong
// account once a non-default account became the Codex default — see NEXT_FIXES #2.)
export function acctOf(s: Session, models: ModelInfo[], defaults: AccountDefaults): string {
  const p = provOf(models, s.model)
  return p === 'codex'
    ? (s.codexAccountId ?? defaults.codexDefaultAccountId ?? 'default')
    : p === 'gemini'
      ? (s.geminiAccountId ?? defaults.geminiDefaultAccountId ?? 'default')
      : (s.accountId ?? defaults.defaultAccountId ?? 'default')
}

// The account currently IN EFFECT for `provider`: the active chat's account when
// `provider` is the one currently selected, falling back to that provider's default.
// Opening a chat bound to another account (e.g. from Projects) therefore moves the
// row, its usage badge and the session list onto that account instead of silently
// disagreeing with the chat on screen.
export function idFor(
  provider: ProviderId,
  selectedProvider: ProviderId,
  selectedAccountId: string | undefined,
  fallback?: string
): string {
  return (provider === selectedProvider ? selectedAccountId : undefined) ?? fallback ?? 'default'
}

// Blank "New chat" drafts (no messages yet) stay out of the list — the Sessions section
// only appears once at least one chat has real content. Chats are also scoped to the
// selected provider + account: a chat is permanently bound to the provider/account that
// created it, so switching either swaps the visible history. Older chats without an
// accountId fall under that provider's machine-default account ('default'), same as
// `acctOf` resolves. Everything (across accounts) remains reachable via
// "Explore all chats" → Projects.
export function visibleSessions(
  sessions: Session[],
  models: ModelInfo[],
  selectedProvider: ProviderId,
  currentAccountId: string,
  defaults: AccountDefaults
): Session[] {
  return sessions.filter(
    (s) =>
      s.messages.length > 0 &&
      provOf(models, s.model) === selectedProvider &&
      acctOf(s, models, defaults) === currentAccountId
  )
}
