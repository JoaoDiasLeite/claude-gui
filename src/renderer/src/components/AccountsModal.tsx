import { useEffect, useRef, useState } from 'react'
import { AgentCliStatus, CCAccountStatus } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './AccountsModal.css'

interface Props {
  onClose: () => void
  /** Called whenever the account list changes so the rest of the app can refresh. */
  onChanged: () => void
}

const AGENT_CLI_LABEL: Record<AgentCliStatus['id'], string> = { codex: 'Codex', gemini: 'Gemini' }

export default function AccountsModal({ onClose, onChanged }: Props) {
  const [accounts, setAccounts] = useState<CCAccountStatus[]>([])
  const [defaultId, setDefaultId] = useState('default')
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loginCmd, setLoginCmd] = useState<{ id: string; command: string } | null>(null)
  const [cliStatuses, setCliStatuses] = useState<AgentCliStatus[]>([])
  const [cliLoginCmd, setCliLoginCmd] = useState<{ id: string; command: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  const refresh = async () => {
    const list = await window.electronAPI.accountsList()
    setAccounts(list.accounts)
    setDefaultId(list.defaultAccountId)
    onChanged()
  }

  const refreshCliStatuses = async () => {
    const [codex, gemini] = await Promise.all([
      window.electronAPI.agentCliStatus('codex'),
      window.electronAPI.agentCliStatus('gemini')
    ])
    setCliStatuses([codex, gemini])
  }

  const loginCli = async (id: AgentCliStatus['id']) => {
    const res = await window.electronAPI.agentCliLogin(id)
    setCliLoginCmd({ id, command: res.command })
  }

  useEffect(() => {
    refresh()
    refreshCliStatuses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addAccount = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const acc = await window.electronAPI.accountsAdd(name)
    setNewName('')
    await refresh()
    setBusy(false)
    // Immediately kick off login for the freshly created account.
    login(acc.id)
  }

  const login = async (id: string) => {
    const res = await window.electronAPI.accountsLogin(id)
    setLoginCmd({ id, command: res.command })
  }

  const startRename = (a: CCAccountStatus) => {
    setEditingId(a.id)
    setEditName(a.name)
  }

  const saveRename = async () => {
    if (!editingId) return
    setBusy(true)
    await window.electronAPI.accountsRename(editingId, editName)
    setEditingId(null)
    await refresh()
    setBusy(false)
  }

  const remove = async (id: string) => {
    setBusy(true)
    await window.electronAPI.accountsRemove(id)
    if (loginCmd?.id === id) setLoginCmd(null)
    await refresh()
    setBusy(false)
  }

  const makeDefault = async (id: string) => {
    setBusy(true)
    await window.electronAPI.accountsSetDefault(id)
    await refresh()
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal accounts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="accounts-modal-title">Accounts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <p className="field-hint">
            Each account is a separate Claude Code login. Pick one per chat from the account
            menu in the chat header. New chats start under the default account.
          </p>

          <div className="account-rows">
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <span className={`account-dot ${a.loggedIn ? 'ok' : 'warn'}`} />
                <div className="account-row-body">
                  {editingId === a.id ? (
                    <input
                      className="account-rename-input"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={saveRename}
                    />
                  ) : (
                    <div className="account-row-name">
                      {a.name}
                      {a.id === defaultId && <span className="status-pill">Default</span>}
                      {!a.loggedIn && <span className="status-pill warn">Not logged in</span>}
                    </div>
                  )}
                  <div className="account-row-meta">
                    {a.loggedIn
                      ? [a.email, a.org, a.plan].filter(Boolean).join(' · ') || 'Logged in'
                      : a.isDefault
                        ? 'Uses this machine’s Claude Code login'
                        : 'Run the login to authenticate this account'}
                  </div>
                </div>

                <div className="account-row-actions">
                  {!a.loggedIn || !a.isDefault ? (
                    <button className="btn-text" onClick={() => login(a.id)} disabled={busy}>
                      {a.loggedIn ? 'Re-login' : 'Log in'}
                    </button>
                  ) : null}
                  {a.id !== defaultId && (
                    <button className="btn-text" onClick={() => makeDefault(a.id)} disabled={busy}>
                      Set default
                    </button>
                  )}
                  <button className="btn-text" onClick={() => startRename(a)} disabled={busy}>
                    Rename
                  </button>
                  {!a.isDefault && (
                    <button className="btn-text danger" onClick={() => remove(a.id)} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {loginCmd && (
            <div className="login-hint">
              <div className="login-hint-title">Finish logging in</div>
              <p className="field-hint">
                A terminal should have opened — complete the login in your browser, then click
                Refresh. If no terminal opened, run this command yourself:
              </p>
              <code className="login-cmd">{loginCmd.command}</code>
              <div className="login-hint-actions">
                <button className="btn-primary small" onClick={refresh} disabled={busy}>
                  Refresh status
                </button>
                <button className="btn-text" onClick={() => setLoginCmd(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="add-account">
            <input
              className="add-account-input"
              placeholder="New account name (e.g. Work, Personal)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAccount()}
              spellCheck={false}
            />
            <button className="btn-primary small" onClick={addAccount} disabled={!newName.trim() || busy}>
              Add &amp; log in
            </button>
          </div>

          <h4 className="accounts-section-title">Other engines</h4>
          <p className="field-hint">
            Codex and Gemini reuse their own CLI&rsquo;s login — no API key needed here.
          </p>

          <div className="account-rows">
            {cliStatuses.map((s) => (
              <div className="account-row" key={s.id}>
                <span className={`account-dot ${s.loggedIn ? 'ok' : 'warn'}`} />
                <div className="account-row-body">
                  <div className="account-row-name">
                    {AGENT_CLI_LABEL[s.id]}
                    {!s.installed && <span className="status-pill warn">Not installed</span>}
                    {s.installed && !s.loggedIn && <span className="status-pill warn">Not logged in</span>}
                  </div>
                  <div className="account-row-meta">
                    {s.loggedIn ? [s.email, s.plan].filter(Boolean).join(' · ') || 'Logged in' : s.detail}
                  </div>
                </div>
                <div className="account-row-actions">
                  {s.installed && (
                    <button className="btn-text" onClick={() => loginCli(s.id)}>
                      {s.loggedIn ? 'Re-login' : 'Log in'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {cliLoginCmd && (
            <div className="login-hint">
              <div className="login-hint-title">Finish logging in</div>
              <p className="field-hint">
                A terminal should have opened — complete the login there, then click Refresh. If
                no terminal opened, run this command yourself:
              </p>
              <code className="login-cmd">{cliLoginCmd.command}</code>
              <div className="login-hint-actions">
                <button
                  className="btn-primary small"
                  onClick={() => {
                    refreshCliStatuses()
                  }}
                >
                  Refresh status
                </button>
                <button className="btn-text" onClick={() => setCliLoginCmd(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
