# Chat terminal — crash + environment-aware launch plan

_Planned with Opus; to be implemented by Sonnet subagents in reviewed batches. Do not commit until reviewed._

## Symptoms (observed)

1. Opening a chat's embedded terminal shows:
   ```
   [process exited · code -1073741510]
   Windows PowerShell
   PS C:\Users\JoãoLeite\Desktop\João\Projetos\Claude-GUI> .
   ```
   i.e. an immediate "process exited" line, then a *fresh* bare shell, and the provider CLI often does **not** launch.
2. The terminal **always opens the local Windows shell** (PowerShell), regardless of the chat's environment. It should open the **respective** shell/CLI for that chat's environment (local, WSL, or remote SSH).

## Diagnosis

### The exit code
`-1073741510` (signed) = `0xC000013A` = **`STATUS_CONTROL_C_EXIT`**. The pty process was terminated by a console Ctrl‑C / close event — a teardown, not a normal program error. It appears *immediately* on open, which means the pty is being spawned and then killed right away (a create → kill → create cycle).

### Root causes
1. **StrictMode double‑mount (dev).** `src/renderer/src/main.tsx` renders inside `<React.StrictMode>`. In `npm run dev`, React intentionally runs each effect **mount → cleanup → mount**. `ChatTerminal`'s spawn effect (`src/renderer/src/components/ChatTerminal.tsx`) creates a pty on mount and calls `window.electronAPI.terminalKill(terminalId)` on cleanup. So the first pty is spawned and immediately killed (→ the `STATUS_CONTROL_C_EXIT` line), and only the second pty survives. Its exit event still flips the shared `exited` state, corrupting the UI (bare shell + "Restart terminal" overlay shown even though a shell is live). Production builds don't double‑invoke, but the lifecycle is fragile either way.
2. **`createTerminal` does not reuse a live pty for the same id.** `src/main/terminal.ts` `createTerminal` always `pty.spawn`s and overwrites `terminals.set(id, …)`. A second create for the same id spawns a duplicate; the kill/create race is what surfaces the control‑C exit.
3. **Auto‑launch is a renderer‑side race.** ChatTerminal waits `600ms` then calls `terminalStartCli`. This timer can fire against a torn‑down pty or miss the surviving one — leaving a bare shell with no CLI.
4. **Provider CLI resolution can silently fail.** `resolveCodex()` only finds Codex when installed as an npm global under `%APPDATA%\npm` / ProgramFiles; other installs fall back to a bare `codex` that may not be on the pty's PATH. Failures render as a bare shell, never an explanation.

### Environment gap
`createTerminal` only chooses **local shell** vs **WSL** (via `wslDistro` or a `\\wsl$` UNC cwd). And `Chat.tsx` passes only `wslDistro` to `ChatTerminal` (line ~640) — **not** `remoteHostId`. Consequences:
- **Remote (SSH) chats open a LOCAL shell** instead of connecting to the host.
- The provider CLI is always launched with local‑Windows semantics.
- `terminal.ts` has no SSH branch at all.

## Goals
1. Terminal opens reliably — no spurious `STATUS_CONTROL_C_EXIT` line, no bare‑shell‑with‑no‑CLI, no false "exited" overlay.
2. The shell matches the chat's environment: **local → pwsh/powershell**, **WSL → `wsl -d <distro>`**, **remote → `ssh <host>`**.
3. The correct provider CLI launches **inside that environment**, with failures shown clearly (command + hint) instead of a numeric code.

## Plan (batched)

### Batch 1 — Harden the terminal lifecycle (fixes the crash)
- **Reuse-by-id in `createTerminal`:** if a live pty already exists for `id`, don't spawn a second — re‑attach `onData`/`onExit` to the existing one and return `{ ok: true }`. This makes StrictMode's mount→cleanup→mount a no‑op instead of a kill/respawn.
- **Don't kill on effect cleanup; kill on real close.** In `ChatTerminal`, stop calling `terminalKill` in the spawn effect's cleanup. Only kill when the panel is actually closed (`onClose`) or the session changes. (Keep listeners detaching in cleanup.)
- **Move auto‑launch into main, once per pty.** Track a `launched` flag per id in `terminal.ts`; when a pty is first created, launch the provider CLI from main (no renderer `setTimeout` race). Renderer just requests "start cli" idempotently. Guard so it fires exactly once per live pty.
- **Fix the `exited` state:** ignore an `onExit` whose id is no longer the current terminal, so a killed predecessor can't flip the live terminal into the "exited" overlay.

### Batch 2 — Environment-aware shell selection
- Thread env into the terminal: pass `wslDistro` **and** remote host info (`remoteHostId` / host string) from `Chat` → `ChatTerminal` → `terminalCreate` opts (update preload + `types.ts`).
- In `createTerminal`, select the shell by env, in priority order:
  1. **Remote SSH host** → spawn an interactive `ssh <user@host>` (reuse the connection details the app already holds for that remote chat — see open question), then run the provider CLI on the remote PATH.
  2. **WSL distro** (explicit or `\\wsl$` UNC cwd) → `wsl.exe -d <distro> --cd <linuxPath>` (extend current logic).
  3. **Local** → pwsh/powershell (Windows) or `$SHELL` (posix).

### Batch 3 — Provider CLI launch per environment + diagnostics
- Launch the right CLI in the chosen env:
  - **claude** → `claude --resume <id>` (local via `CLAUDE_BIN`; WSL/remote via `claude` on that env's PATH).
  - **codex** → resolved node‑entry locally; bare `codex` inside WSL/remote.
  - **gemini** → `agy` in all envs.
- **Verify before launch:** if the CLI isn't found, print an actionable message in the terminal ("`codex` not found on PATH — install with …") instead of leaving a bare shell.
- **Better exit messaging:** on abnormal exit, show the attempted command + a hint, not just the numeric code. Suppress the `STATUS_CONTROL_C_EXIT` line entirely (it only ever means "we tore this pty down").

## Files to touch
- `src/main/terminal.ts` — reuse‑by‑id, once‑per‑pty auto‑launch, env‑aware shell (local/WSL/SSH), CLI existence check + messaging.
- `src/main/index.ts` — `terminal:create` opts (remote host), start‑cli wiring.
- `src/preload/index.ts`, `src/renderer/src/types.ts` — thread new opts (remote host).
- `src/renderer/src/components/ChatTerminal.tsx` — stop killing on cleanup, drop the 600ms auto‑launch race, ignore stale exit events, pass env.
- `src/renderer/src/components/Chat.tsx` — pass `remoteHostId`/host + `wslDistro` to `ChatTerminal`.

## Open questions (confirm before Batch 2/3)
1. **Remote SSH:** what does the app hold for a remote chat that the terminal can reuse to open an interactive `ssh` (host string, user, key/agent)? Check the `connectRemote` flow / remote host store. If there's no reusable connection, remote‑terminal support may need its own small design.
2. **Crash‑line suppression:** always hide `STATUS_CONTROL_C_EXIT`, or only in dev? (Recommend always — it never carries useful signal here.)
3. Is the primary target the **dev** experience (StrictMode) or the **packaged** app? The lifecycle hardening in Batch 1 fixes both; confirming tells us how hard to chase any remaining prod‑only cause.
