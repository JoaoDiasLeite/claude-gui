# Claude GUI — Improvement Backlog

Grounded GUI/UX improvements, ordered by impact. File references point at the
current implementation each item would change.

## High impact

- [x] **Real markdown rendering in messages.** Done: `Markdown.tsx` renders
  assistant messages with `react-markdown` + `remark-gfm` (lists, tables, task
  lists, links) and `rehype-highlight` syntax highlighting (theme-aware token
  colors), with a **copy button on code blocks** and external links opened in the
  browser. User messages stay plain text. Replaced the old regex `formatContent`.
- [x] **Per-chat cost & token visibility.** Done: token counts are plumbed
  through `agent:done` (local + WSL/SSH via `claude-stream.ts`), accumulated per
  session, and shown as a `$cost · Ntok` chip in the chat header with an
  input/output/cache breakdown tooltip.
- [ ] **Retry / regenerate on failure.** On `agent:error` the assistant bubble
  just gets `Error: …` text (`App.tsx` ~line 222). Add a "Retry" affordance on a
  failed turn.
- [x] **Reconcile the sidebar status chip with multi-account.** Done: the chip
  now shows the active chat's account name + email/plan (or "not logged in"),
  with the dot/ready state derived per-account (the default account also counts
  as ready when the global connection is, e.g. an API key).

## Medium impact

- [ ] **Session list badges.** Sidebar session rows (`Sidebar.tsx` ~line 123)
  show name + project + date but no **model or account** badge — hard to tell
  chats apart with multiple accounts/models in play.
- [x] **Wire `⌘N` (New chat).** Done: `Ctrl/Cmd-N` now creates a new chat via the
  global keydown handler (`App.tsx`), matching the palette hint.
- [x] **Copy buttons.** Done: code-block copy (markdown item above) and a
  per-message copy button (hover-revealed) in `MessageBubble.tsx`.
- [ ] **Edit & resend a prompt.** No way to edit a previous user message and
  re-run the conversation from that point.

## Lower / polish

- [x] **Resizable panels.** Done: drag handles on the sidebar's right edge and
  the terminal panel's top edge, clamped and persisted to `localStorage`
  (self-contained in `Sidebar`/`TerminalPanel`).
- [x] **Tool-result truncation.** Done: cap raised to 50000 chars
  (`claude-stream.ts`, `index.ts`); `MessageBubble` shows the first 2000 chars
  with a "Show full output" expander.
- [x] **Accessibility.** Done: `useModalA11y` hook (focus trap, Esc-to-close,
  restore focus) applied to all modals with `role="dialog"`/`aria-modal`;
  `aria-label` on icon-only buttons and `aria-hidden` on decorative SVGs.
- [x] **Loading / empty states.** Done: spinner + skeleton loading and friendly
  empty-state messaging in Projects, Usage, and MCP views (shared `views.css`).

## Done

- [x] Multiple Claude logins with per-chat account selection (`feat(accounts)`, eacb8d3)
- [x] WSL: interactive login shell + clearer Test diagnostics (`fix(wsl)`, f9652f0)
