# Claude GUI — Improvement Backlog

Grounded GUI/UX improvements, ordered by impact. File references point at the
current implementation each item would change.

## High impact

- [x] **Real markdown rendering in messages.** Done: `Markdown.tsx` renders
  assistant messages with `react-markdown` + `remark-gfm` (lists, tables, task
  lists, links) and `rehype-highlight` syntax highlighting (theme-aware token
  colors), with a **copy button on code blocks** and external links opened in the
  browser. User messages stay plain text. Replaced the old regex `formatContent`.
- [ ] **Per-chat cost & token visibility.** Cost only flashes in the terminal as
  `done · $X` (`App.tsx` ~line 198); the Usage view is global. Add a running
  cost/token chip to the chat header, accumulated per session — makes the
  multi-account work legible (see what each account spends).
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

- [ ] **Resizable panels.** Sidebar width and terminal height are fixed; add
  drag-to-resize (`Sidebar`, `TerminalPanel`).
- [ ] **Tool-result truncation.** Results are capped at 4000 chars
  (`claude-stream.ts` ~line 80, `index.ts` ~line 378) with no "show full output".
- [ ] **Accessibility.** Icon-only buttons have `title` but no `aria-label`;
  modals don't trap focus or close on `Esc`. Add keyboard nav + ARIA.
- [ ] **Loading / empty states.** Projects, Usage, and MCP views fetch with no
  skeletons or empty-state messaging.

## Done

- [x] Multiple Claude logins with per-chat account selection (`feat(accounts)`, eacb8d3)
- [x] WSL: interactive login shell + clearer Test diagnostics (`fix(wsl)`, f9652f0)
