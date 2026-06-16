import { useState } from 'react'
import { AuthStatus, AuthMode, ModelInfo, UiPrefs } from '../types'
import ModelPicker from './ModelPicker'
import './SettingsModal.css'

interface Props {
  auth: AuthStatus | null
  models: ModelInfo[]
  defaultModel: string
  onSetDefaultModel: (modelId: string) => void
  ui: UiPrefs | null
  onSetUi: (patch: Partial<UiPrefs>) => void
  onClose: () => void
  onChanged: () => Promise<AuthStatus> | void
  onManageAccounts: () => void
}

export default function SettingsModal({
  auth,
  models,
  defaultModel,
  onSetDefaultModel,
  ui,
  onSetUi,
  onClose,
  onChanged,
  onManageAccounts
}: Props) {
  const [mode, setMode] = useState<AuthMode>(auth?.mode ?? 'claude-code')
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedKey, setSavedKey] = useState(false)

  const claudeDetected = auth?.claudeCodeDetected ?? false
  const hasApiKey = auth?.hasApiKey ?? false

  const selectMode = async (m: AuthMode) => {
    setMode(m)
    setBusy(true)
    await window.electronAPI.setAuthMode(m)
    await onChanged()
    setBusy(false)
  }

  const saveKey = async () => {
    if (!key.trim()) return
    setBusy(true)
    await window.electronAPI.setApiKey(key.trim())
    await onChanged()
    setBusy(false)
    setSavedKey(true)
    setKey('')
    setTimeout(() => setSavedKey(false), 1500)
  }

  const removeKey = async () => {
    setBusy(true)
    await window.electronAPI.clearApiKey()
    await onChanged()
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Connection</h3>
          <button className="icon-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="auth-option-group">
            {/* Claude Code login */}
            <button
              className={`auth-option ${mode === 'claude-code' ? 'selected' : ''}`}
              onClick={() => selectMode('claude-code')}
              disabled={busy}
            >
              <div className="auth-option-radio">
                <span className={mode === 'claude-code' ? 'on' : ''} />
              </div>
              <div className="auth-option-body">
                <div className="auth-option-title">
                  Use my Claude Code account
                  {claudeDetected ? (
                    <span className="pill ok">Detected</span>
                  ) : (
                    <span className="pill warn">Not found</span>
                  )}
                </div>
                <div className="auth-option-desc">
                  Reuses the login from the Claude Code CLI on this machine — no API key
                  needed. {!claudeDetected && 'Run `claude` once and log in, then reopen this app.'}
                </div>
              </div>
            </button>

            {/* API key */}
            <button
              className={`auth-option ${mode === 'api-key' ? 'selected' : ''}`}
              onClick={() => selectMode('api-key')}
              disabled={busy}
            >
              <div className="auth-option-radio">
                <span className={mode === 'api-key' ? 'on' : ''} />
              </div>
              <div className="auth-option-body">
                <div className="auth-option-title">
                  Use an API key
                  {hasApiKey && <span className="pill ok">Saved</span>}
                </div>
                <div className="auth-option-desc">
                  Bills your Anthropic Console account. Stored encrypted in your OS keychain.
                </div>
              </div>
            </button>
          </div>

          <div className="form-group">
            <label>Claude accounts</label>
            <div className="model-setting-row">
              <button className="btn-primary small" onClick={onManageAccounts}>
                Manage accounts…
              </button>
              <span className="field-hint inline">
                Add more Claude logins and switch which one a chat runs under.
              </span>
            </div>
          </div>

          {mode === 'api-key' && (
            <div className="form-group api-key-section">
              <label>Anthropic API Key</label>
              <p className="field-hint">
                Get a key from{' '}
                <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
              </p>
              <div className="key-input-wrapper">
                <input
                  type={show ? 'text' : 'password'}
                  className="key-input"
                  placeholder={hasApiKey ? '•••••••• (saved) — enter to replace' : 'sk-ant-...'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                  spellCheck={false}
                />
                <button className="icon-btn show-btn" onClick={() => setShow((v) => !v)} title={show ? 'Hide' : 'Show'}>
                  {show ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="key-actions">
                <button className="btn-primary small" onClick={saveKey} disabled={!key.trim() || busy}>
                  {savedKey ? '✓ Saved' : 'Save key'}
                </button>
                {hasApiKey && (
                  <button className="btn-text" onClick={removeKey} disabled={busy}>
                    Remove saved key
                  </button>
                )}
              </div>
            </div>
          )}

          {ui && (
            <div className="form-group">
              <label>Appearance</label>
              <div className="appearance-grid">
                <div className="seg-field">
                  <span>Theme</span>
                  <div className="seg-control">
                    <button className={ui.theme === 'dark' ? 'on' : ''} onClick={() => onSetUi({ theme: 'dark' })}>Dark</button>
                    <button className={ui.theme === 'light' ? 'on' : ''} onClick={() => onSetUi({ theme: 'light' })}>Light</button>
                  </div>
                </div>
                <div className="seg-field">
                  <span>Density</span>
                  <div className="seg-control">
                    <button className={ui.density === 'comfortable' ? 'on' : ''} onClick={() => onSetUi({ density: 'comfortable' })}>Comfortable</button>
                    <button className={ui.density === 'compact' ? 'on' : ''} onClick={() => onSetUi({ density: 'compact' })}>Compact</button>
                  </div>
                </div>
                <div className="seg-field">
                  <span>Text size</span>
                  <div className="seg-control">
                    <button className={ui.fontSize === 'sm' ? 'on' : ''} onClick={() => onSetUi({ fontSize: 'sm' })}>S</button>
                    <button className={ui.fontSize === 'md' ? 'on' : ''} onClick={() => onSetUi({ fontSize: 'md' })}>M</button>
                    <button className={ui.fontSize === 'lg' ? 'on' : ''} onClick={() => onSetUi({ fontSize: 'lg' })}>L</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="form-group model-info">
            <label>Default model</label>
            <div className="model-setting-row">
              <ModelPicker models={models} value={defaultModel} onChange={onSetDefaultModel} />
              <span className="field-hint inline">New chats use this model. Change per-chat from the header.</span>
            </div>
            <p className="field-hint">Adaptive thinking · tools enabled (file edits auto-approved).</p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
