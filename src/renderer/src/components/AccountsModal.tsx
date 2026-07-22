import { useEffect, useRef, useState } from 'react'
import { AgentProvider, CCAccountStatus, ProviderAccountStatus } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './AccountsModal.css'

interface Props {
  onClose: () => void
  /** Called whenever the account list changes so the rest of the app can refresh. */
  onChanged: () => void
}

const PROVIDER_LABEL: Record<AgentProvider, string> = { codex: 'Codex', gemini: 'Gemini' }

interface ProviderUiState {
  accounts: ProviderAccountStatus[]
  defaultId: string
  newName: string
  editingId: string | null
  editName: string
  loginCmd: { id: string; command: string } | null
}

const emptyProviderState: ProviderUiState = {
  accounts: [],
  defaultId: 'default',
  newName: '',
  editingId: null,
  editName: '',
  loginCmd: null
}

export default function AccountsModal({ onClose, onChanged }: Props) {
  const [accounts, setAccounts] = useState<CCAccountStatus[]>([])
  const [defaultId, setDefaultId] = useState('default')
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loginCmd, setLoginCmd] = useState<{ id: string; command: string } | null>(null)
  const [providerUi, setProviderUi] = useState<Record<AgentProvider, ProviderUiState>>({
    codex: emptyProviderState,
    gemini: emptyProviderState
  })
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onClose)

  const refresh = async () => {
    const list = await window.electronAPI.accountsList()
    setAccounts(list.accounts)
    setDefaultId(list.defaultAccountId)
    onChanged()
  }

  const updateProvider = (p: AgentProvider, patch: Partial<ProviderUiState>) =>
    setProviderUi((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }))

  const refreshProvider = async (p: AgentProvider) => {
    const list = await window.electronAPI.providerAccountsList(p)
    updateProvider(p, { accounts: list.accounts, defaultId: list.defaultAccountId })
    onChanged()
  }

  useEffect(() => {
    refresh()
    refreshProvider('codex')
    refreshProvider('gemini')
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

  // ─── Codex / Gemini account actions — same shape as the Claude ones above,
  // parameterized by provider so both sections share one implementation. ────

  const addProviderAccount = async (p: AgentProvider) => {
    const name = providerUi[p].newName.trim()
    if (!name) return
    setBusy(true)
    const acc = await window.electronAPI.providerAccountsAdd(p, name)
    updateProvider(p, { newName: '' })
    await refreshProvider(p)
    setBusy(false)
    loginProviderAccount(p, acc.id)
  }

  const loginProviderAccount = async (p: AgentProvider, id: string) => {
    const res = await window.electronAPI.providerAccountsLogin(p, id)
    updateProvider(p, { loginCmd: { id, command: res.command } })
  }

  const startRenameProvider = (p: AgentProvider, a: ProviderAccountStatus) => {
    updateProvider(p, { editingId: a.id, editName: a.name })
  }

  const saveRenameProvider = async (p: AgentProvider) => {
    const editingId = providerUi[p].editingId
    if (!editingId) return
    setBusy(true)
    await window.electronAPI.providerAccountsRename(p, editingId, providerUi[p].editName)
    updateProvider(p, { editingId: null })
    await refreshProvider(p)
    setBusy(false)
  }

  const removeProviderAccount = async (p: AgentProvider, id: string) => {
    setBusy(true)
    await window.electronAPI.providerAccountsRemove(p, id)
    if (providerUi[p].loginCmd?.id === id) updateProvider(p, { loginCmd: null })
    await refreshProvider(p)
    setBusy(false)
  }

  const makeDefaultProvider = async (p: AgentProvider, id: string) => {
    setBusy(true)
    await window.electronAPI.providerAccountsSetDefault(p, id)
    await refreshProvider(p)
    setBusy(false)
  }

  const renderProviderSection = (p: AgentProvider) => {
    const ui = providerUi[p]
    return (
      <div key={p}>
        <h4 className="accounts-section-title">{PROVIDER_LABEL[p]} accounts</h4>
        <p className="field-hint">
          Each account is a separate {PROVIDER_LABEL[p]} login. Switch the active account from
          the sidebar account picker when a {PROVIDER_LABEL[p]} model is selected.
        </p>

        <div className="account-rows">
          {ui.accounts.map((a) => (
            <div className="account-row" key={a.id}>
              <span className={`account-dot ${a.loggedIn ? 'ok' : 'warn'}`} />
              <div className="account-row-body">
                {ui.editingId === a.id ? (
                  <input
                    className="account-rename-input"
                    value={ui.editName}
                    autoFocus
                    onChange={(e) => updateProvider(p, { editName: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRenameProvider(p)
                      if (e.key === 'Escape') updateProvider(p, { editingId: null })
                    }}
                    onBlur={() => saveRenameProvider(p)}
                  />
                ) : (
                  <div className="account-row-name">
                    {a.name}
                    {a.id === ui.defaultId && <span className="status-pill">Default</span>}
                    {!a.loggedIn && <span className="status-pill warn">Not logged in</span>}
                  </div>
                )}
                <div className="account-row-meta">
                  {a.loggedIn
                    ? [a.email, a.plan].filter(Boolean).join(' · ') || 'Logged in'
                    : a.isDefault
                      ? `Uses this machine’s ${PROVIDER_LABEL[p]} CLI login`
                      : 'Run the login to authenticate this account'}
                </div>
              </div>

              <div className="account-row-actions">
                {!a.loggedIn || !a.isDefault ? (
                  <button className="btn-text" onClick={() => loginProviderAccount(p, a.id)} disabled={busy}>
                    {a.loggedIn ? 'Re-login' : 'Log in'}
                  </button>
                ) : null}
                {a.id !== ui.defaultId && (
                  <button className="btn-text" onClick={() => makeDefaultProvider(p, a.id)} disabled={busy}>
                    Set default
                  </button>
                )}
                <button className="btn-text" onClick={() => startRenameProvider(p, a)} disabled={busy}>
                  Rename
                </button>
                {!a.isDefault && (
                  <button className="btn-text danger" onClick={() => removeProviderAccount(p, a.id)} disabled={busy}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {ui.loginCmd && (
          <div className="login-hint">
            <div className="login-hint-title">Finish logging in</div>
            <p className="field-hint">
              A terminal should have opened — complete the login in your browser, then click
              Refresh. If no terminal opened, run this command yourself:
            </p>
            <code className="login-cmd">{ui.loginCmd.command}</code>
            <div className="login-hint-actions">
              <button className="btn-primary small" onClick={() => refreshProvider(p)} disabled={busy}>
                Refresh status
              </button>
              <button className="btn-text" onClick={() => updateProvider(p, { loginCmd: null })}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="add-account">
          <input
            className="add-account-input"
            placeholder={`New ${PROVIDER_LABEL[p]} account name (e.g. Work, Personal)`}
            value={ui.newName}
            onChange={(e) => updateProvider(p, { newName: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addProviderAccount(p)}
            spellCheck={false}
          />
          <button
            className="btn-primary small"
            onClick={() => addProviderAccount(p)}
            disabled={!ui.newName.trim() || busy}
          >
            Add &amp; log in
          </button>
        </div>
      </div>
    )
  }

  const renderAntigravitySection = () => {
    return (
      <div>
        <h4 className="accounts-section-title">Antigravity</h4>
        <p className="field-hint">
          Gemini models run through Antigravity (Google's agentic CLI, launched with{' '}
          <code>agy</code>). It uses a single machine-wide login stored in your OS keyring, so
          there's just one account.
        </p>

        <div className="account-rows">
          <div className="account-row">
            <span className="account-dot ok" />
            <div className="account-row-body">
              <div className="account-row-name">Antigravity</div>
              <div className="account-row-meta">
                Machine-wide login via <code>agy</code> — stored in your OS keyring
              </div>
            </div>

            <div className="account-row-actions">
              <button
                className="btn-text"
                onClick={() => loginProviderAccount('gemini', 'default')}
                disabled={busy}
              >
                Log in / re-auth
              </button>
            </div>
          </div>
        </div>

        <p className="field-hint">
          "Log in / re-auth" opens Antigravity (<code>agy</code>) in a terminal — complete the
          Google sign-in there.
        </p>
      </div>
    )
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
          <h4 className="accounts-section-title">Claude accounts</h4>
          <p className="field-hint">
            Each account is a separate Claude Code login. Switch the active account from the
            account picker in the sidebar; new chats use the selected account.
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

          {renderProviderSection('codex')}
          {renderAntigravitySection()}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
