import { useState } from 'react'
import { Session, AuthStatus } from '../types'
import FileTree from './FileTree'
import './Sidebar.css'

interface Props {
  sessions: Session[]
  activeId: string
  tab: 'files' | 'sessions'
  onTabChange: (tab: 'files' | 'sessions') => void
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  projectPath?: string
  onSetProject: (path: string) => void
  onOpenSettings: () => void
  auth: AuthStatus | null
}

export default function Sidebar({
  sessions,
  activeId,
  tab,
  onTabChange,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  projectPath,
  onSetProject,
  onOpenSettings,
  auth
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) onSetProject(path)
  }

  const ready = auth
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

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M8 12h8M12 8v8" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Claude GUI</span>
        </div>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
        <span className="auth-label">{authLabel}</span>
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
              <button className="icon-btn" onClick={onNewSession} title="New chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            <div className="session-list">
              {sessions.map((s) => (
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
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-section-header">
              <span>{projectPath ? projectPath.split(/[\\/]/).pop() : 'No folder'}</span>
              <button className="icon-btn" onClick={handleOpenFolder} title="Open folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    </div>
  )
}
