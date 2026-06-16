import { useEffect, useState, useCallback } from 'react'
import { GitStatus, GitFile } from '../types'
import './GitModal.css'

interface Props {
  cwd: string
  onClose: () => void
}

function UnifiedDiff({ text }: { text: string }) {
  if (!text.trim()) return <div className="git-diff-empty">No diff.</div>
  return (
    <div className="git-diff">
      {text.split('\n').map((line, i) => {
        let cls = 'ctx'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del'
        else if (line.startsWith('@@')) cls = 'hunk'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls = 'meta'
        return (
          <div key={i} className={`git-diff-line ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function statusLabel(f: GitFile): string {
  if (f.untracked) return 'U'
  const c = f.staged ? f.index : f.worktree
  return c === ' ' ? f.index : c
}

export default function GitModal({ cwd, onClose }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [selected, setSelected] = useState<GitFile | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const s = await window.electronAPI.gitStatus(cwd)
    setStatus(s)
    return s
  }, [cwd])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openFile = async (f: GitFile) => {
    setSelected(f)
    setDiff(await window.electronAPI.gitDiff(cwd, f.path, f.staged))
  }

  const stage = async (f: GitFile) => {
    setBusy(true)
    await window.electronAPI.gitStage(cwd, f.path)
    await refresh()
    setBusy(false)
  }
  const unstage = async (f: GitFile) => {
    setBusy(true)
    await window.electronAPI.gitUnstage(cwd, f.path)
    await refresh()
    setBusy(false)
  }
  const stageAll = async () => {
    setBusy(true)
    await window.electronAPI.gitStageAll(cwd)
    await refresh()
    setBusy(false)
  }
  const doCommit = async () => {
    setBusy(true)
    const res = await window.electronAPI.gitCommit(cwd, message)
    setBusy(false)
    setNotice(res.ok ? 'Committed.' : `Commit failed: ${res.message}`)
    if (res.ok) {
      setMessage('')
      setSelected(null)
      setDiff('')
      await refresh()
    }
    setTimeout(() => setNotice(''), 4000)
  }

  const staged = status?.files.filter((f) => f.staged) ?? []
  const unstaged = status?.files.filter((f) => !f.staged) ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal git-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Git
            {status?.isRepo && <span className="git-branch">{status.branch}</span>}
            {status && (status.ahead > 0 || status.behind > 0) && (
              <span className="git-ab">↑{status.ahead} ↓{status.behind}</span>
            )}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!status?.isRepo ? (
          <div className="git-empty">Not a git repository{cwd ? `: ${cwd}` : ' (open a project folder)'}.</div>
        ) : (
          <div className="git-body">
            <div className="git-files">
              <div className="git-section-head">
                <span>Staged ({staged.length})</span>
              </div>
              {staged.map((f) => (
                <div key={'s' + f.path} className={`git-file ${selected?.path === f.path && selected?.staged ? 'active' : ''}`} onClick={() => openFile({ ...f, staged: true })}>
                  <span className={`git-stat ${statusLabel(f)}`}>{statusLabel(f)}</span>
                  <span className="git-file-name">{f.path}</span>
                  <button className="git-mini" onClick={(e) => { e.stopPropagation(); unstage(f) }} disabled={busy} title="Unstage">−</button>
                </div>
              ))}

              <div className="git-section-head">
                <span>Changes ({unstaged.length})</span>
                {unstaged.length > 0 && <button className="btn-text" onClick={stageAll} disabled={busy}>Stage all</button>}
              </div>
              {unstaged.map((f) => (
                <div key={'u' + f.path} className={`git-file ${selected?.path === f.path && !selected?.staged ? 'active' : ''}`} onClick={() => openFile({ ...f, staged: false })}>
                  <span className={`git-stat ${statusLabel(f)}`}>{statusLabel(f)}</span>
                  <span className="git-file-name">{f.path}</span>
                  <button className="git-mini" onClick={(e) => { e.stopPropagation(); stage(f) }} disabled={busy} title="Stage">+</button>
                </div>
              ))}

              {status.files.length === 0 && <div className="git-clean">Working tree clean</div>}
            </div>

            <div className="git-detail">
              {selected ? (
                <UnifiedDiff text={diff} />
              ) : (
                <div className="git-diff-empty">Select a file to see its diff.</div>
              )}
            </div>
          </div>
        )}

        {status?.isRepo && (
          <div className="git-commit">
            {notice && <div className="git-notice">{notice}</div>}
            <textarea
              className="text-input"
              rows={2}
              placeholder="Commit message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="btn-primary" onClick={doCommit} disabled={busy || !message.trim() || staged.length === 0}>
              Commit {staged.length > 0 ? `(${staged.length})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
