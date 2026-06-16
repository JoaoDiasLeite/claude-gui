import { useEffect, useState } from 'react'
import { ClaudeMdFile } from '../types'
import './ClaudeMdModal.css'

interface Props {
  projectPath?: string
  onClose: () => void
}

export default function ClaudeMdModal({ projectPath, onClose }: Props) {
  const [files, setFiles] = useState<ClaudeMdFile[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electronAPI.claudeMdRead(projectPath).then((fs) => {
      setFiles(fs)
      if (fs.length) setContent(fs[0].content)
    })
  }, [projectPath])

  const active = files[activeIdx]

  const selectFile = (idx: number) => {
    setActiveIdx(idx)
    setContent(files[idx].content)
    setDirty(false)
  }

  const save = async () => {
    if (!active) return
    await window.electronAPI.claudeMdWrite(active.path, content)
    const updated = [...files]
    updated[activeIdx] = { ...active, content, exists: true }
    setFiles(updated)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal claudemd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>CLAUDE.md</h3>
          <button className="icon-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="claudemd-tabs">
          {files.map((f, i) => (
            <button
              key={f.path}
              className={`claudemd-tab ${i === activeIdx ? 'active' : ''}`}
              onClick={() => selectFile(i)}
              title={f.path}
            >
              {f.scope === 'project' ? 'Project' : 'Global (~/.claude)'}
              {!f.exists && <span className="claudemd-new">new</span>}
            </button>
          ))}
        </div>

        {active && <div className="claudemd-path">{active.path}</div>}

        <textarea
          className="claudemd-editor"
          value={content}
          onChange={(e) => { setContent(e.target.value); setDirty(true) }}
          placeholder="# Project instructions for Claude…&#10;&#10;Describe conventions, architecture, and anything Claude should always know."
          spellCheck={false}
        />

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className={`btn-primary ${saved ? 'saved' : ''}`} onClick={save} disabled={!dirty && !saved}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
