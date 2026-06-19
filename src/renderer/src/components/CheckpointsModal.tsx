import { useEffect, useRef, useState } from 'react'
import { CheckpointMeta, CheckpointDiff } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import DiffView from './DiffView'
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

type Tab = 'timeline' | 'compare'

export default function CheckpointsModal({ sessionId, trackedFileCount, onClose, onCreate, onRestored }: Props) {
  const [list, setList] = useState<CheckpointMeta[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Tab>('timeline')

  // Compare state
  const [compareA, setCompareA] = useState<string>('')
  const [compareB, setCompareB] = useState<string>('current')
  const [diff, setDiff] = useState<CheckpointDiff | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [patchBusy, setPatchBusy] = useState(false)
  const [patchNotice, setPatchNotice] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  const load = async () => setList(await window.electronAPI.checkpointList(sessionId))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Auto-select first checkpoint when list loads
  useEffect(() => {
    if (list.length > 0 && !compareA) {
      setCompareA(list[0].id)
    }
  }, [list, compareA])

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

  const runCompare = async () => {
    if (!compareA) return
    setCompareLoading(true)
    setDiff(null)
    const result = await window.electronAPI.checkpointCompare(sessionId, compareA, compareB)
    setDiff(result)
    setCompareLoading(false)
  }

  const savePatch = async () => {
    if (!compareA) return
    setPatchBusy(true)
    const result = await window.electronAPI.checkpointSavePatch(sessionId, compareA, compareB)
    setPatchBusy(false)
    if (result.saved) {
      setPatchNotice('Patch saved.')
    } else if (result.reason === 'no-diff') {
      setPatchNotice('No differences to export.')
    } else if (result.reason === 'canceled') {
      setPatchNotice('')
    } else {
      setPatchNotice('Could not save patch.')
    }
    if (result.reason !== 'canceled') setTimeout(() => setPatchNotice(''), 3000)
  }

  const cpLabel = (id: string) => {
    if (id === 'current') return 'Current on-disk'
    const cp = list.find((c) => c.id === id)
    return cp ? cp.label : id
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

        <div className="cp-tabs">
          <button
            className={`cp-tab${tab === 'timeline' ? ' active' : ''}`}
            onClick={() => setTab('timeline')}
          >
            Timeline
          </button>
          <button
            className={`cp-tab${tab === 'compare' ? ' active' : ''}`}
            onClick={() => setTab('compare')}
          >
            Compare
          </button>
        </div>

        {tab === 'timeline' && (
          <>
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
          </>
        )}

        {tab === 'compare' && (
          <div className="cp-compare">
            {list.length < 1 ? (
              <div className="cp-empty">No checkpoints yet — create one on the Timeline tab first.</div>
            ) : (
              <>
                <div className="cp-compare-selectors">
                  <div className="cp-compare-field">
                    <label className="cp-compare-label">From</label>
                    <select
                      className="cp-select"
                      value={compareA}
                      onChange={(e) => { setCompareA(e.target.value); setDiff(null) }}
                    >
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>{c.label} — {timeStr(c.createdAt)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cp-compare-field">
                    <label className="cp-compare-label">To</label>
                    <select
                      className="cp-select"
                      value={compareB}
                      onChange={(e) => { setCompareB(e.target.value); setDiff(null) }}
                    >
                      <option value="current">Current on-disk state</option>
                      {list.filter((c) => c.id !== compareA).map((c) => (
                        <option key={c.id} value={c.id}>{c.label} — {timeStr(c.createdAt)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="cp-compare-actions">
                  <button className="btn-primary" onClick={runCompare} disabled={compareLoading || !compareA}>
                    {compareLoading ? 'Comparing…' : 'Compare'}
                  </button>
                  <button className="btn-ghost small" onClick={savePatch} disabled={patchBusy || !compareA}>
                    {patchBusy ? 'Saving…' : 'Export patch'}
                  </button>
                  {patchNotice && <span className="cp-patch-notice">{patchNotice}</span>}
                </div>

                {diff !== null && (
                  <div className="cp-diff-results">
                    {diff.files.length === 0 ? (
                      <div className="cp-empty">
                        No differences between {cpLabel(compareA)} and {cpLabel(compareB)}.
                      </div>
                    ) : (
                      diff.files.map((f) => (
                        <div key={f.path} className="cp-diff-file">
                          <div className="cp-diff-file-header" title={f.path}>
                            {f.path.split(/[\\/]/).pop()}
                            <span className="cp-diff-file-path">{f.path}</span>
                          </div>
                          <DiffView oldText={f.before} newText={f.after} filePath={f.path} />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
