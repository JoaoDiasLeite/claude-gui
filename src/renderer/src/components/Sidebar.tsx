import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
  /** Session ids with an agent run currently in flight — pulsing accent dot. */
  runningIds: Set<string>
  /** Session ids with a pending approval waiting — amber dot. */
  attentionIds: Set<string>
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
  /** Primary account's live plan session (5h) window, for the ambient badge. */
  planSession?: { utilization: number; resetsAt?: string }
  /** App-wide default model/account — session badges only render when a session diverges from these. */
  defaultModel?: string
  defaultAccountId?: string
}

// "resets in 3h 12m" for the plan badge tooltip.
function fmtReset(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ''
  const mins = Math.round((t - Date.now()) / 60000)
  if (mins <= 0) return 'resets soon'
  if (mins < 60) return `resets in ${mins}m`
  return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m`
}

const MIN_WIDTH = 200
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 260
const STORAGE_KEY = 'sidebar-width'

export default function Sidebar({
  sessions,
  activeId,
  runningIds,
  attentionIds,
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
  activeAccountId,
  planSession,
  defaultModel,
  defaultAccountId
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
  // The pill shows just the account name — email/plan live in the tooltip, so the
  // ~200px row never ellipsizes mid-email against the usage badge.
  const statusLabel = activeAccount
    ? activeAccount.name + (ready ? '' : ' · not logged in')
    : authLabel
  const statusTitle =
    (accountDetail ? `${accountDetail} — ` : '') + 'Open connection settings'

  // Blank "New chat" drafts (no messages yet) stay out of the list — the Sessions
  // section only appears once at least one chat has real content. The active draft
  // is already on screen in the main area, so listing it adds nothing.
  const visibleSessions = sessions.filter((s) => s.messages.length > 0)

  // ── Session search ──────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Debounce so typing doesn't re-filter (and re-scan every message) on every keystroke
  // for people with a lot of history.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 150)
    return () => clearTimeout(t)
  }, [searchInput])

  const clearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
  }

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return visibleSessions
    return visibleSessions.filter((s) => {
      if (s.name?.toLowerCase().includes(q)) return true
      const base = s.projectPath?.split(/[\\/]/).filter(Boolean).pop()
      if (base?.toLowerCase().includes(q)) return true
      return s.messages.some(
        (m) => (m.role === 'user' || m.role === 'assistant') && m.content?.toLowerCase().includes(q)
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSessions, searchQuery])

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
      <div className="account-row">
        <button
          className={`auth-status ${ready ? 'ok' : 'warn'}`}
          onClick={onOpenSettings}
          title={statusTitle}
        >
          <span className={`auth-dot ${ready ? 'ok' : 'warn'}`} />
          <span className="auth-label">{statusLabel}</span>
          {planSession && (
            <span
              className={`plan-badge ${planSession.utilization >= 90 ? 'danger' : planSession.utilization >= 70 ? 'warn' : 'ok'}`}
              title={`Plan session window: ${planSession.utilization.toFixed(0)}% used${planSession.resetsAt ? ` · ${fmtReset(planSession.resetsAt)}` : ''}`}
            >
              {planSession.utilization.toFixed(0)}%
            </span>
          )}
          {!ready && <span className="auth-cta">Connect</span>}
        </button>
      </div>

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
        {tab === 'sessions' && (
          <div className="sidebar-tab-actions">
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
        )}
      </div>

      <div className="sidebar-content">
        {tab === 'sessions' ? (
          <>
            {(visibleSessions.length >= 5 || searchQuery) && (
              <div className="session-search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="session-search-icon">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="session-search-input"
                  placeholder="Search chats…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      clearSearch()
                      searchInputRef.current?.blur()
                    }
                  }}
                  aria-label="Search chats"
                />
                {searchInput && (
                  <button
                    className="session-search-clear"
                    onClick={clearSearch}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="session-list">
              {visibleSessions.length === 0 && (
                <div className="empty-state session-empty">
                  No chats yet — send your first message and it will show up here.
                </div>
              )}
              {visibleSessions.length > 0 && filteredSessions.length === 0 && (
                <div className="empty-state session-empty">No sessions match.</div>
              )}
              {filteredSessions.map((s) => {
                // Status dot: approval waiting > running > last-message error. At most one.
                const lastMsg = s.messages[s.messages.length - 1]
                const status = attentionIds.has(s.id)
                  ? 'attention'
                  : runningIds.has(s.id)
                    ? 'running'
                    : lastMsg?.error
                      ? 'error'
                      : null
                const statusTitle =
                  status === 'attention' ? 'Waiting for approval'
                    : status === 'running' ? 'Running'
                      : status === 'error' ? 'Ended with an error' : ''
                return (
                <div
                  key={s.id}
                  className={`session-item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelectSession(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div className="session-name">
                    {status && <span className={`session-dot ${status}`} title={statusTitle} />}
                    {s.name || 'New chat'}
                  </div>
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
                    const modelLabel = s.model && s.model !== defaultModel ? shortModelLabel(s.model) : null
                    const accountLabel = accounts.length > 1 && s.accountId && s.accountId !== defaultAccountId
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
                )
              })}
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
