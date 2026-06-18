import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Session,
  Message,
  ToolCall,
  AgentEvent,
  AgentDone,
  AgentError,
  AuthStatus,
  TermLine,
  ModelInfo,
  CCSessionMeta,
  AgentDef,
  ApprovalRequest,
  CCAccountStatus
} from './types'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import ResizeHandles from './components/ResizeHandles'
import Chat from './components/Chat'
import TerminalPanel from './components/TerminalPanel'
import SettingsModal from './components/SettingsModal'
import NavRail, { View } from './components/NavRail'
import ClaudeMdModal from './components/ClaudeMdModal'
import ApprovalModal from './components/ApprovalModal'
import CheckpointsModal from './components/CheckpointsModal'
import GitModal from './components/GitModal'
import CommandPalette, { CommandItem } from './components/CommandPalette'
import OnboardingModal from './components/OnboardingModal'
import AccountsModal from './components/AccountsModal'
import { UiPrefs } from './types'
import ProjectsView from './views/ProjectsView'
import AgentsView from './views/AgentsView'
import UsageView from './views/UsageView'
import McpView from './views/McpView'
import PlannerView from './views/PlannerView'
import RemoteView from './views/RemoteView'
import { SshHostPublic } from './types'
import './styles/App.css'

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function applyUi(ui: UiPrefs) {
  const root = document.documentElement
  root.dataset.theme = ui.theme
  root.dataset.palette = ui.palette || 'warm-rust'
  root.dataset.density = ui.density
  const zoom = ui.fontSize === 'sm' ? 0.9 : ui.fontSize === 'lg' ? 1.12 : 1
  window.electronAPI.setZoom(zoom)
}

function newSession(projectPath?: string, model?: string, accountId?: string): Session {
  const now = Date.now()
  return {
    id: generateId(),
    name: 'New chat',
    messages: [],
    projectPath,
    model,
    accountId,
    // MCP off by default: loading every configured MCP server injects all their tool
    // schemas into every turn's context. Toggle it on per-chat when a chat needs them.
    useMcp: false,
    createdAt: now,
    updatedAt: now
  }
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [streaming, setStreaming] = useState(false)
  const [terminalLines, setTerminalLines] = useState<TermLine[]>([])
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [claudeMdOpen, setClaudeMdOpen] = useState(false)
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'files' | 'sessions'>('sessions')
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [view, setView] = useState<View>('chat')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [defaultModel, setDefaultModel] = useState('claude-opus-4-8')
  const [ui, setUi] = useState<UiPrefs | null>(null)
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([])
  const [accounts, setAccounts] = useState<CCAccountStatus[]>([])
  const [defaultAccountId, setDefaultAccountId] = useState('default')
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)

  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  // Latest createSession, so the global ⌘N handler never calls a stale closure.
  const createSessionRef = useRef<() => void>(() => {})

  // Files Claude has edited/written per session — used for checkpoint snapshots.
  const modifiedFilesRef = useRef<Map<string, Set<string>>>(new Map())
  const trackFile = (sessionId: string, filePath: string) => {
    if (!filePath) return
    let set = modifiedFilesRef.current.get(sessionId)
    if (!set) {
      set = new Set()
      modifiedFilesRef.current.set(sessionId, set)
    }
    set.add(filePath)
  }
  const trackedFiles = (sessionId: string) => [...(modifiedFilesRef.current.get(sessionId) ?? [])]

  const activeSession = sessions.find((s) => s.id === activeId)
  const ready = auth ? (auth.mode === 'api-key' ? auth.hasApiKey : auth.claudeCodeDetected || auth.hasApiKey) : false

  const addTerm = useCallback((line: TermLine) => {
    setTerminalLines((prev) => [...prev.slice(-499), line])
  }, [])

  const refreshAuth = useCallback(async () => {
    const status = await window.electronAPI.authStatus()
    setAuth(status)
    return status
  }, [])

  const refreshAccounts = useCallback(async () => {
    const list = await window.electronAPI.accountsList()
    setAccounts(list.accounts)
    setDefaultAccountId(list.defaultAccountId)
    return list
  }, [])

  // Mount: load sessions, auth, models, config
  useEffect(() => {
    const init = async () => {
      const [saved, models, config] = await Promise.all([
        window.electronAPI.listSessions(),
        window.electronAPI.getModels(),
        window.electronAPI.getConfig()
      ])
      await refreshAuth()
      const accountList = await refreshAccounts()
      setModels(models)
      setDefaultModel(config.defaultModel)
      setUi(config.ui)
      applyUi(config.ui)
      if (saved.length > 0) {
        setSessions(saved)
        setActiveId(saved[0].id)
      } else {
        const s = newSession(undefined, config.defaultModel, accountList.defaultAccountId)
        setSessions([s])
        setActiveId(s.id)
      }
    }
    init()
  }, [refreshAuth, refreshAccounts])

  const appendToLastAssistant = (sid: string, update: (m: Message) => Message) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') msgs[msgs.length - 1] = update(last)
        return { ...s, messages: msgs }
      })
    )
  }

  // Agent event listeners
  useEffect(() => {
    const offEvent = window.electronAPI.onAgentEvent((data: AgentEvent) => {
      const sid = data.appSessionId
      if (data.kind === 'system') {
        if (data.claudeSessionId) {
          setSessions((prev) =>
            prev.map((s) => (s.id === sid ? { ...s, claudeSessionId: data.claudeSessionId } : s))
          )
        }
        addTerm({ kind: 'info', text: `session started · ${data.tools.length} tools available` })
        return
      }
      if (data.kind === 'text') {
        appendToLastAssistant(sid, (m) => ({ ...m, content: m.content + data.content }))
        return
      }
      if (data.kind === 'thinking') {
        addTerm({ kind: 'thinking', text: data.content })
        appendToLastAssistant(sid, (m) => ({ ...m, thinking: (m.thinking ?? '') + data.content }))
        return
      }
      if (data.kind === 'tool-use') {
        const inputStr = typeof data.input === 'object' ? JSON.stringify(data.input) : String(data.input)
        addTerm({ kind: 'tool', text: `${data.tool}(${inputStr.slice(0, 200)})` })
        const call: ToolCall = { id: data.toolId, tool: data.tool, input: data.input }
        appendToLastAssistant(sid, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }))
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(data.tool)) {
          const fp = (data.input as { file_path?: string; path?: string })?.file_path ??
            (data.input as { path?: string })?.path
          if (fp) trackFile(sid, fp)
        }
        return
      }
      if (data.kind === 'tool-result') {
        addTerm({ kind: data.isError ? 'error' : 'result', text: data.content.slice(0, 300) || '(no output)' })
        appendToLastAssistant(sid, (m) => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map((c) =>
            c.id === data.toolId ? { ...c, result: data.content, isError: data.isError } : c
          )
        }))
        return
      }
    })

    const offDone = window.electronAPI.onAgentDone((data: AgentDone) => {
      setStreaming(false)
      if (data.isError && data.errorText) addTerm({ kind: 'error', text: data.errorText })
      addTerm({ kind: 'info', text: `done · $${data.costUsd.toFixed(4)}` })
      if (!document.hasFocus()) {
        const sess = sessionsRef.current.find((s) => s.id === data.appSessionId)
        const where = sess?.name ? `“${sess.name}”` : 'chat'
        window.electronAPI.notify(
          data.isError ? 'Claude run failed' : 'Claude finished',
          data.isError ? data.errorText || 'The run ended with an error.' : `${where} is ready.`
        )
      }
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === data.appSessionId
            ? {
                ...s,
                claudeSessionId: data.claudeSessionId ?? s.claudeSessionId,
                updatedAt: Date.now(),
                costUsd: (s.costUsd ?? 0) + (data.costUsd ?? 0),
                inputTokens: (s.inputTokens ?? 0) + (data.inputTokens ?? 0),
                outputTokens: (s.outputTokens ?? 0) + (data.outputTokens ?? 0),
                cacheReadTokens: (s.cacheReadTokens ?? 0) + (data.cacheReadTokens ?? 0),
                cacheCreationTokens: (s.cacheCreationTokens ?? 0) + (data.cacheCreationTokens ?? 0)
              }
            : s
        )
        const session = updated.find((s) => s.id === data.appSessionId)
        if (session) window.electronAPI.saveSession(session)
        return updated
      })
    })

    const offErr = window.electronAPI.onAgentError((data: AgentError) => {
      setStreaming(false)
      addTerm({ kind: 'error', text: data.error })
      appendToLastAssistant(data.appSessionId, (m) => ({
        ...m,
        content: m.content || `Error: ${data.error}`,
        error: true
      }))
      if (!document.hasFocus()) window.electronAPI.notify('Claude run failed', data.error.slice(0, 120))
    })

    const offApproval = window.electronAPI.onApprovalRequest((data: ApprovalRequest) => {
      setApprovalQueue((prev) => [...prev, data])
    })

    return () => {
      offEvent()
      offDone()
      offErr()
      offApproval()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const respondApproval = (allow: boolean) => {
    setApprovalQueue((prev) => {
      const [head, ...rest] = prev
      if (head) {
        window.electronAPI.respondApproval({ approvalId: head.approvalId, allow })
        addTerm({ kind: allow ? 'info' : 'error', text: `${allow ? 'allowed' : 'denied'} ${head.tool}` })
      }
      return rest
    })
  }

  // Shared helper — builds the sendAgent payload from a session + prompt.
  // Both sendMessage, retryTurn, and editAndResend call this so params stay identical.
  const buildAgentPayload = useCallback(
    (session: Session, text: string, images?: { mediaType: string; data: string }[]) => ({
      appSessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      prompt: text,
      projectPath: session.projectPath,
      model: session.model || defaultModel,
      systemPrompt: session.systemPrompt,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
      useMcp: session.useMcp ?? false,
      approvalMode: (session.autoApprove ? 'auto' : 'ask') as 'auto' | 'ask',
      images,
      remoteHostId: session.remoteHostId,
      wslDistro: session.wslDistro,
      accountId: session.accountId ?? defaultAccountId
    }),
    [defaultModel, defaultAccountId]
  )

  const sendMessage = useCallback(
    (text: string, images?: { mediaType: string; data: string }[]) => {
      const session = sessions.find((s) => s.id === activeIdRef.current)
      if (!session || streaming) return

      // Auto-checkpoint the pre-turn state of files Claude has already touched, so this
      // turn's changes can be rolled back.
      const tracked = trackedFiles(session.id)
      if (tracked.length > 0) {
        window.electronAPI.checkpointCreate(
          session.id,
          `Before: ${text.slice(0, 50)}`,
          tracked,
          session.messages.length
        )
      }

      const userMsg: Message = { id: generateId(), role: 'user', content: text, timestamp: Date.now() }
      const assistantMsg: Message = { id: generateId(), role: 'assistant', content: '', toolCalls: [], timestamp: Date.now() }

      const updated: Session = {
        ...session,
        name: session.messages.length === 0 && session.name === 'New chat' ? text.slice(0, 40) : session.name,
        messages: [...session.messages, userMsg, assistantMsg],
        updatedAt: Date.now()
      }

      setSessions((prev) => prev.map((s) => (s.id === session.id ? updated : s)))
      setStreaming(true)
      setTerminalOpen(true)
      addTerm({ kind: 'user', text: text.slice(0, 120) })

      window.electronAPI.sendAgent(buildAgentPayload(session, text, images))
    },
    [sessions, streaming, addTerm, buildAgentPayload]
  )

  // Retry the last failed turn: reset the trailing assistant message and re-send
  // the last user message's content. Uses a ref so the listener-registered callback
  // always sees current state (same pattern as createSessionRef).
  const retryTurnRef = useRef<() => void>(() => {})
  const retryTurn = useCallback(() => {
    const sid = activeIdRef.current
    const session = sessionsRef.current.find((s) => s.id === sid)
    if (!session || streaming) return

    // Find the last user message that precedes the failed assistant message.
    const msgs = session.messages
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user')
    if (lastUserIdx === -1) return
    const lastUserMsg = msgs[lastUserIdx]

    // Reset the trailing assistant message in-place (clear error state).
    const freshAssistant: Message = {
      ...msgs[msgs.length - 1],
      content: '',
      toolCalls: [],
      thinking: undefined,
      error: false
    }
    const nextMsgs = [...msgs.slice(0, msgs.length - 1), freshAssistant]
    setSessions((prev) =>
      prev.map((s) => (s.id === sid ? { ...s, messages: nextMsgs } : s))
    )

    setStreaming(true)
    setTerminalOpen(true)
    addTerm({ kind: 'info', text: 'retrying…' })

    // Re-run sends text only — original images are not persisted on Message.
    window.electronAPI.sendAgent(buildAgentPayload(session, lastUserMsg.content))
  }, [streaming, addTerm, buildAgentPayload])
  retryTurnRef.current = retryTurn

  // Edit a user message and resend: truncates history to before that message,
  // then appends a fresh user + assistant pair with the new text.
  const editAndResend = useCallback(
    (messageId: string, newText: string) => {
      if (streaming || !newText.trim()) return
      const sid = activeIdRef.current
      const session = sessionsRef.current.find((s) => s.id === sid)
      if (!session) return

      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return

      const userMsg: Message = { id: generateId(), role: 'user', content: newText.trim(), timestamp: Date.now() }
      const assistantMsg: Message = { id: generateId(), role: 'assistant', content: '', toolCalls: [], timestamp: Date.now() }

      const nextMsgs = [...session.messages.slice(0, idx), userMsg, assistantMsg]
      setSessions((prev) =>
        prev.map((s) => (s.id === sid ? { ...s, messages: nextMsgs, updatedAt: Date.now() } : s))
      )

      setStreaming(true)
      setTerminalOpen(true)
      addTerm({ kind: 'user', text: newText.trim().slice(0, 120) })

      // Re-run sends text only — original images are not persisted on Message.
      window.electronAPI.sendAgent(buildAgentPayload(session, newText.trim()))
    },
    [streaming, addTerm, buildAgentPayload]
  )

  const stopMessage = useCallback(async () => {
    await window.electronAPI.stopAgent(activeIdRef.current)
    setStreaming(false)
    addTerm({ kind: 'info', text: 'stopped' })
  }, [addTerm])

  const createSession = () => {
    const s = newSession(activeSession?.projectPath, defaultModel, activeSession?.accountId ?? defaultAccountId)
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
  }
  createSessionRef.current = createSession

  const deleteSession = async (id: string) => {
    await window.electronAPI.deleteSession(id)
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (activeId === id && next.length > 0) setActiveId(next[0].id)
      else if (next.length === 0) {
        const s = newSession(undefined, defaultModel, defaultAccountId)
        setActiveId(s.id)
        return [s]
      }
      return next
    })
  }

  const setSessionProject = (path: string) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, projectPath: path } : s)))
  }

  const setSessionModel = (modelId: string) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, model: modelId } : s)))
  }

  const setSessionAccount = (accountId: string) => {
    const name = accounts.find((a) => a.id === accountId)?.name
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, accountId, accountName: name } : s))
    )
  }

  const toggleAutoApprove = () => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, autoApprove: !s.autoApprove } : s)))
  }

  const createCheckpoint = async (label: string) => {
    if (!activeSession) return
    await window.electronAPI.checkpointCreate(
      activeSession.id,
      label,
      trackedFiles(activeSession.id),
      activeSession.messages.length
    )
  }

  // Resume a real Claude Code session from the Projects view (local or WSL).
  const resumeCCSession = async (cc: CCSessionMeta) => {
    const transcript = await window.electronAPI.ccReadSession(cc.sourceId, cc.encodedDir, cc.sessionId)
    const messages: Message[] = transcript.map((m) => ({
      id: generateId(),
      role: m.role,
      content: m.text,
      thinking: m.thinking,
      toolCalls: m.toolCalls,
      timestamp: m.timestamp
    }))
    const isWsl = cc.kind === 'wsl'
    // A WSL session whose recorded cwd is actually a Windows mount (/mnt/c/…, /c/Users/…)
    // is a legacy artifact — don't reuse it; let it default to the distro's $HOME.
    const isWinMount = /^\/mnt\/[a-z]\//i.test(cc.realPath) || /^\/[a-z]\/(Users|Windows)\//i.test(cc.realPath)
    const projectPath = isWsl && isWinMount ? undefined : cc.realPath
    const s: Session = {
      id: generateId(),
      name: cc.title,
      messages,
      projectPath,
      claudeSessionId: cc.sessionId,
      model: cc.model || defaultModel,
      accountId: defaultAccountId,
      useMcp: false,
      wslDistro: isWsl ? cc.distro : undefined,
      remoteHostName: isWsl ? `WSL · ${cc.distro}` : undefined,
      autoApprove: isWsl ? true : undefined,
      createdAt: cc.createdAt || Date.now(),
      updatedAt: Date.now()
    }
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
    setTerminalLines([])
    addTerm({ kind: 'info', text: `resuming ${isWsl ? cc.distro + ' ' : ''}session ${cc.sessionId.slice(0, 8)}` })
  }

  // Run a custom agent
  const runAgent = (agent: AgentDef) => {
    const s: Session = {
      id: generateId(),
      name: agent.name,
      messages: [],
      projectPath: agent.defaultProjectPath,
      model: agent.model,
      agentId: agent.id,
      agentName: agent.name,
      accountId: defaultAccountId,
      systemPrompt: agent.systemPrompt,
      permissionMode: agent.permissionMode,
      allowedTools: agent.allowedTools,
      useMcp: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
  }

  const connectRemote = (host: SshHostPublic) => {
    const s = newSession(host.remotePath, defaultModel, defaultAccountId)
    s.name = `${host.name} (remote)`
    s.remoteHostId = host.id
    s.remoteHostName = host.name
    s.autoApprove = true // remote runs are headless; no interactive approval channel
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
    addTerm({ kind: 'info', text: `remote session on ${host.name}` })
  }

  const connectWsl = (distro: string, cwd?: string) => {
    const s = newSession(cwd, defaultModel, defaultAccountId)
    s.name = `${distro} (WSL)`
    s.wslDistro = distro
    s.remoteHostName = `WSL · ${distro}`
    s.autoApprove = true
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
    addTerm({ kind: 'info', text: `WSL session on ${distro}` })
  }

  const handleSetDefaultModel = async (modelId: string) => {
    setDefaultModel(modelId)
    await window.electronAPI.setDefaultModel(modelId)
  }

  const updateUi = async (patch: Partial<UiPrefs>) => {
    const next = await window.electronAPI.setUiPrefs(patch)
    setUi(next)
    applyUi(next)
  }

  // Global Ctrl/Cmd-K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        createSessionRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Track window maximize state for the custom title bar (icon + corner rounding).
  useEffect(() => {
    window.electronAPI.windowIsMaximized().then(setMaximized)
    return window.electronAPI.onWindowMaximized(setMaximized)
  }, [])

  const paletteItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = []
    items.push({ id: 'new', title: 'New chat', group: 'Actions', subtitle: '⌘N', run: createSession })
    const views: { v: View; label: string }[] = [
      { v: 'chat', label: 'Chat' },
      { v: 'projects', label: 'Projects' },
      { v: 'agents', label: 'Agents' },
      { v: 'planner', label: 'Planner' },
      { v: 'usage', label: 'Usage' },
      { v: 'mcp', label: 'MCP' },
      { v: 'remote', label: 'Remote & WSL' }
    ]
    for (const { v, label } of views) items.push({ id: `view:${v}`, title: `Go to ${label}`, group: 'Views', run: () => setView(v) })
    items.push({ id: 'settings', title: 'Open Settings', group: 'Views', run: () => setSettingsOpen(true) })
    items.push({ id: 'accounts', title: 'Manage Claude accounts', group: 'Views', run: () => setAccountsOpen(true) })
    for (const s of sessions) {
      items.push({
        id: `sess:${s.id}`,
        title: s.name || 'New chat',
        subtitle: s.remoteHostName ?? s.projectPath?.split(/[\\/]/).filter(Boolean).pop(),
        group: 'Sessions',
        run: () => {
          setActiveId(s.id)
          setView('chat')
        }
      })
    }
    for (const m of models) {
      items.push({
        id: `model:${m.id}`,
        title: `Use ${m.label}`,
        subtitle: 'this chat',
        group: 'Switch model',
        run: () => setSessionModel(m.id)
      })
    }
    for (const a of accounts) {
      items.push({
        id: `account:${a.id}`,
        title: `Run as ${a.name}`,
        subtitle: a.loggedIn ? a.email ?? 'this chat' : 'not logged in',
        group: 'Switch account',
        run: () => setSessionAccount(a.id)
      })
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, models, accounts])

  return (
    <div className={`app-shell ${maximized ? 'maximized' : ''}`}>
      {!maximized && <ResizeHandles />}
      <TitleBar maximized={maximized} />
      <div className="app">
        <NavRail view={view} onChange={setView} onSettings={() => setSettingsOpen(true)} />

      {view === 'chat' && (
        <>
          <Sidebar
            sessions={sessions}
            activeId={activeId}
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            onSelectSession={setActiveId}
            onNewSession={createSession}
            onDeleteSession={deleteSession}
            projectPath={activeSession?.projectPath}
            onSetProject={setSessionProject}
            onOpenSettings={() => setSettingsOpen(true)}
            auth={auth}
            accounts={accounts}
            activeAccountId={activeSession?.accountId ?? defaultAccountId}
          />
          <div className="main-area">
            <Chat
              session={activeSession}
              streaming={streaming}
              onSendMessage={sendMessage}
              onStop={stopMessage}
              onOpenSettings={() => setSettingsOpen(true)}
              ready={ready}
              models={models}
              currentModel={activeSession?.model || defaultModel}
              onModelChange={setSessionModel}
              accounts={accounts}
              currentAccount={activeSession?.accountId ?? defaultAccountId}
              onAccountChange={setSessionAccount}
              onManageAccounts={() => setAccountsOpen(true)}
              onOpenClaudeMd={() => setClaudeMdOpen(true)}
              autoApprove={activeSession?.autoApprove ?? false}
              onToggleAutoApprove={toggleAutoApprove}
              onOpenCheckpoints={() => setCheckpointsOpen(true)}
              onOpenGit={() => setGitOpen(true)}
              onRetry={retryTurn}
              onEditResend={editAndResend}
            />
            <TerminalPanel
              lines={terminalLines}
              open={terminalOpen}
              onToggle={() => setTerminalOpen((v) => !v)}
              onClear={() => setTerminalLines([])}
            />
          </div>
        </>
      )}

      {view === 'projects' && <ProjectsView onResume={resumeCCSession} />}
      {view === 'agents' && <AgentsView models={models} defaultModel={defaultModel} onRun={runAgent} />}
      {view === 'planner' && (
        <PlannerView
          accounts={accounts}
          models={models}
          defaultModel={defaultModel}
          defaultAccountId={defaultAccountId}
        />
      )}
      {view === 'usage' && <UsageView />}
      {view === 'mcp' && <McpView />}
      {view === 'remote' && <RemoteView onConnect={connectRemote} onConnectWsl={connectWsl} />}

      {settingsOpen && (
        <SettingsModal
          auth={auth}
          models={models}
          defaultModel={defaultModel}
          onSetDefaultModel={handleSetDefaultModel}
          ui={ui}
          onSetUi={updateUi}
          onClose={() => setSettingsOpen(false)}
          onChanged={refreshAuth}
          onManageAccounts={() => {
            setSettingsOpen(false)
            setAccountsOpen(true)
          }}
        />
      )}
      {ui && !ui.onboarded && (
        <OnboardingModal
          onFinish={async () => {
            await updateUi({ onboarded: true })
            await refreshAuth()
          }}
        />
      )}
      {claudeMdOpen && (
        <ClaudeMdModal projectPath={activeSession?.projectPath} onClose={() => setClaudeMdOpen(false)} />
      )}
      {approvalQueue.length > 0 && (
        <ApprovalModal request={approvalQueue[0]} onDecide={respondApproval} />
      )}
      {checkpointsOpen && activeSession && (
        <CheckpointsModal
          sessionId={activeSession.id}
          trackedFileCount={trackedFiles(activeSession.id).length}
          onClose={() => setCheckpointsOpen(false)}
          onCreate={createCheckpoint}
          onRestored={() => addTerm({ kind: 'info', text: 'files restored from checkpoint' })}
        />
      )}
      {gitOpen && (
        <GitModal cwd={activeSession?.projectPath ?? ''} onClose={() => setGitOpen(false)} />
      )}
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
      {accountsOpen && (
        <AccountsModal onClose={() => setAccountsOpen(false)} onChanged={refreshAccounts} />
      )}
      </div>
    </div>
  )
}
