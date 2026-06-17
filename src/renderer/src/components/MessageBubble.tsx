import { useState, useRef } from 'react'
import { Message, ToolCall } from '../types'
import Markdown from './Markdown'
import './MessageBubble.css'

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button className="message-copy" onClick={copy} title="Copy message">
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

interface Props {
  message: Message
  streaming: boolean
  /** Defined only on the last assistant message when it ended in an error. */
  onRetry?: () => void
  onEditResend: (messageId: string, newText: string) => void
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const primary =
      obj.file_path ?? obj.path ?? obj.command ?? obj.pattern ?? obj.query ?? obj.url
    if (primary) return String(primary)
    return Object.keys(obj).length ? JSON.stringify(obj).slice(0, 80) : ''
  }
  return input ? String(input).slice(0, 80) : ''
}

const RESULT_TRUNCATE = 2000

function ToolResultBody({ result }: { result: string }) {
  const [expanded, setExpanded] = useState(false)
  if (result.length <= RESULT_TRUNCATE) {
    return <pre>{result || '(no output)'}</pre>
  }
  if (expanded) {
    return (
      <>
        <pre>{result}</pre>
        <button className="tool-result-toggle" onClick={() => setExpanded(false)}>
          Show less
        </button>
      </>
    )
  }
  const remaining = result.length - RESULT_TRUNCATE
  return (
    <>
      <pre>{result.slice(0, RESULT_TRUNCATE)}</pre>
      <button className="tool-result-toggle" onClick={() => setExpanded(true)}>
        Show full output ({remaining.toLocaleString()} more chars)
      </button>
    </>
  )
}

function ToolCallView({ call }: { call: ToolCall }) {
  return (
    <details className={`tool-call ${call.isError ? 'error' : ''}`}>
      <summary>
        <span className="tool-call-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </span>
        <span className="tool-call-name">{call.tool}</span>
        <span className="tool-call-arg">{summarizeInput(call.input)}</span>
        {call.result === undefined && <span className="tool-call-spin" />}
      </summary>
      <div className="tool-call-detail">
        <div className="tool-call-section-label">Input</div>
        <pre>{JSON.stringify(call.input, null, 2)}</pre>
        {call.result !== undefined && (
          <>
            <div className="tool-call-section-label">{call.isError ? 'Error' : 'Result'}</div>
            <ToolResultBody result={call.result} />
          </>
        )}
      </div>
    </details>
  )
}

export default function MessageBubble({ message, streaming, onRetry, onEditResend }: Props) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = () => {
    setEditText(message.content)
    setEditing(true)
    // Focus textarea after render
    setTimeout(() => editRef.current?.focus(), 0)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditText(message.content)
  }

  const saveEdit = () => {
    if (!editText.trim() || streaming) return
    setEditing(false)
    onEditResend(message.id, editText)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { cancelEdit(); return }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { saveEdit() }
  }

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-avatar">
        {isUser ? (
          <div className="avatar user-avatar">U</div>
        ) : (
          <div className="avatar claude-avatar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
      <div className="message-body">
        <div className="message-head">
          <span className="message-role">{isUser ? 'You' : 'Claude'}</span>
          <CopyMessage text={message.content} />
          {isUser && !editing && (
            <button
              className="message-edit"
              onClick={startEdit}
              title="Edit and resend"
              aria-label="Edit and resend"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls">
            {message.toolCalls.map((call) => (
              <ToolCallView key={call.id} call={call} />
            ))}
          </div>
        )}
        {isUser && editing ? (
          <div className="message-edit-area">
            <textarea
              ref={editRef}
              className="message-edit-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={Math.max(2, editText.split('\n').length)}
              aria-label="Edit message"
            />
            <div className="message-edit-actions">
              <button
                className="message-edit-save"
                onClick={saveEdit}
                disabled={streaming || !editText.trim()}
                aria-label="Save and rerun"
              >
                Save &amp; rerun
              </button>
              <button
                className="message-edit-cancel"
                onClick={cancelEdit}
                aria-label="Cancel edit"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : message.content ? (
          <div className="message-content">
            {isUser ? (
              <div className="user-text">{message.content}</div>
            ) : (
              <Markdown content={message.content} />
            )}
          </div>
        ) : (
          streaming && (!message.toolCalls || message.toolCalls.length === 0) && (
            <div className="typing-indicator"><span /><span /><span /></div>
          )
        )}
        {streaming && message.content && <span className="cursor-blink" />}
        {onRetry && (
          <button
            className="message-retry"
            onClick={onRetry}
            disabled={streaming}
            aria-label="Retry this turn"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.71" />
            </svg>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
