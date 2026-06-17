import { useState } from 'react'
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

export default function MessageBubble({ message, streaming }: Props) {
  const isUser = message.role === 'user'

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
        </div>
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls">
            {message.toolCalls.map((call) => (
              <ToolCallView key={call.id} call={call} />
            ))}
          </div>
        )}
        {message.content ? (
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
      </div>
    </div>
  )
}
