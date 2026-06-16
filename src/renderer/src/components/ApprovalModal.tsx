import { useEffect } from 'react'
import { ApprovalRequest } from '../types'
import DiffView from './DiffView'
import './ApprovalModal.css'

interface Props {
  request: ApprovalRequest
  onDecide: (allow: boolean) => void
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export default function ApprovalModal({ request, onDecide }: Props) {
  const { tool, input } = request

  // Keyboard: Enter = allow, Esc = deny.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDecide(true)
      else if (e.key === 'Escape') onDecide(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDecide])

  const filePath = str(input.file_path || input.path)

  const renderBody = () => {
    if (tool === 'Edit') {
      return <DiffView oldText={str(input.old_string)} newText={str(input.new_string)} />
    }
    if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
      return (
        <div className="approval-multi">
          {(input.edits as { old_string?: string; new_string?: string }[]).map((e, i) => (
            <div key={i} className="approval-multi-item">
              <div className="approval-multi-label">Edit {i + 1}</div>
              <DiffView oldText={str(e.old_string)} newText={str(e.new_string)} />
            </div>
          ))}
        </div>
      )
    }
    if (tool === 'Write') {
      return <DiffView oldText="" newText={str(input.content)} />
    }
    if (tool === 'Bash') {
      return (
        <div className="approval-command">
          <pre>{str(input.command)}</pre>
          {input.description ? <div className="approval-desc">{str(input.description)}</div> : null}
        </div>
      )
    }
    return <pre className="approval-json">{JSON.stringify(input, null, 2)}</pre>
  }

  const verb =
    tool === 'Bash' ? 'run a command' : tool === 'Write' ? 'create / overwrite a file' : 'edit a file'

  return (
    <div className="modal-backdrop">
      <div className="modal approval-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <span className="approval-tool">{tool}</span> wants to {verb}
          </h3>
        </div>
        {filePath && <div className="approval-path">{filePath}</div>}
        <div className="approval-body">{renderBody()}</div>
        <div className="modal-footer approval-footer">
          <button className="btn-secondary" onClick={() => onDecide(false)}>
            Deny <span className="kbd">Esc</span>
          </button>
          <button className="btn-primary" onClick={() => onDecide(true)}>
            Allow <span className="kbd">⌘↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
