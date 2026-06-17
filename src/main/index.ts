import { app, shell, BrowserWindow, ipcMain, dialog, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { query as QueryFn } from '@anthropic-ai/claude-agent-sdk'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  loadAuthState,
  setMode,
  setApiKey,
  getApiKey,
  clearApiKey,
  getAuthStatus,
  buildSubprocessEnv,
  AuthMode
} from './auth'
import { loadConfig, getConfig, setDefaultModel, setLimits, setUiPrefs, getClaudeSettings, MODELS, UsageLimits, UiPrefs } from './config'
import { getAllProjects, listSessions, readSession, getUsage, listSources, searchSessions } from './claude-data'
import {
  listMcpServers,
  upsertGlobalMcpServer,
  removeGlobalMcpServer,
  mcpServersForProject
} from './mcp'
import { listAgents, saveAgent, deleteAgent, AgentDef } from './agents'
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  deleteCheckpoint
} from './checkpoints'
import { getStatus, getDiff, stageFile, unstageFile, stageAll, commit } from './git'
import {
  listHosts,
  saveHost,
  deleteHost,
  testConnection,
  runRemote,
  stopRemote,
  SshHost
} from './ssh'
import { listDistros, testDistro, runWsl, stopWsl } from './wsl'
import { getHiddenDistros, setDistroHidden } from './store'
import {
  loadAccounts,
  listAccountStatus,
  accountConfigDir,
  addAccount,
  renameAccount,
  removeAccount,
  setDefaultAccount,
  loginAccount
} from './accounts'

let mainWindow: BrowserWindow | null = null

// In-flight agent runs keyed by app session id, so we can stop them.
const activeRuns = new Map<string, AbortController>()

// The Agent SDK ships as ESM only. The main process is bundled to CommonJS, so a
// static require() fails. Load it through a real dynamic import() that the bundler
// can't rewrite to require() (hidden behind a Function constructor).
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  s: string
) => Promise<unknown>

let queryFn: typeof QueryFn | null = null
async function getQuery(): Promise<typeof QueryFn> {
  if (!queryFn) {
    const mod = (await dynamicImport('@anthropic-ai/claude-agent-sdk')) as {
      query: typeof QueryFn
    }
    queryFn = mod.query
  }
  return queryFn
}

const sessionsDir = path.join(app.getPath('userData'), 'sessions')

function ensureDirs(): void {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f0f',
    icon: join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.claude-gui')
  ensureDirs()
  loadAuthState()
  loadAccounts()
  loadConfig()
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Notifications ────────────────────────────────────────────────────────────

ipcMain.handle('app:set-zoom', (_, factor: number) => {
  const f = Math.max(0.6, Math.min(1.4, factor || 1))
  mainWindow?.webContents.setZoomFactor(f)
  return f
})

ipcMain.handle('app:notify', (_, payload: { title: string; body: string }) => {
  if (!Notification.isSupported()) return { shown: false }
  const n = new Notification({ title: payload.title, body: payload.body, silent: false })
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  n.show()
  return { shown: true }
})

// ─── Auth IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('auth:status', () => getAuthStatus())
ipcMain.handle('auth:set-mode', (_, mode: AuthMode) => {
  setMode(mode)
  return getAuthStatus()
})
ipcMain.handle('auth:set-api-key', (_, key: string) => {
  setApiKey(key)
  return getAuthStatus()
})
ipcMain.handle('auth:clear-api-key', () => {
  clearApiKey()
  return getAuthStatus()
})
ipcMain.handle('auth:has-api-key', () => getApiKey() !== null)

// ─── Accounts (multiple Claude Code logins) ──────────────────────────────────

ipcMain.handle('accounts:list', () => listAccountStatus())
ipcMain.handle('accounts:add', (_, name: string) => addAccount(name))
ipcMain.handle('accounts:rename', (_, id: string, name: string) => {
  renameAccount(id, name)
  return listAccountStatus()
})
ipcMain.handle('accounts:remove', (_, id: string) => removeAccount(id))
ipcMain.handle('accounts:set-default', (_, id: string) => setDefaultAccount(id))
ipcMain.handle('accounts:login', (_, id: string) => loginAccount(id))

// ─── Agent run ─────────────────────────────────────────────────────────────

interface SendPayload {
  appSessionId: string
  claudeSessionId?: string
  prompt: string
  projectPath?: string
  model?: string
  systemPrompt?: string
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  allowedTools?: string[]
  useMcp?: boolean
  /** 'ask' = prompt before mutating tools; 'auto' = current auto-accept behavior. */
  approvalMode?: 'ask' | 'auto'
  /** Pasted/attached images to include with this turn. */
  images?: { mediaType: string; data: string }[]
  /** If set, run on this remote SSH host instead of locally. */
  remoteHostId?: string
  /** If set, run inside this WSL distro instead of locally. */
  wslDistro?: string
  /** Which Claude Code account (config dir) to run under. Undefined = machine default. */
  accountId?: string
}

/**
 * Build the `prompt` for query(). A plain string is the proven fast path; when images are
 * attached we must use the structured streaming-input form (one user message with text +
 * image content blocks). The generator completing signals end-of-input so the run finishes.
 */
function buildPrompt(
  text: string,
  images: { mediaType: string; data: string }[] | undefined,
  sessionId: string
): string | AsyncIterable<unknown> {
  if (!images || images.length === 0) return text
  const content: unknown[] = [{ type: 'text', text }]
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
  }
  async function* gen(): AsyncIterable<unknown> {
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: sessionId
    }
  }
  return gen()
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

// Tools that change the filesystem or run commands — these require approval in 'ask' mode.
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])

// Pending tool-approval prompts, keyed by an approval id, awaiting a renderer decision.
interface ApprovalDecision {
  allow: boolean
  updatedInput?: Record<string, unknown>
}
const pendingApprovals = new Map<string, (d: ApprovalDecision) => void>()

let approvalSeq = 0
function nextApprovalId(): string {
  approvalSeq += 1
  return `appr_${approvalSeq}_${approvalSeq * 2654435761 % 1000000}`
}

ipcMain.handle(
  'agent:approval-response',
  (_, payload: { approvalId: string; allow: boolean; updatedInput?: Record<string, unknown> }) => {
    const resolver = pendingApprovals.get(payload.approvalId)
    if (resolver) {
      pendingApprovals.delete(payload.approvalId)
      resolver({ allow: payload.allow, updatedInput: payload.updatedInput })
    }
    return { ok: true }
  }
)

ipcMain.on('agent:send', async (_event, payload: SendPayload) => {
  const { appSessionId, claudeSessionId, prompt, projectPath } = payload

  // Remote host: drive the remote machine's Claude Code over SSH instead of the local SDK.
  if (payload.remoteHostId) {
    runRemote(appSessionId, payload.remoteHostId, prompt, payload.model, claudeSessionId, {
      onEvent: (e) => send('agent:event', e),
      onDone: (d) => send('agent:done', { appSessionId, ...d }),
      onError: (msg) => send('agent:error', { appSessionId, error: msg })
    })
    return
  }

  // WSL distro: drive that distro's Claude Code via wsl.exe.
  if (payload.wslDistro) {
    runWsl(appSessionId, payload.wslDistro, prompt, payload.model, claudeSessionId, projectPath, undefined, {
      onEvent: (e) => send('agent:event', e),
      onDone: (d) => send('agent:done', { appSessionId, ...d }),
      onError: (msg) => send('agent:error', { appSessionId, error: msg })
    })
    return
  }

  const abort = new AbortController()
  activeRuns.set(appSessionId, abort)

  const cwd = projectPath && fs.existsSync(projectPath) ? projectPath : os.homedir()
  const model = payload.model || getConfig().defaultModel

  // Account: a non-default account points the engine at its own CLAUDE_CONFIG_DIR (its own
  // subscription login). Strip any API key so the account's OAuth login is what's used.
  const env = buildSubprocessEnv()
  const configDir = accountConfigDir(payload.accountId)
  if (configDir) {
    env.CLAUDE_CONFIG_DIR = configDir
    delete env.ANTHROPIC_API_KEY
  }
  const mcpServers = payload.useMcp ? mcpServersForProject(projectPath) : undefined
  const askMode = payload.approvalMode !== 'auto' && payload.permissionMode !== 'bypassPermissions'

  // In 'ask' mode, prompt the renderer before any mutating tool runs.
  const canUseTool = askMode
    ? async (toolName: string, input: Record<string, unknown>) => {
        if (!MUTATING_TOOLS.has(toolName)) {
          return { behavior: 'allow' as const, updatedInput: input }
        }
        const approvalId = nextApprovalId()
        send('agent:approval-request', { appSessionId, approvalId, tool: toolName, input })
        const decision = await new Promise<ApprovalDecision>((resolve) => {
          pendingApprovals.set(approvalId, resolve)
          abort.signal.addEventListener('abort', () => {
            if (pendingApprovals.delete(approvalId)) resolve({ allow: false })
          })
        })
        return decision.allow
          ? { behavior: 'allow' as const, updatedInput: decision.updatedInput ?? input }
          : { behavior: 'deny' as const, message: 'Denied by user.' }
      }
    : undefined

  try {
    const query = await getQuery()
    const stream = query({
      prompt: buildPrompt(prompt, payload.images, claudeSessionId ?? '') as string,
      options: {
        model,
        cwd,
        env,
        abortController: abort,
        includePartialMessages: true,
        permissionMode: askMode ? 'default' : payload.permissionMode ?? 'acceptEdits',
        ...(canUseTool ? { canUseTool } : {}),
        ...(payload.systemPrompt ? { systemPrompt: payload.systemPrompt } : {}),
        ...(payload.allowedTools ? { allowedTools: payload.allowedTools } : {}),
        ...(mcpServers && Object.keys(mcpServers).length
          ? { mcpServers: mcpServers as Record<string, never> }
          : {}),
        ...(claudeSessionId ? { resume: claudeSessionId } : {})
      }
    })

    let capturedSessionId = claudeSessionId

    for await (const message of stream) {
      // Capture the Claude Code session id for resume.
      if ('session_id' in message && message.session_id) {
        capturedSessionId = message.session_id as string
      }

      switch (message.type) {
        case 'system': {
          const m = message as unknown as { subtype?: string; tools?: string[] }
          if (m.subtype === 'init') {
            send('agent:event', {
              appSessionId,
              kind: 'system',
              claudeSessionId: capturedSessionId,
              tools: m.tools ?? []
            })
          }
          break
        }

        case 'stream_event': {
          const ev = (message as unknown as { event?: any }).event
          if (!ev) break
          if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta') {
              send('agent:event', { appSessionId, kind: 'text', content: ev.delta.text })
            } else if (ev.delta?.type === 'thinking_delta') {
              send('agent:event', { appSessionId, kind: 'thinking', content: ev.delta.thinking })
            }
          }
          break
        }

        case 'assistant': {
          const content = (message as any).message?.content ?? []
          for (const block of content) {
            if (block.type === 'tool_use') {
              send('agent:event', {
                appSessionId,
                kind: 'tool-use',
                tool: block.name,
                input: block.input,
                toolId: block.id
              })
            }
          }
          break
        }

        case 'user': {
          const content = (message as any).message?.content ?? []
          for (const block of content) {
            if (block.type === 'tool_result') {
              const text =
                typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text ?? '').join('')
                    : ''
              send('agent:event', {
                appSessionId,
                kind: 'tool-result',
                toolId: block.tool_use_id,
                content: text.slice(0, 50000),
                isError: !!block.is_error
              })
            }
          }
          break
        }

        case 'result': {
          const m = message as any
          send('agent:done', {
            appSessionId,
            claudeSessionId: capturedSessionId,
            costUsd: m.total_cost_usd ?? 0,
            isError: m.subtype !== 'success',
            errorText: m.subtype !== 'success' ? m.result ?? m.subtype : undefined,
            inputTokens: m.usage?.input_tokens ?? 0,
            outputTokens: m.usage?.output_tokens ?? 0,
            cacheReadTokens: m.usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: m.usage?.cache_creation_input_tokens ?? 0
          })
          break
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    send('agent:error', { appSessionId, error: msg })
  } finally {
    activeRuns.delete(appSessionId)
  }
})

ipcMain.handle('agent:stop', (_, appSessionId: string) => {
  const ctrl = activeRuns.get(appSessionId)
  if (ctrl) {
    ctrl.abort()
    activeRuns.delete(appSessionId)
    return { stopped: true }
  }
  if (stopRemote(appSessionId)) return { stopped: true }
  if (stopWsl(appSessionId)) return { stopped: true }
  return { stopped: false }
})

// ─── SSH hosts / remote ─────────────────────────────────────────────────────

ipcMain.handle('ssh:list', () => listHosts())
ipcMain.handle('ssh:save', (_, host: SshHost) => saveHost(host))
ipcMain.handle('ssh:delete', (_, id: string) => deleteHost(id))
ipcMain.handle('ssh:test', (_, id: string) => testConnection(id))

// ─── WSL ──────────────────────────────────────────────────────────────────

ipcMain.handle('wsl:list', () => listDistros())
ipcMain.handle('wsl:test', (_, distro: string) => testDistro(distro))
ipcMain.handle('wsl:hidden', () => getHiddenDistros())
ipcMain.handle('wsl:set-hidden', (_, distro: string, hidden: boolean) => setDistroHidden(distro, hidden))

// ─── Config / Models ──────────────────────────────────────────────────────────

ipcMain.handle('config:get', () => ({
  ...getConfig(),
  claudeSettings: getClaudeSettings()
}))
ipcMain.handle('config:models', () => MODELS)
ipcMain.handle('config:set-default-model', (_, modelId: string) => {
  setDefaultModel(modelId)
  return getConfig()
})
ipcMain.handle('config:set-limits', (_, limits: Partial<UsageLimits>) => setLimits(limits))
ipcMain.handle('config:set-ui', (_, prefs: Partial<UiPrefs>) => setUiPrefs(prefs))

// ─── Claude Code data (real projects / sessions / usage, local + WSL) ──────────

ipcMain.handle('cc:sources', () => listSources())
ipcMain.handle('cc:list-projects', () => getAllProjects())
ipcMain.handle('cc:list-sessions', (_, sourceId: string, encodedDir: string) =>
  listSessions(sourceId, encodedDir)
)
ipcMain.handle('cc:read-session', (_, sourceId: string, encodedDir: string, sessionId: string) =>
  readSession(sourceId, encodedDir, sessionId)
)
ipcMain.handle('cc:usage', (_, force = false) => getUsage(force))
ipcMain.handle('cc:search', (_, query: string) => searchSessions(query))

// ─── MCP ────────────────────────────────────────────────────────────────────

ipcMain.handle('mcp:list', () => listMcpServers())
ipcMain.handle('mcp:upsert', (_, name: string, cfg: Record<string, unknown>) =>
  upsertGlobalMcpServer(name, cfg)
)
ipcMain.handle('mcp:remove', (_, name: string) => removeGlobalMcpServer(name))

// ─── Agents ───────────────────────────────────────────────────────────────────

ipcMain.handle('agents:list', () => listAgents())
ipcMain.handle('agents:save', (_, agent: AgentDef) => saveAgent(agent))
ipcMain.handle('agents:delete', (_, id: string) => {
  deleteAgent(id)
  return listAgents()
})

// ─── CLAUDE.md ──────────────────────────────────────────────────────────────

ipcMain.handle('claudemd:read', (_, projectPath?: string) => {
  const targets: { scope: string; path: string }[] = []
  if (projectPath) targets.push({ scope: 'project', path: path.join(projectPath, 'CLAUDE.md') })
  targets.push({ scope: 'global', path: path.join(os.homedir(), '.claude', 'CLAUDE.md') })
  return targets.map((t) => ({
    scope: t.scope,
    path: t.path,
    exists: fs.existsSync(t.path),
    content: fs.existsSync(t.path) ? fs.readFileSync(t.path, 'utf-8') : ''
  }))
})

ipcMain.handle('claudemd:write', (_, filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return { success: true }
})

// ─── Checkpoints ──────────────────────────────────────────────────────────────

ipcMain.handle(
  'checkpoint:create',
  (_, sessionId: string, label: string, files: string[], messageCount: number) =>
    createCheckpoint(sessionId, label, files, messageCount, Date.now())
)
ipcMain.handle('checkpoint:list', (_, sessionId: string) => listCheckpoints(sessionId))
ipcMain.handle('checkpoint:restore', (_, sessionId: string, id: string) =>
  restoreCheckpoint(sessionId, id, Date.now())
)
ipcMain.handle('checkpoint:delete', (_, sessionId: string, id: string) =>
  deleteCheckpoint(sessionId, id)
)

// ─── Git ──────────────────────────────────────────────────────────────────────

ipcMain.handle('git:status', (_, cwd: string) => getStatus(cwd))
ipcMain.handle('git:diff', (_, cwd: string, filePath: string, staged: boolean) =>
  getDiff(cwd, filePath, staged)
)
ipcMain.handle('git:stage', (_, cwd: string, filePath: string) => stageFile(cwd, filePath))
ipcMain.handle('git:unstage', (_, cwd: string, filePath: string) => unstageFile(cwd, filePath))
ipcMain.handle('git:stage-all', (_, cwd: string) => stageAll(cwd))
ipcMain.handle('git:commit', (_, cwd: string, message: string) => commit(cwd, message))

// ─── File System ──────────────────────────────────────────────────────────────

ipcMain.handle('fs:read-dir', (_, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        type: e.isDirectory() ? 'directory' : 'file'
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:read-file', (_, filePath: string) => {
  try {
    return { content: fs.readFileSync(filePath, 'utf-8') }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('fs:open-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled) return null
  return result.filePaths[0]
})

// ─── Sessions ─────────────────────────────────────────────────────────────────

ipcMain.handle('session:list', () => {
  try {
    return fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8')))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
})

ipcMain.handle('session:save', (_, session: unknown) => {
  const s = session as { id: string }
  fs.writeFileSync(path.join(sessionsDir, `${s.id}.json`), JSON.stringify(session, null, 2))
  return { success: true }
})

ipcMain.handle('session:delete', (_, sessionId: string) => {
  const filePath = path.join(sessionsDir, `${sessionId}.json`)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  return { success: true }
})
