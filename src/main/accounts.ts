import { app } from 'electron'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Multi-account support for Claude Code subscription logins.
 *
 * Each account is an isolated Claude Code config directory selected via the
 * CLAUDE_CONFIG_DIR environment variable. The "default" account uses the machine's
 * standard config (~/.claude + ~/.claude.json, CLAUDE_CONFIG_DIR unset); additional
 * accounts each get their own dir under <userData>/cc-accounts/<id>, with their own
 * .credentials.json (login token) and .claude.json (oauthAccount identity).
 */

export interface CCAccount {
  id: string
  name: string
  /** Absolute config dir for this account, or null to use the machine default (~/.claude). */
  configDir: string | null
  isDefault: boolean
}

export interface CCAccountStatus extends CCAccount {
  /** True when this account has credentials and is usable for runs. */
  loggedIn: boolean
  email?: string
  org?: string
  plan?: string
}

interface AccountsState {
  accounts: CCAccount[]
  defaultAccountId: string
}

const DEFAULT_ID = 'default'

function accountsFile(): string {
  return path.join(app.getPath('userData'), 'accounts.json')
}

function accountsRoot(): string {
  return path.join(app.getPath('userData'), 'cc-accounts')
}

function freshState(): AccountsState {
  return {
    accounts: [{ id: DEFAULT_ID, name: 'Default', configDir: null, isDefault: true }],
    defaultAccountId: DEFAULT_ID
  }
}

let state: AccountsState = freshState()

export function loadAccounts(): void {
  try {
    if (fs.existsSync(accountsFile())) {
      const loaded = JSON.parse(fs.readFileSync(accountsFile(), 'utf-8')) as Partial<AccountsState>
      const accounts = Array.isArray(loaded.accounts) ? loaded.accounts : []
      // Always guarantee a default account exists.
      if (!accounts.some((a) => a.id === DEFAULT_ID)) {
        accounts.unshift({ id: DEFAULT_ID, name: 'Default', configDir: null, isDefault: true })
      }
      state = {
        accounts: accounts.map((a) => ({ ...a, isDefault: a.id === DEFAULT_ID })),
        defaultAccountId:
          loaded.defaultAccountId && accounts.some((a) => a.id === loaded.defaultAccountId)
            ? loaded.defaultAccountId
            : DEFAULT_ID
      }
    } else {
      state = freshState()
    }
  } catch {
    state = freshState()
  }
}

function persist(): void {
  try {
    fs.writeFileSync(accountsFile(), JSON.stringify(state, null, 2))
  } catch {
    // best-effort
  }
}

// ─── File locations per account ─────────────────────────────────────────────

interface AccountPaths {
  claudeJson: string
  credentials: string
}

function pathsFor(account: CCAccount): AccountPaths {
  if (account.configDir) {
    return {
      claudeJson: path.join(account.configDir, '.claude.json'),
      credentials: path.join(account.configDir, '.credentials.json')
    }
  }
  // Default machine login.
  return {
    claudeJson: path.join(os.homedir(), '.claude.json'),
    credentials: path.join(os.homedir(), '.claude', '.credentials.json')
  }
}

function readOAuthAccount(claudeJsonPath: string): { email?: string; org?: string; plan?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
    const a = raw.oauthAccount
    if (!a || typeof a !== 'object') return {}
    const plan =
      a.organizationType === 'claude_team'
        ? 'Team'
        : a.billingType === 'stripe_subscription'
          ? 'Pro'
          : a.billingType
            ? 'Paid'
            : 'Free'
    return { email: a.emailAddress, org: a.organizationName, plan }
  } catch {
    return {}
  }
}

function statusFor(account: CCAccount): CCAccountStatus {
  const { claudeJson, credentials } = pathsFor(account)
  const ident = readOAuthAccount(claudeJson)
  // On macOS credentials live in the Keychain, so fall back to the oauthAccount identity.
  const loggedIn = fs.existsSync(credentials) || !!ident.email
  return { ...account, loggedIn, ...ident }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getAccounts(): CCAccount[] {
  return state.accounts
}

export function listAccountStatus(): { accounts: CCAccountStatus[]; defaultAccountId: string } {
  return {
    accounts: state.accounts.map(statusFor),
    defaultAccountId: state.defaultAccountId
  }
}

/** Config dir to inject as CLAUDE_CONFIG_DIR for a run, or null for the machine default. */
export function accountConfigDir(accountId?: string): string | null {
  if (!accountId) return null
  const account = state.accounts.find((a) => a.id === accountId)
  return account?.configDir ?? null
}

function genId(): string {
  // Deterministic-ish unique id without Math.random / Date in scripts is not a concern here
  // (main process), but keep it filesystem-safe.
  return 'acc_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}

export function addAccount(name: string): CCAccountStatus {
  const id = genId()
  const configDir = path.join(accountsRoot(), id)
  fs.mkdirSync(configDir, { recursive: true })
  const account: CCAccount = { id, name: name.trim() || 'Account', configDir, isDefault: false }
  state.accounts.push(account)
  persist()
  return statusFor(account)
}

export function renameAccount(id: string, name: string): void {
  const account = state.accounts.find((a) => a.id === id)
  if (account) {
    account.name = name.trim() || account.name
    persist()
  }
}

export function removeAccount(id: string): { accounts: CCAccountStatus[]; defaultAccountId: string } {
  if (id === DEFAULT_ID) return listAccountStatus() // never remove the default
  const account = state.accounts.find((a) => a.id === id)
  if (account?.configDir) {
    try {
      fs.rmSync(account.configDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
  state.accounts = state.accounts.filter((a) => a.id !== id)
  if (state.defaultAccountId === id) state.defaultAccountId = DEFAULT_ID
  persist()
  return listAccountStatus()
}

export function setDefaultAccount(id: string): { accounts: CCAccountStatus[]; defaultAccountId: string } {
  if (state.accounts.some((a) => a.id === id)) {
    state.defaultAccountId = id
    persist()
  }
  return listAccountStatus()
}

/**
 * Launch an interactive Claude Code login for an account, in its own terminal window with
 * CLAUDE_CONFIG_DIR pointed at the account's config dir. The user completes the browser
 * OAuth flow; afterwards the dir holds .credentials.json + .claude.json and the account
 * shows as logged in. Returns the command so the UI can show a manual fallback.
 */
export function loginAccount(id: string): { launched: boolean; command: string } {
  const account = state.accounts.find((a) => a.id === id)
  const dir = account?.configDir
  if (!account || !dir) {
    // The default account logs in through the normal `claude` CLI, not a custom dir.
    return { launched: false, command: 'claude' }
  }
  fs.mkdirSync(dir, { recursive: true })

  let command: string
  let child: ReturnType<typeof spawn> | null = null
  try {
    if (process.platform === 'win32') {
      command = `set "CLAUDE_CONFIG_DIR=${dir}" && claude`
      // Quoting a `set ... && claude` string through spawn args is fragile, so write a tiny
      // batch file and launch that — only a single path arg needs quoting. `cmd /k` keeps
      // the window open so the user can see the login prompt/URL.
      const bat = path.join(os.tmpdir(), `claude-login-${id}.bat`)
      fs.writeFileSync(bat, `@echo off\r\nset "CLAUDE_CONFIG_DIR=${dir}"\r\nclaude\r\n`)
      child = spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', bat], {
        detached: true,
        stdio: 'ignore'
      })
    } else if (process.platform === 'darwin') {
      command = `CLAUDE_CONFIG_DIR='${dir}' claude`
      child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${command}"`], {
        detached: true,
        stdio: 'ignore'
      })
    } else {
      command = `CLAUDE_CONFIG_DIR='${dir}' claude`
      // Best-effort: try a common terminal emulator.
      child = spawn('x-terminal-emulator', ['-e', `bash -lc "${command}; exec bash"`], {
        detached: true,
        stdio: 'ignore'
      })
    }
    child?.on('error', () => {
      /* swallow — caller falls back to showing the command */
    })
    child?.unref()
    return { launched: true, command }
  } catch {
    const fallback =
      process.platform === 'win32'
        ? `set "CLAUDE_CONFIG_DIR=${dir}" && claude`
        : `CLAUDE_CONFIG_DIR='${dir}' claude`
    return { launched: false, command: fallback }
  }
}
