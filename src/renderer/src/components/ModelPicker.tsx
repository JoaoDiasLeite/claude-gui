import { useState, useRef, useEffect } from 'react'
import { ModelInfo } from '../types'
import './ModelPicker.css'

interface Props {
  models: ModelInfo[]
  value: string
  onChange: (modelId: string) => void
  compact?: boolean
}

export default function ModelPicker({ models, value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = models.find((m) => value.startsWith(m.id)) ?? models[0]

  return (
    <div className={`model-picker ${compact ? 'compact' : ''}`} ref={ref}>
      <button className="model-picker-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="model-picker-label">{current?.label ?? value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="model-picker-menu">
          {models.map((m) => (
            <button
              key={m.id}
              className={`model-picker-item ${m.id === current?.id ? 'selected' : ''}`}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
            >
              <div className="model-picker-item-main">
                <span className="model-picker-item-name">{m.label}</span>
                {m.id === current?.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div className="model-picker-item-meta">
                {m.context} · ${m.inputPrice}/${m.outputPrice} per Mtok
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
