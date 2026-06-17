import { useEffect, useRef, useState } from 'react'
import { CheckpointMeta } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './CheckpointsModal.css'

interface Props {
  sessionId: string
  trackedFileCount: number
  onClose: () => void
  onCreate: (label: string) => Promise<void>
  onRestored: () => void
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function CheckpointsModal({ sessionId, trackedFileCount, onClose, onCreate, onRestored }: Props) {
  const [list, setList] = useState<CheckpointMeta[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  const load = async () => setList(await window.electronAPI.checkpointList(sessionId))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const create = async () => {
    setBusy(true)
    await onCreate(label.trim() || 'Manual checkpoint')
    setLabel('')
    await load()
    setBusy(false)
  }

  const restore = async (id: string) => {
    setBusy(true)
    const res = await window.electronAPI.checkpointRestore(sessionId, id)
    await load()
    setBusy(false)
    setNotice(`Restored ${res.restored} file${res.restored !== 1 ? 's' : ''}. A safety checkpoint was saved.`)
    onRestored()
    setTimeout(() => setNotice(''), 4000)
  }

  const del = async (id: string) => {
    setList(await window.electronAPI.checkpointDelete(sessionId, id))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal checkpoints-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkpoints-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="checkpoints-modal-title">Timeline · checkpoints</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="checkpoint-create">
          <input
            className="text-input"
            placeholder="Checkpoint label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn-primary" onClick={create} disabled={busy}>
            Snapshot {trackedFileCount} file{trackedFileCount !== 1 ? 's' : ''}
          </button>
        </div>
        <p className="field-hint cp-hint">
          A checkpoint saves the current contents of every file Claude has touched in this chat.
          Restoring rewrites those files (and auto-saves a safety checkpoint first).
        </p>

        {notice && <div className="cp-notice">{notice}</div>}

        <div className="checkpoint-list">
          {list.length === 0 ? (
            <div className="cp-empty">No checkpoints yet.</div>
          ) : (
            list.map((c) => (
              <div key={c.id} className="checkpoint-row">
                <div className="cp-dot" />
                <div className="cp-main">
                  <div className="cp-label">{c.label}</div>
                  <div className="cp-meta">
                    {timeStr(c.createdAt)} · {c.fileCount} file{c.fileCount !== 1 ? 's' : ''}
                  </div>
                </div>
                <button className="btn-ghost small" onClick={() => restore(c.id)} disabled={busy}>
                  Restore
                </button>
                <button className="btn-text danger" onClick={() => del(c.id)}>Delete</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
