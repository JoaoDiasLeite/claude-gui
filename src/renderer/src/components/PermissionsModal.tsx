import { useEffect, useRef, useState } from 'react'
import { ClaudePermissions } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './PermissionsModal.css'

interface Props {
  onClose: () => void
}

type ListKey = keyof ClaudePermissions

const LISTS: { key: ListKey; label: string; hint: string }[] = [
  { key: 'allow', label: 'Allow', hint: 'Tools always approved without prompting (e.g. Bash(npm test)).' },
  { key: 'deny', label: 'Deny', hint: 'Tools always blocked.' },
  { key: 'ask', label: 'Ask', hint: 'Tools that always prompt for approval.' }
]

export default function PermissionsModal({ onClose }: Props) {
  const [perms, setPerms] = useState<ClaudePermissions>({ allow: [], deny: [], ask: [] })
  const [inputs, setInputs] = useState<Record<ListKey, string>>({ allow: '', deny: '', ask: '' })
  const [saved, setSaved] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  useEffect(() => {
    window.electronAPI.getClaudePermissions().then(setPerms)
  }, [])

  const persist = async (next: ClaudePermissions) => {
    setPerms(next)
    await window.electronAPI.setClaudePermissions(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const add = async (key: ListKey) => {
    const val = inputs[key].trim()
    if (!val) return
    if (perms[key].includes(val)) return
    await persist({ ...perms, [key]: [...perms[key], val] })
    setInputs((prev) => ({ ...prev, [key]: '' }))
  }

  const remove = async (key: ListKey, entry: string) => {
    await persist({ ...perms, [key]: perms[key].filter((e) => e !== entry) })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal perms-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perms-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="perms-modal-title">Permissions</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body perms-body">
          <p className="field-hint perms-intro">
            These entries are written to <code>~/.claude/settings.json</code> and control which tools
            Claude Code may use without asking.
          </p>

          {LISTS.map(({ key, label, hint }) => (
            <div key={key} className="perms-section">
              <div className="perms-section-header">
                <span className={`perms-badge perms-badge-${key}`}>{label}</span>
                <span className="field-hint">{hint}</span>
              </div>

              <ul className="perms-list">
                {perms[key].length === 0 && (
                  <li className="perms-empty">No entries</li>
                )}
                {perms[key].map((entry) => (
                  <li key={entry} className="perms-entry">
                    <code className="perms-entry-text">{entry}</code>
                    <button
                      className="perms-remove"
                      onClick={() => remove(key, entry)}
                      aria-label={`Remove ${entry}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              <div className="perms-add-row">
                <input
                  className="perms-input"
                  value={inputs[key]}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && add(key)}
                  placeholder={`e.g. Bash(npm *)`}
                  spellCheck={false}
                  aria-label={`Add ${label} entry`}
                />
                <button
                  className="btn-primary small"
                  onClick={() => add(key)}
                  disabled={!inputs[key].trim()}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          {saved && <span className="perms-saved">✓ Saved</span>}
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
