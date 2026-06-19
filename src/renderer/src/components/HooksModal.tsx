import { useEffect, useRef, useState } from 'react'
import { ClaudeHooks, ClaudeHookEntry, HOOK_EVENTS, HookEvent } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './HooksModal.css'

interface Props {
  onClose: () => void
}

interface NewHookForm {
  event: HookEvent
  matcher: string
  command: string
}

const EMPTY_FORM: NewHookForm = { event: 'PreToolUse', matcher: '', command: '' }

export default function HooksModal({ onClose }: Props) {
  const [hooks, setHooks] = useState<ClaudeHooks>({})
  const [form, setForm] = useState<NewHookForm>(EMPTY_FORM)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  useEffect(() => {
    window.electronAPI.getClaudeHooks().then(setHooks)
  }, [])

  const persist = async (next: ClaudeHooks) => {
    setSaveError(null)
    const result = await window.electronAPI.setClaudeHooks(next)
    if (!result.ok) {
      setSaveError(result.error ?? 'Unknown error saving hooks')
      return
    }
    // Use the merged hooks returned by the main process (includes unknown events)
    setHooks(result.hooks ?? next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const addHook = async () => {
    const cmd = form.command.trim()
    if (!cmd) return
    const entry: ClaudeHookEntry = {
      hooks: [{ type: 'command', command: cmd }]
    }
    if (form.matcher.trim()) entry.matcher = form.matcher.trim()

    const existing = hooks[form.event] ?? []
    await persist({ ...hooks, [form.event]: [...existing, entry] })
    setForm(EMPTY_FORM)
  }

  const removeHook = async (event: string, idx: number) => {
    const list = (hooks[event] ?? []).filter((_, i) => i !== idx)
    const next = { ...hooks }
    if (list.length === 0) {
      // Send empty array so setClaudeHooks knows to delete the key
      next[event] = []
    } else {
      next[event] = list
    }
    await persist(next)
  }

  // Display all known events that have entries, plus any unknown event keys from file
  const knownEventSet = new Set<string>(HOOK_EVENTS)
  const allEventKeys = [
    ...HOOK_EVENTS.filter((ev) => hooks[ev]?.length),
    ...Object.keys(hooks).filter((k) => !knownEventSet.has(k) && hooks[k]?.length)
  ]

  const hasAny = Object.keys(hooks).some((k) => hooks[k]?.length > 0)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal hooks-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hooks-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="hooks-modal-title">Hooks</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body hooks-body">
          <p className="field-hint hooks-intro">
            Shell commands Claude Code runs automatically on lifecycle events. Written to{' '}
            <code>~/.claude/settings.json</code>.
          </p>

          {saveError && (
            <div className="hooks-error" role="alert">
              {saveError}
            </div>
          )}

          {/* Configured hooks list */}
          {hasAny ? (
            <div className="hooks-list">
              {allEventKeys.map((event) => (
                <div key={event} className="hooks-group">
                  <div className="hooks-group-label">{event}</div>
                  {(hooks[event] ?? []).map((entry, idx) => (
                    <div key={idx} className="hooks-entry">
                      <div className="hooks-entry-meta">
                        {entry.matcher && (
                          <span className="hooks-matcher" title="Matcher (tool glob)">
                            {entry.matcher}
                          </span>
                        )}
                      </div>
                      <code className="hooks-command">{entry.hooks[0]?.command ?? ''}</code>
                      <button
                        className="perms-remove"
                        onClick={() => removeHook(event, idx)}
                        aria-label={`Remove hook ${idx} from ${event}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="hooks-empty">No hooks configured.</p>
          )}

          {/* Add hook form */}
          <div className="hooks-form">
            <div className="hooks-form-title">Add hook</div>

            <div className="hooks-form-row">
              <label className="hooks-form-label">Event</label>
              <select
                className="hooks-select"
                value={form.event}
                onChange={(e) => setForm((f) => ({ ...f, event: e.target.value as HookEvent }))}
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
            </div>

            <div className="hooks-form-row">
              <label className="hooks-form-label">Matcher <span className="hooks-optional">(optional)</span></label>
              <input
                className="hooks-input"
                value={form.matcher}
                onChange={(e) => setForm((f) => ({ ...f, matcher: e.target.value }))}
                placeholder="Tool name glob, e.g. Bash"
                spellCheck={false}
              />
            </div>

            <div className="hooks-form-row">
              <label className="hooks-form-label">Command</label>
              <input
                className="hooks-input"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addHook()}
                placeholder="Shell command to run"
                spellCheck={false}
              />
            </div>

            <div className="hooks-form-actions">
              <button
                className="btn-primary small"
                onClick={addHook}
                disabled={!form.command.trim()}
              >
                Add hook
              </button>
            </div>
          </div>

          {/* JSON preview */}
          <div className="hooks-json-toggle">
            <button className="btn-text" onClick={() => setShowJson((v) => !v)}>
              {showJson ? 'Hide JSON' : 'Show resulting JSON'}
            </button>
          </div>
          {showJson && (
            <pre className="hooks-json">{JSON.stringify(hooks, null, 2)}</pre>
          )}
        </div>

        <div className="modal-footer">
          {saved && <span className="perms-saved">✓ Saved</span>}
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
