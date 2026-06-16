import { useEffect, useRef, useState } from 'react'
import { Session, ModelInfo, ImageAttachment, CCAccountStatus } from '../types'
import MessageBubble from './MessageBubble'
import ModelPicker from './ModelPicker'
import AccountPicker from './AccountPicker'
import './Chat.css'

interface Props {
  session?: Session
  streaming: boolean
  onSendMessage: (text: string, images?: { mediaType: string; data: string }[]) => void
  onStop: () => void
  onOpenSettings: () => void
  ready: boolean
  models: ModelInfo[]
  currentModel: string
  onModelChange: (modelId: string) => void
  accounts: CCAccountStatus[]
  currentAccount?: string
  onAccountChange: (accountId: string) => void
  onManageAccounts: () => void
  onOpenClaudeMd: () => void
  autoApprove: boolean
  onToggleAutoApprove: () => void
  onOpenCheckpoints: () => void
  onOpenGit: () => void
}

export default function Chat({
  session,
  streaming,
  onSendMessage,
  onStop,
  onOpenSettings,
  ready,
  models,
  currentModel,
  onModelChange,
  accounts,
  currentAccount,
  onAccountChange,
  onManageAccounts,
  onOpenClaudeMd,
  autoApprove,
  onToggleAutoApprove,
  onOpenCheckpoints,
  onOpenGit
}: Props) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages])

  const handleSend = () => {
    if (streaming) {
      onStop()
      return
    }
    const text = input.trim()
    if (!text && attachments.length === 0) return
    const images = attachments.map((a) => ({ mediaType: a.mediaType, data: a.data }))
    setInput('')
    setAttachments([])
    resetTextareaHeight()
    onSendMessage(text || 'Describe these image(s).', images.length ? images : undefined)
  }

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const data = result.split(',')[1] ?? ''
        setAttachments((prev) => [...prev, { mediaType: file.type, data, preview: result }])
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    addFiles(imageItems.map((i) => i.getAsFile()).filter((f): f is File => !!f))
  }

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !streaming) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const isEmpty = !session || session.messages.length === 0

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="chat-title">
          {session?.agentName && <span className="chat-agent-badge">{session.agentName}</span>}
          {session?.name || 'New chat'}
          {session?.projectPath && (
            <span className="chat-project" title={session.projectPath}>
              {session.projectPath.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          )}
          {session?.claudeSessionId && <span className="chat-resumed" title="Resumed Claude Code session">resumed</span>}
          {session?.remoteHostName && (
            <span className="chat-remote" title="Running on remote host over SSH">⇄ {session.remoteHostName}</span>
          )}
        </div>
        <div className="chat-header-right">
          <button
            className={`approve-toggle ${autoApprove ? 'auto' : 'ask'}`}
            onClick={onToggleAutoApprove}
            title={autoApprove ? 'Auto-approving all tools — click to require approval' : 'Asking before file edits & commands — click to auto-approve'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {autoApprove ? (
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              ) : (
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              )}
            </svg>
            {autoApprove ? 'Auto' : 'Approve'}
          </button>
          <button className="header-icon-btn" onClick={onOpenGit} title="Git">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="9" r="3" />
              <path d="M18 12a9 9 0 0 1-9 9M6 9v6" />
            </svg>
          </button>
          <button className="header-icon-btn" onClick={onOpenCheckpoints} title="Checkpoints / timeline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
            </svg>
          </button>
          <button className="header-icon-btn" onClick={onOpenClaudeMd} title="Edit CLAUDE.md">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </button>
          {accounts.length > 1 && (
            <AccountPicker
              accounts={accounts}
              value={currentAccount}
              onChange={onAccountChange}
              onManage={onManageAccounts}
              compact
            />
          )}
          {models.length > 0 && (
            <ModelPicker models={models} value={currentModel} onChange={onModelChange} compact />
          )}
          {!ready && (
            <button className="header-btn warning" onClick={onOpenSettings}>
              Connect account
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {isEmpty ? (
          <div className="welcome">
            <div className="welcome-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="var(--accent)" strokeWidth="1" />
                <path d="M8 12h8M12 8v8" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h2>How can I help?</h2>
            <p>Start a conversation with Claude. You can also open a project folder in the sidebar for context.</p>
          </div>
        ) : (
          <>
            {session!.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} streaming={streaming && msg === session!.messages[session!.messages.length - 1] && msg.role === 'assistant'} />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a, i) => (
              <div className="attachment" key={i}>
                <img src={a.preview} alt="attachment" />
                <button className="attachment-remove" onClick={() => removeAttachment(i)} title="Remove">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={!ready || streaming}
            title="Attach image"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={ready ? 'Message Claude…  (paste or attach images)' : 'Connect your account in Settings to start'}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={!ready}
          />
          <button
            className={`send-btn ${streaming ? 'stop' : input.trim() || attachments.length ? 'active' : ''}`}
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0 && !streaming) || !ready}
            title={streaming ? 'Stop' : 'Send (Enter)'}
          >
            {streaming ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <div className="input-hint">Enter to send · Shift+Enter for newline</div>
      </div>
    </div>
  )
}
