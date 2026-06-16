import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'

export interface CommandItem {
  id: string
  title: string
  subtitle?: string
  group: string
  run: () => void
}

interface Props {
  items: CommandItem[]
  onClose: () => void
}

export default function CommandPalette({ items, onClose }: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return items.slice(0, 50)
    const scored = items
      .map((it) => {
        const hay = `${it.title} ${it.subtitle ?? ''} ${it.group}`.toLowerCase()
        const idx = hay.indexOf(query)
        return { it, score: idx < 0 ? -1 : idx }
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => a.score - b.score)
    return scored.slice(0, 50).map((s) => s.it)
  }, [q, items])

  useEffect(() => {
    setActive(0)
  }, [q])

  useEffect(() => {
    const el = listRef.current?.querySelector('.cmd-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (i: number) => {
    const it = filtered[i]
    if (it) {
      it.run()
      onClose()
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Group consecutive items by group label.
  let lastGroup = ''

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="cmd-input"
          placeholder="Jump to a session, project, view, or model…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        <div className="cmd-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmd-empty">No matches</div>}
          {filtered.map((it, i) => {
            const showGroup = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id}>
                {showGroup && <div className="cmd-group">{it.group}</div>}
                <div
                  className={`cmd-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(i)}
                >
                  <span className="cmd-item-title">{it.title}</span>
                  {it.subtitle && <span className="cmd-item-sub">{it.subtitle}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="cmd-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
