import * as pty from 'node-pty'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import { buildSubprocessEnv } from './auth'
import { accountConfigDir, resolveClaudeBin } from './accounts'

/**
 * Embedded real terminal (PTY) support, so the user can run the actual interactive
 * `claude` CLI inside the app, reusing their existing Claude Code login/accounts.
 *
 * Terminals are keyed by a renderer-supplied id, always validated against a strict
 * charset before touching either map. Nothing in here ever throws across the IPC
 * boundary — every function is defensive and returns a failure shape instead.
 */

type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'unix' | 'wsl'

const terminals = new Map<string, pty.IPty>()
const shellKinds = new Map<string, ShellKind>()

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/

function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && SAFE_ID_RE.test(id)
}

export interface CreateTerminalOptions {
  cwd?: string
  accountId?: string
  /** If set, run the shell inside this WSL distro (matches a WSL chat's environment). */
  wslDistro?: string
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

    if (wslDistro && process.platform === 'win32') {
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
      const configDir = accountConfigDir(opts.accountId)
      if (configDir) {
        env.CLAUDE_CONFIG_DIR = configDir
        delete env.ANTHROPIC_API_KEY
      }
      env.CLAUDE_BIN = resolveClaudeBin()
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
  const p = terminals.get(id)
  if (!p) return { ok: false }
  try {
    p.kill()
  } catch {
    // no-op
  }
  terminals.delete(id)
  shellKinds.delete(id)
  return { ok: true }
}

// Only characters found in Claude Code session ids (UUID-like) — guards against injecting
// anything into the shell command line.
function safeResumeId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(v) ? v : null
}

export function startClaudeInTerminal(id: string, resumeSessionId?: string): { ok: boolean } {
  if (!isSafeId(id)) return { ok: false }
  const p = terminals.get(id)
  const kind = shellKinds.get(id)
  if (!p || !kind) return { ok: false }
  // Resume the chat's own Claude Code session when we have its id, else start fresh.
  const resume = safeResumeId(resumeSessionId)
  const arg = resume ? ` --resume ${resume}` : ''
  try {
    if (kind === 'pwsh' || kind === 'powershell') {
      p.write(`& $env:CLAUDE_BIN${arg}\r`)
    } else if (kind === 'cmd') {
      p.write(`"%CLAUDE_BIN%"${arg}\r`)
    } else if (kind === 'wsl') {
      // Inside WSL: use the distro's own claude on PATH (Windows CLAUDE_BIN doesn't apply).
      p.write(`claude${arg}\n`)
    } else {
      p.write(`"$CLAUDE_BIN"${arg}\n`)
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function killAllTerminals(): void {
  for (const [id, p] of terminals) {
    try {
      p.kill()
    } catch {
      // no-op
    }
    terminals.delete(id)
    shellKinds.delete(id)
  }
}
