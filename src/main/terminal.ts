import * as pty from 'node-pty'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import { buildSubprocessEnv } from './auth'
import { accountConfigDir, resolveClaudeBin } from './accounts'
import { providerAccountEnv } from './provider-accounts'
import { resolveCodex } from './providers/cli-resolve'
import { getSshTerminalCommand } from './ssh'

/**
 * Embedded real terminal (PTY) support, so the user can run the actual interactive
 * `claude` CLI inside the app, reusing their existing Claude Code login/accounts.
 *
 * Terminals are keyed by a renderer-supplied id, always validated against a strict
 * charset before touching either map. Nothing in here ever throws across the IPC
 * boundary — every function is defensive and returns a failure shape instead.
 */

type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'unix' | 'wsl' | 'ssh'

const terminals = new Map<string, pty.IPty>()
const shellKinds = new Map<string, ShellKind>()
// Remote-path/claude-path hints for SSH terminals, used by startCliInTerminal.
const sshMeta = new Map<string, { remotePath?: string; claudePath?: string }>()
// Deferred kills scheduled by a renderer effect cleanup. A StrictMode dev remount
// (mount -> cleanup -> mount) cancels its own deferred kill when create() reuses the
// still-live pty; a real close/switch has no follow-up create, so the kill fires.
const pendingKills = new Map<string, ReturnType<typeof setTimeout>>()
// Ids whose pty has already had its provider CLI auto-started, so a second
// terminalStartCli call against the same live pty (e.g. from a StrictMode remount) is a
// no-op instead of typing the launch command twice.
const launched = new Set<string>()

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/

function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && SAFE_ID_RE.test(id)
}

export interface CreateTerminalOptions {
  cwd?: string
  /** The account id for the chat's provider (Claude account, CODEX_HOME account, or Gemini account). */
  accountId?: string
  /** If set, run the shell inside this WSL distro (matches a WSL chat's environment). */
  wslDistro?: string
  /** If set, connect over SSH to this stored host id (matches a remote chat's environment). */
  remoteHostId?: string
  /** Which CLI this terminal is for. Defaults to 'claude'. */
  provider?: 'claude' | 'codex' | 'gemini'
  cols: number
  rows: number
}

let pwshAvailable: boolean | null = null

function hasPwsh(): boolean {
  if (pwshAvailable !== null) return pwshAvailable
  try {
    const result = spawnSync('where', ['pwsh.exe'], { stdio: 'ignore' })
    pwshAvailable = result.status === 0
  } catch {
    pwshAvailable = false
  }
  return pwshAvailable
}

// Best-effort PATH lookup for a bare command, used only for a diagnostic message —
// never for deciding whether to launch (that check would race the pty's own PATH).
function hasCommand(cmd: string): boolean {
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore'
    })
    return result.status === 0
  } catch {
    return false
  }
}

function pickShell(): { shell: string; kind: ShellKind } {
  if (process.platform === 'win32') {
    if (hasPwsh()) return { shell: 'pwsh.exe', kind: 'pwsh' }
    return { shell: 'powershell.exe', kind: 'powershell' }
  }
  return { shell: process.env.SHELL || 'bash', kind: 'unix' }
}

// Recognise a WSL share path — \\wsl.localhost\<distro>\rest or \\wsl$\<distro>\rest — so a
// local chat pointed at a WSL folder still opens a terminal inside that distro (a local
// shell can't cd into a UNC path, and the session lives in WSL, not Windows).
function parseWslUnc(p?: string): { distro: string; linuxPath: string } | null {
  if (!p) return null
  const m = p.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\?(.*)$/i)
  if (!m) return null
  return { distro: m[1], linuxPath: '/' + m[2].replace(/\\/g, '/') }
}

export function createTerminal(
  id: string,
  opts: CreateTerminalOptions,
  onData: (id: string, data: string) => void,
  onExit: (id: string, exitCode: number) => void
): { ok: boolean; shell?: string } {
  if (!isSafeId(id)) return { ok: false }

  const pendingKill = pendingKills.get(id)
  if (pendingKill) {
    clearTimeout(pendingKill)
    pendingKills.delete(id)
  }
  const existing = terminals.get(id)
  if (existing) {
    // Benign re-create for an id that already has a live pty (StrictMode remount, or a
    // redundant renderer create call). Reuse it rather than spawning a duplicate.
    return { ok: true, shell: shellKinds.get(id) }
  }
  launched.delete(id)

  try {
    const env: Record<string, string> = { ...buildSubprocessEnv() }
    // Strip Claude Code's own runtime/session env vars. Otherwise a `claude` launched in
    // this terminal inherits the GUI's agent context (CLAUDECODE, entrypoint, SSE port,
    // a stray CLAUDE_CONFIG_DIR, etc.) and behaves as a nested session. Account config dir
    // is re-set explicitly below (local shells only).
    for (const k of Object.keys(env)) {
      if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE') || k === 'CLAUDE_CONFIG_DIR') {
        delete env[k]
      }
    }

    const cols = Number.isInteger(opts.cols) && opts.cols > 0 ? opts.cols : 80
    const rows = Number.isInteger(opts.rows) && opts.rows > 0 ? opts.rows : 24

    let shell: string
    let shellArgs: string[] = []
    let kind: ShellKind
    let spawnCwd: string

    // Resolve the effective WSL target: an explicit WSL chat, or a folder that is a WSL
    // share (\\wsl.localhost\<distro>\..). The share form also gives us the Linux path.
    const fromUnc = process.platform === 'win32' ? parseWslUnc(opts.cwd) : null
    const wslDistro = opts.wslDistro || fromUnc?.distro
    const wslCwd = fromUnc
      ? fromUnc.linuxPath
      : opts.cwd && opts.cwd.startsWith('/')
        ? opts.cwd
        : undefined

    if (opts.remoteHostId) {
      // Remote SSH → hand off to the system ssh CLI with the stored host's connection
      // details. Windows/WSL env (CLAUDE_CONFIG_DIR, CLAUDE_BIN, provider account env) is
      // meaningless on the remote box, so leave it unset; the remote's own PATH/login
      // resolves the CLI.
      const ssh = getSshTerminalCommand(opts.remoteHostId)
      if (!ssh) return { ok: false }
      shell = ssh.shell
      shellArgs = ssh.args
      kind = 'ssh'
      spawnCwd = os.homedir()
      sshMeta.set(id, { remotePath: ssh.remotePath, claudePath: ssh.claudePath })
    } else if (wslDistro && process.platform === 'win32') {
      // WSL → run inside that distro so it uses the distro's own claude, login, and session.
      // Windows CLAUDE_CONFIG_DIR/CLAUDE_BIN are meaningless in WSL, so leave them unset.
      shell = 'wsl.exe'
      shellArgs = ['-d', wslDistro]
      if (wslCwd) shellArgs.push('--cd', wslCwd)
      kind = 'wsl'
      spawnCwd = os.homedir()
    } else {
      const picked = pickShell()
      shell = picked.shell
      kind = picked.kind
      spawnCwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
      const provider = opts.provider ?? 'claude'
      if (provider === 'claude') {
        const configDir = accountConfigDir(opts.accountId)
        if (configDir) {
          env.CLAUDE_CONFIG_DIR = configDir
          delete env.ANTHROPIC_API_KEY
        }
        env.CLAUDE_BIN = resolveClaudeBin()
      } else {
        Object.assign(env, providerAccountEnv(provider, opts.accountId))
      }
    }

    const p = pty.spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: spawnCwd,
      env
    })

    p.onData((d) => onData(id, d))
    p.onExit((e) => {
      onExit(id, e.exitCode)
      terminals.delete(id)
      shellKinds.delete(id)
      sshMeta.delete(id)
      launched.delete(id)
      const t = pendingKills.get(id)
      if (t) {
        clearTimeout(t)
        pendingKills.delete(id)
      }
    })

    terminals.set(id, p)
    shellKinds.set(id, kind)

    return { ok: true, shell: kind }
  } catch {
    return { ok: false }
  }
}

export function writeTerminal(id: string, data: string): void {
  if (!isSafeId(id)) return
  if (typeof data !== 'string') return
  const p = terminals.get(id)
  if (!p) return
  try {
    p.write(data)
  } catch {
    // no-op
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (!isSafeId(id)) return
  if (!Number.isInteger(cols) || cols <= 0) return
  if (!Number.isInteger(rows) || rows <= 0) return
  const p = terminals.get(id)
  if (!p) return
  try {
    p.resize(cols, rows)
  } catch {
    // no-op
  }
}

export function killTerminal(id: string): { ok: boolean } {
  if (!isSafeId(id)) return { ok: false }
  const t = pendingKills.get(id)
  if (t) {
    clearTimeout(t)
    pendingKills.delete(id)
  }
  launched.delete(id)
  const p = terminals.get(id)
  if (!p) return { ok: false }
  try {
    p.kill()
  } catch {
    // no-op
  }
  terminals.delete(id)
  shellKinds.delete(id)
  sshMeta.delete(id)
  return { ok: true }
}

// Schedule a kill instead of running it immediately, so a renderer effect cleanup that's
// about to be immediately followed by a re-create for the same id (React StrictMode's
// dev-only mount -> cleanup -> mount) doesn't tear down a pty that's about to be reused.
// A real close/session-switch has no follow-up create, so the kill fires after the delay.
export function killTerminalDeferred(id: string): void {
  if (!isSafeId(id)) return
  if (pendingKills.has(id)) return
  const t = setTimeout(() => {
    pendingKills.delete(id)
    killTerminal(id)
  }, 250)
  pendingKills.set(id, t)
}

// Only characters found in Claude Code session ids (UUID-like) — guards against injecting
// anything into the shell command line.
function safeResumeId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(v) ? v : null
}

// Quote a single token for inclusion in a PowerShell command line: wrap in single
// quotes, doubling any embedded single quote (PowerShell's own escaping rule).
function quotePwsh(token: string): string {
  return `'${token.replace(/'/g, "''")}'`
}

// Quote a single token for inclusion in a cmd.exe command line.
function quoteCmd(token: string): string {
  return `"${token}"`
}

// Quote a single token for inclusion in a POSIX shell command line.
function quoteUnix(token: string): string {
  return `'${token.replace(/'/g, `'\\''`)}'`
}

// Build the shell-specific command line that launches claude, optionally resuming a
// session. Shared by the initial launch and the resume-failure fallback below so both
// stay in sync with how each shell kind invokes the CLI.
function claudeLaunchCommand(kind: ShellKind, id: string, resumeArg: string): string {
  if (kind === 'pwsh' || kind === 'powershell') return `& $env:CLAUDE_BIN${resumeArg}\r`
  if (kind === 'cmd') return `"%CLAUDE_BIN%"${resumeArg}\r`
  if (kind === 'wsl') return `claude${resumeArg}\n`
  if (kind === 'ssh') {
    // Remote box has no CLAUDE_BIN — use the host's configured claude path (or bare
    // `claude` on its PATH), from the working directory the host was set up for.
    const meta = sshMeta.get(id)
    const cd = meta?.remotePath ? `cd ${quoteUnix(meta.remotePath)} && ` : ''
    return `${cd}${meta?.claudePath || 'claude'}${resumeArg}\n`
  }
  return `"$CLAUDE_BIN"${resumeArg}\n`
}

// How long we wait, after typing a `claude --resume <id>` launch command, for the CLI to
// enter the terminal's alternate screen (its "I took over the terminal" signal) before
// assuming the resume failed and relaunching fresh. A successful resume enters the alt
// screen within ~1s; a resume that errors (missing/incompatible session) prints an error
// and drops back to the shell prompt almost immediately. ~3s cleanly separates the two
// while still tolerating a slow CLI startup.
const RESUME_TAKEOVER_TIMEOUT_MS = 3000

// Matches the alt-screen-enter escape sequence (DECSET 1049/1047/47) that every one of
// these full-screen TUIs writes right after it takes over the terminal.
const ALT_SCREEN_ENTER_RE = /\x1b\[\?(?:1049|1047|47)h/

export function startCliInTerminal(
  id: string,
  provider: 'claude' | 'codex' | 'gemini',
  resumeSessionId?: string
): { ok: boolean } {
  if (!isSafeId(id)) return { ok: false }
  const p = terminals.get(id)
  const kind = shellKinds.get(id)
  if (!p || !kind) return { ok: false }
  if (launched.has(id)) return { ok: true }
  launched.add(id)
  try {
    if (provider === 'claude') {
      // Resume the chat's own Claude Code session when we have its id, else start fresh.
      const resume = safeResumeId(resumeSessionId)
      const arg = resume ? ` --resume ${resume}` : ''
      p.write(claudeLaunchCommand(kind, id, arg))

      // Only a resume attempt needs the takeover watch — a fresh launch has nothing to
      // fall back to. Watch the same pty's output for the alt-screen-enter sequence: if it
      // shows up, claude took over and resumed successfully; if the timeout fires first, the
      // resume failed (errored back to the shell prompt) and we relaunch without it.
      if (resume) {
        let buffer = ''
        let settled = false
        let disp: pty.IDisposable | undefined
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          try {
            disp?.dispose()
          } catch {
            // no-op
          }
          try {
            p.write(claudeLaunchCommand(kind, id, ''))
          } catch {
            // no-op — pty may already be gone
          }
        }, RESUME_TAKEOVER_TIMEOUT_MS)
        try {
          disp = p.onData((d) => {
            if (settled) return
            buffer += d
            // Cap the buffer so a chatty/failed CLI can't grow it unbounded while we wait.
            if (buffer.length > 8192) buffer = buffer.slice(-8192)
            if (ALT_SCREEN_ENTER_RE.test(buffer)) {
              settled = true
              clearTimeout(timer)
              try {
                disp?.dispose()
              } catch {
                // no-op
              }
            }
          })
        } catch {
          // node-pty's onData failed to register a second listener — nothing more we can
          // do defensively here; the timeout above still fires and relaunches regardless.
          clearTimeout(timer)
        }
      }
      return { ok: true }
    }

    // Codex/Gemini launch fresh — no resume support in these CLIs' interactive mode.

    // Gemini chats open Antigravity (Google's latest agentic CLI) instead of the older
    // `gemini` CLI. Its launch command is `agy` — a bare command resolved from PATH by
    // the interactive shell (including a Windows .cmd shim), so no node-entry resolution
    // is needed.
    if (provider === 'gemini') {
      p.write(`agy${kind === 'pwsh' || kind === 'powershell' || kind === 'cmd' ? '\r' : '\n'}`)
      return { ok: true }
    }

    if (kind === 'wsl' || kind === 'ssh') {
      // Use the distro's/remote's own CLI on PATH — the Windows node-entry resolution
      // doesn't apply there. WSL/SSH chats are Claude-only in practice; handled defensively.
      p.write(`${provider}\n`)
      return { ok: true }
    }

    const { command, prefixArgs } = resolveCodex()
    // A bare `codex` (no resolved node entry) depends on it being on this process's PATH —
    // silently unlike the npm-entry path, so check and say so instead of a bare shell.
    if (command === 'codex' && prefixArgs.length === 0 && !hasCommand('codex')) {
      p.write(`\r\n\x1b[33mcodex not found on PATH — install with: npm i -g @openai/codex\x1b[0m\r\n`)
    }
    if (kind === 'pwsh' || kind === 'powershell') {
      p.write(`& ${[command, ...prefixArgs].map(quotePwsh).join(' ')}\r`)
    } else if (kind === 'cmd') {
      p.write(`${[command, ...prefixArgs].map(quoteCmd).join(' ')}\r`)
    } else {
      p.write(`${[command, ...prefixArgs].map(quoteUnix).join(' ')}\n`)
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function killAllTerminals(): void {
  for (const t of pendingKills.values()) clearTimeout(t)
  pendingKills.clear()
  launched.clear()
  for (const [id, p] of terminals) {
    try {
      p.kill()
    } catch {
      // no-op
    }
    terminals.delete(id)
    shellKinds.delete(id)
    sshMeta.delete(id)
  }
}
