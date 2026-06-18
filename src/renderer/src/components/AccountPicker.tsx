import { useState, useRef, useEffect } from 'react'
import { CCAccountStatus } from '../types'
import './AccountPicker.css'

interface Props {
  accounts: CCAccountStatus[]
  value?: string
  onChange: (accountId: string) => void
  onManage: () => void
  compact?: boolean
  disabled?: boolean
}

export default function AccountPicker({ accounts, value, onChange, onManage, compact, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = accounts.find((a) => a.id === value) ?? accounts.find((a) => a.isDefault) ?? accounts[0]

  return (
    <div className={`account-picker ${compact ? 'compact' : ''}`} ref={ref}>
      <button className="account-picker-btn" onClick={() => setOpen((v) => !v)} disabled={disabled} title="Account for this chat" aria-haspopup="listbox" aria-expanded={open}>
        <span className={`account-dot ${current?.loggedIn ? 'ok' : 'warn'}`} />
        <span className="account-picker-label">{current?.name ?? 'Account'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="account-picker-menu">
          {accounts.map((a) => (
            <button
              key={a.id}
              className={`account-picker-item ${a.id === current?.id ? 'selected' : ''}`}
              onClick={() => {
                onChange(a.id)
                setOpen(false)
              }}
            >
              <div className="account-picker-item-main">
                <span className={`account-dot ${a.loggedIn ? 'ok' : 'warn'}`} />
                <span className="account-picker-item-name">{a.name}</span>
                {a.id === current?.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div className="account-picker-item-meta">
                {a.loggedIn
                  ? [a.email, a.plan].filter(Boolean).join(' · ') || 'Logged in'
                  : 'Not logged in'}
              </div>
            </button>
          ))}
          <button
            className="account-picker-manage"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            Manage accounts…
          </button>
        </div>
      )}
    </div>
  )
}
