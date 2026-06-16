import { useEffect, useRef } from 'react'
import { TermLine } from '../types'
import './TerminalPanel.css'

interface Props {
  lines: TermLine[]
  open: boolean
  onToggle: () => void
  onClear: () => void
}

const PREFIX: Record<TermLine['kind'], string> = {
  user: '▶',
  thinking: '~',
  tool: '⚙',
  result: '←',
  error: '✗',
  info: '·'
}

export default function TerminalPanel({ lines, open, onToggle, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, open])

  return (
    <div className={`terminal-panel ${open ? 'open' : ''}`}>
      <div className="terminal-header" onClick={onToggle}>
        <div className="terminal-title">
          <span className="terminal-dot" />
          <span>Activity</span>
          {lines.length > 0 && <span className="terminal-count">{lines.length}</span>}
        </div>
        <div className="terminal-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={onClear} title="Clear">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button className="icon-btn" onClick={onToggle} title={open ? 'Collapse' : 'Expand'}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div className="terminal-body">
          {lines.length === 0 ? (
            <div className="terminal-empty">No activity yet. Tool calls and thinking will appear here.</div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={`terminal-line ${line.kind}`}>
                <span className="terminal-prefix">{PREFIX[line.kind]}</span>
                <span className="terminal-text">{line.text}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
