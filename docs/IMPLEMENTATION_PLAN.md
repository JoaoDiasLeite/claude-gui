# Implementation Plan

Scope: terminal view + default-view setting, hide resume/launch-command UI, dynamic
model catalog, per-account usage %, Codex/Gemini multi-account, and an approval-modal
readability fix.

Suggested order: **0 → 2 → 1 → 4 → 3 → 5** (quick wins first, riskiest provider work last).

---

## 0. Fix approval popup readability (command text barely visible)

**Problem:** In the Bash "wants to run a command" popup the command text is nearly
invisible on the light theme.

**Root cause:** `.approval-command pre` in
`src/renderer/src/components/ApprovalModal.css` hardcodes `color: #b6e6c6` (pale green)
on `background: var(--bg-0)`. In every *light* palette `--bg-0` is a near-white cream
(e.g. `#f7f5f1`, `#f8f6f2`), so pale green on cream has almost no contrast. The `<pre>`
also has no padding, so text touches the edges.

**Files**
- `src/renderer/src/components/ApprovalModal.css`

**Changes**
- Replace the hardcoded `#b6e6c6` with a theme-aware color: use `var(--text-0)` on
  `var(--bg-2)` (readable in both light and dark), or add a dedicated `--code-fg` /
  `--code-bg` token pair in `global.css` and use it here.
- Add `padding: 10px 12px`, `border-radius: var(--radius-sm)`, a subtle
  `border: 1px solid var(--bg-3)`, and `white-space: pre-wrap; word-break: break-all`
  so long commands wrap instead of overflowing.
- Verify against a light palette (e.g. warm-rust light) and a dark palette.

**Done when:** the command is clearly legible in both themes with comfortable padding.

---

## 1. Terminal view + "default view" setting

**Goal:** a setting to open new chats directly in the terminal instead of chat; plus
terminal UI polish.

**Files**
- `src/main/config.ts` — add `defaultChatView: 'chat' | 'terminal'` to `UiPrefs`
  (default `'chat'`). Existing `loadConfig` merge backfills old configs.
- `src/renderer/src/components/Chat.tsx` — seed `termOpenById[session.id]` from the pref
  when a session first mounts.
- `src/renderer/src/components/SettingsModal.tsx` — "Open new chats in: Chat / Terminal"
  control, wired through the existing `setUiPrefs` IPC.
- `src/renderer/src/components/ChatTerminal.tsx` + `.css` — polish:
  font-size control, copy-on-select / paste, and a fit refresh when the panel becomes
  visible.

**Done when:** toggling the setting makes new chats open in the terminal; polish items work.

---

## 2. Remove resume / launch-command UI from the terminal

**Goal:** stop showing the "Resume in Claude" / "Start Claude" button and the visible
launch command.

**Files**
- `src/renderer/src/components/ChatTerminal.tsx` — delete the primary
  "Resume in Claude"/"Start Claude" button and the `resumeSessionId` hint text. Keep the
  silent auto-launch (default) so claude still starts on open, just without surfaced UI.
- `src/main/terminal.ts` — `startClaudeInTerminal` stays as internal plumbing (still
  called by the auto-launch path); no user-facing command shown.

**Optional:** add a pref to choose "auto-launch claude" vs "plain shell" on terminal open.

**Done when:** the terminal opens without the resume button or visible command.

---

## 3. Load & validate the model catalog at startup

**Goal:** models loaded on app open, with detection of newer/outdated entries (e.g.
Sonnet 5 exists but isn't listed).

**Files**
- `src/main/models-catalog.ts` (new) — build the catalog at launch by merging:
  1. bundled `MODELS` defaults from `config.ts`,
  2. a user-writable `models.json` override under `userData`,
  3. best-effort live discovery: `codex debug models` for Codex; Claude/Gemini via
     CLI/API where available.
  Flag entries where a newer same-family model is discovered but missing.
- `src/main/config.ts` — keep `MODELS` as the fallback defaults.
- `src/main/index.ts` — `config:models` IPC returns the merged catalog instead of the
  static array.
- `src/renderer/src/components/ModelPicker.tsx` — show an "update available / outdated"
  hint.

**Note:** do NOT invent model ids/pricing. Pull canonical Claude model ids/pricing from
the `claude-api` skill reference before adding any Sonnet-5-class entry.

**Done when:** newer models appear on launch; outdated ones are flagged.

---

## 4. Show usage % for the active account (not just default)

**Goal:** the top-left percentage badge reflects the account of the chat you're viewing.

**Files**
- `src/main/plan-usage.ts` — attach the managed `accountId` (or `configDir`) to each
  `AccountPlanUsage` entry so the renderer can match by the same id sessions use.
- `src/renderer/src/App.tsx` — change `planSession` (~line 657) to resolve from
  `activeSession?.accountId ?? defaultAccountId` instead of always the `isDefault` entry.

**Done when:** switching chats bound to different accounts updates the top-left %.

---

## 5. Codex / Gemini multi-account (like Claude)

**Goal:** add, name, remove, and log in to multiple Codex and Gemini accounts, selectable
per chat — the same model as Claude accounts.

**Investigate first:** confirm each CLI supports config-dir isolation
(`CODEX_HOME` for Codex; the Gemini config-dir override env var) before committing.

**Files**
- `src/main/accounts.ts` (extend) or new `src/main/provider-accounts.ts` — store
  `{ id, name, provider, configDir }` for codex/gemini accounts.
- `src/main/agent-clis.ts` — per-account login launching each CLI with its own config-dir
  env var set; per-account status detection.
- `src/main/providers/codex.ts`, `src/main/providers/gemini.ts`, `src/main/terminal.ts` —
  thread the chosen provider account's config dir into the run/PTY env.
- `src/renderer/src/components/AccountsModal.tsx` — same add/name/remove/login UI for
  Codex/Gemini instead of the single "Other engines" login.
- `src/renderer/src/components/AccountPicker.tsx` — pick among the active model's provider
  accounts per chat.

**Done when:** multiple Codex/Gemini accounts can be added and chosen per chat like Claude.

---

## Open decisions (defaults assumed)

- Terminal polish: font-size + copy/paste + better fit (assumed).
- Terminal open behavior: auto-launch claude silently (assumed).
- Provider multi-account: full implementation, sequenced last (assumed).
