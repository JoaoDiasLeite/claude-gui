import { useState, useRef, useEffect, useCallback } from 'react'
import { Session, AuthStatus, CCAccountStatus } from '../types'
import FileTree from './FileTree'
import './Sidebar.css'

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
}

function shortModelLabel(id: string): string {
  if (MODEL_LABELS[id]) return MODEL_LABELS[id]
  // strip 'claude-' prefix, capitalize first word, keep the rest
  const stripped = id.replace(/^claude-/, '')
  return stripped
    .replace(/-(\d)/, ' $1')
    .replace(/^([a-z])/, (c) => c.toUpperCase())
}

interface Props {
  sessions: Session[]
  activeId: string
  tab: 'files' | 'sessions'
  onTabChange: (tab: 'files' | 'sessions') => void
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onNewQuickChat?: () => void
  onDeleteSession: (id: string) => void
  projectPath?: string
  onSetProject: (path: string) => void
  onOpenSettings: () => void
  auth: AuthStatus | null
  accounts: CCAccountStatus[]
  activeAccountId?: string
}

const MIN_WIDTH = 200
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 260
const STORAGE_KEY = 'sidebar-width'

export default function Sidebar({
  sessions,
  activeId,
  tab,
  onTabChange,
  onSelectSession,
  onNewSession,
  onNewQuickChat,
  onDeleteSession,
  projectPath,
  onSetProject,
  onOpenSettings,
  auth,
  accounts,
  activeAccountId
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
    }
    return DEFAULT_WIDTH
  })
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return
    const delta = e.clientX - startXRef.current
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
    setWidth(next)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    setWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w))
      return w
    })
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = width
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [width, handleMouseMove, handleMouseUp])

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) onSetProject(path)
  }

  const authReady = auth
    ? auth.mode === 'api-key'
      ? auth.hasApiKey
      : auth.claudeCodeDetected || auth.hasApiKey
    : false

  const authLabel = !auth
    ? 'Checking…'
    : auth.mode === 'claude-code'
      ? auth.claudeCodeDetected
        ? 'Claude Code account'
        : auth.hasApiKey
          ? 'API key (no Claude Code login)'
          : 'Not connected'
      : auth.hasApiKey
        ? 'API key'
        : 'No API key'

  // Surface the account the active chat runs under. The default account also counts as
  // ready when the global connection is (e.g. an API key), even if its own OAuth file
  // isn't present; other accounts are ready only once logged in.
  const activeAccount = accounts.find((a) => a.id === activeAccountId)
  const accountReady = activeAccount
    ? activeAccount.isDefault
      ? activeAccount.loggedIn || authReady
      : activeAccount.loggedIn
    : authReady
  const ready = accountReady
  const accountDetail = activeAccount?.loggedIn
    ? [activeAccount.email, activeAccount.plan].filter(Boolean).join(' · ')
    : ''
  const statusLabel = activeAccount
    ? activeAccount.name + (accountDetail ? ` · ${accountDetail}` : ready ? '' : ' · not logged in')
    : authLabel

  // Blank "New chat" drafts (no messages yet) stay out of the list — the Sessions
  // section only appears once at least one chat has real content. The active draft
  // is already on screen in the main area, so listing it adds nothing.
  const visibleSessions = sessions.filter((s) => s.messages.length > 0)

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="sidebar" style={{ width, flex: '0 0 auto' }}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M8 12h8M12 8v8" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Claude GUI</span>
        </div>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <button
        className={`auth-status ${ready ? 'ok' : 'warn'}`}
        onClick={onOpenSettings}
        title="Open connection settings"
      >
        <span className={`auth-dot ${ready ? 'ok' : 'warn'}`} />
        <span className="auth-label">{statusLabel}</span>
        {!ready && <span className="auth-cta">Connect</span>}
      </button>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'sessions' ? 'active' : ''}`}
          onClick={() => onTabChange('sessions')}
        >
          Chats
        </button>
        <button
          className={`sidebar-tab ${tab === 'files' ? 'active' : ''}`}
          onClick={() => onTabChange('files')}
        >
          Files
        </button>
      </div>

      <div className="sidebar-content">
        {tab === 'sessions' ? (
          <>
            <div className="sidebar-section-header">
              <span>Sessions</span>
              <div className="sidebar-section-actions">
                {onNewQuickChat && (
                  <button
                    className="icon-btn"
                    onClick={onNewQuickChat}
                    title="Quick chat (Haiku — cheapest model)"
                    aria-label="Quick chat with Haiku"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </button>
                )}
                <button className="icon-btn" onClick={onNewSession} title="New chat" aria-label="New chat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="session-list">
              {visibleSessions.length === 0 && (
                <div className="empty-state session-empty">
                  No chats yet — send your first message and it will show up here.
                </div>
              )}
              {visibleSessions.map((s) => (
                <div
                  key={s.id}
                  className={`session-item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelectSession(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div className="session-name">{s.name || 'New chat'}</div>
                  <div className="session-meta">
                    {s.projectPath && (
                      <span className="session-project" title={s.projectPath}>
                        {s.projectPath.split(/[\\/]/).pop()}
                      </span>
                    )}
                    <span className="session-date">{formatDate(s.updatedAt)}</span>
                    {hoveredId === s.id && (
                      <button
                        className="session-delete"
                        onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id) }}
                        title="Delete"
                        aria-label="Delete session"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {(() => {
                    const modelLabel = s.model ? shortModelLabel(s.model) : null
                    const accountLabel = accounts.length > 1
                      ? (s.accountName || accounts.find((a) => a.id === s.accountId)?.name || null)
                      : null
                    if (!modelLabel && !accountLabel) return null
                    return (
                      <div className="session-badges">
                        {modelLabel && <span className="session-badge model">{modelLabel}</span>}
                        {accountLabel && <span className="session-badge account">{accountLabel}</span>}
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-section-header">
              <span>{projectPath ? projectPath.split(/[\\/]/).pop() : 'No folder'}</span>
              <button className="icon-btn" onClick={handleOpenFolder} title="Open folder" aria-label="Open folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            </div>
            {projectPath ? (
              <FileTree rootPath={projectPath} />
            ) : (
              <div className="empty-state">
                <button className="open-folder-btn" onClick={handleOpenFolder}>
                  Open a folder
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="sidebar-resize-handle" onMouseDown={handleResizeMouseDown} />
    </div>
  )
}
