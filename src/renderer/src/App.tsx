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
  ApprovalRequest
} from './types'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import TerminalPanel from './components/TerminalPanel'
import SettingsModal from './components/SettingsModal'
import NavRail, { View } from './components/NavRail'
import ClaudeMdModal from './components/ClaudeMdModal'
import ApprovalModal from './components/ApprovalModal'
import CheckpointsModal from './components/CheckpointsModal'
import GitModal from './components/GitModal'
import CommandPalette, { CommandItem } from './components/CommandPalette'
import ProjectsView from './views/ProjectsView'
import AgentsView from './views/AgentsView'
import UsageView from './views/UsageView'
import McpView from './views/McpView'
import RemoteView from './views/RemoteView'
import { SshHostPublic } from './types'
import './styles/App.css'

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function newSession(projectPath?: string, model?: string): Session {
  const now = Date.now()
  return {
    id: generateId(),
    name: 'New chat',
    messages: [],
    projectPath,
    model,
    useMcp: true,
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
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([])

  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

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

  // Mount: load sessions, auth, models, config
  useEffect(() => {
    const init = async () => {
      const [saved, models, config] = await Promise.all([
        window.electronAPI.listSessions(),
        window.electronAPI.getModels(),
        window.electronAPI.getConfig()
      ])
      await refreshAuth()
      setModels(models)
      setDefaultModel(config.defaultModel)
      if (saved.length > 0) {
        setSessions(saved)
        setActiveId(saved[0].id)
      } else {
        const s = newSession(undefined, config.defaultModel)
        setSessions([s])
        setActiveId(s.id)
      }
    }
    init()
  }, [refreshAuth])

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
            ? { ...s, claudeSessionId: data.claudeSessionId ?? s.claudeSessionId, updatedAt: Date.now() }
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
      appendToLastAssistant(data.appSessionId, (m) => ({ ...m, content: m.content || `Error: ${data.error}` }))
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

      window.electronAPI.sendAgent({
        appSessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        prompt: text,
        projectPath: session.projectPath,
        model: session.model || defaultModel,
        systemPrompt: session.systemPrompt,
        permissionMode: session.permissionMode,
        allowedTools: session.allowedTools,
        useMcp: session.useMcp ?? true,
        approvalMode: session.autoApprove ? 'auto' : 'ask',
        images,
        remoteHostId: session.remoteHostId
      })
    },
    [sessions, streaming, addTerm, defaultModel]
  )

  const stopMessage = useCallback(async () => {
    await window.electronAPI.stopAgent(activeIdRef.current)
    setStreaming(false)
    addTerm({ kind: 'info', text: 'stopped' })
  }, [addTerm])

  const createSession = () => {
    const s = newSession(activeSession?.projectPath, defaultModel)
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
  }

  const deleteSession = async (id: string) => {
    await window.electronAPI.deleteSession(id)
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (activeId === id && next.length > 0) setActiveId(next[0].id)
      else if (next.length === 0) {
        const s = newSession(undefined, defaultModel)
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
      useMcp: true,
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
      systemPrompt: agent.systemPrompt,
      permissionMode: agent.permissionMode,
      allowedTools: agent.allowedTools,
      useMcp: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    setView('chat')
  }

  const connectRemote = (host: SshHostPublic) => {
    const s = newSession(host.remotePath, defaultModel)
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
    const s = newSession(cwd, defaultModel)
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

  // Global Ctrl/Cmd-K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = []
    items.push({ id: 'new', title: 'New chat', group: 'Actions', subtitle: '⌘N', run: createSession })
    const views: { v: View; label: string }[] = [
      { v: 'chat', label: 'Chat' },
      { v: 'projects', label: 'Projects' },
      { v: 'agents', label: 'Agents' },
      { v: 'usage', label: 'Usage' },
      { v: 'mcp', label: 'MCP' },
      { v: 'remote', label: 'Remote & WSL' }
    ]
    for (const { v, label } of views) items.push({ id: `view:${v}`, title: `Go to ${label}`, group: 'Views', run: () => setView(v) })
    items.push({ id: 'settings', title: 'Open Settings', group: 'Views', run: () => setSettingsOpen(true) })
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
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, models])

  return (
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
              onOpenClaudeMd={() => setClaudeMdOpen(true)}
              autoApprove={activeSession?.autoApprove ?? false}
              onToggleAutoApprove={toggleAutoApprove}
              onOpenCheckpoints={() => setCheckpointsOpen(true)}
              onOpenGit={() => setGitOpen(true)}
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
      {view === 'usage' && <UsageView />}
      {view === 'mcp' && <McpView />}
      {view === 'remote' && <RemoteView onConnect={connectRemote} onConnectWsl={connectWsl} />}

      {settingsOpen && (
        <SettingsModal
          auth={auth}
          models={models}
          defaultModel={defaultModel}
          onSetDefaultModel={handleSetDefaultModel}
          onClose={() => setSettingsOpen(false)}
          onChanged={refreshAuth}
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
    </div>
  )
}
