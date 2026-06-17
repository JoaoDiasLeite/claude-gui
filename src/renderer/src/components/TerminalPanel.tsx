import { useEffect, useRef, useState, useCallback } from 'react'
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

const HEADER_HEIGHT = 36
const MIN_BODY_HEIGHT = 100
const MAX_BODY_HEIGHT = 600
const DEFAULT_BODY_HEIGHT = 184 // 220px total - 36px header
const STORAGE_KEY = 'terminal-height'

export default function TerminalPanel({ lines, open, onToggle, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) return Math.min(MAX_BODY_HEIGHT, Math.max(MIN_BODY_HEIGHT, parsed))
    }
    return DEFAULT_BODY_HEIGHT
  })
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, open])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return
    // dragging up (negative delta) increases height
    const delta = startYRef.current - e.clientY
    const next = Math.min(MAX_BODY_HEIGHT, Math.max(MIN_BODY_HEIGHT, startHeightRef.current + delta))
    setBodyHeight(next)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    setBodyHeight((h) => {
      localStorage.setItem(STORAGE_KEY, String(h))
      return h
    })
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    startYRef.current = e.clientY
    startHeightRef.current = bodyHeight
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [bodyHeight, handleMouseMove, handleMouseUp])

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const totalHeight = open ? HEADER_HEIGHT + bodyHeight : HEADER_HEIGHT

  return (
    <div
      className={`terminal-panel ${open ? 'open' : ''}`}
      style={open ? { maxHeight: totalHeight, height: totalHeight } : undefined}
    >
      {open && (
        <div className="terminal-resize-handle" onMouseDown={handleResizeMouseDown} />
      )}
      <div className="terminal-header" onClick={onToggle}>
        <div className="terminal-title">
          <span className="terminal-dot" />
          <span>Activity</span>
          {lines.length > 0 && <span className="terminal-count">{lines.length}</span>}
        </div>
        <div className="terminal-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={onClear} title="Clear" aria-label="Clear activity log">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button className="icon-btn" onClick={onToggle} title={open ? 'Collapse' : 'Expand'} aria-label={open ? 'Collapse activity panel' : 'Expand activity panel'}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}
              aria-hidden="true"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div className="terminal-body" style={{ height: bodyHeight }}>
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
