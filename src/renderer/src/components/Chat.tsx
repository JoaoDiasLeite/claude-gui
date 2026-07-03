import { useEffect, useRef, useState } from 'react'
import { Session, ModelInfo, ImageAttachment, CCAccountStatus, SlashCommand } from '../types'
import MessageBubble from './MessageBubble'
import ModelPicker from './ModelPicker'
import AccountPicker from './AccountPicker'
import ChatTerminal from './ChatTerminal'
import { sessionToMarkdown } from '../lib/markdown-export'
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
  lightMode: boolean
  onToggleLightMode: () => void
  onStartFresh: () => void
  onCompact: () => void
  compacting: boolean
  onOpenCheckpoints: () => void
  onOpenGit: () => void
  onRetry: () => void
  onEditResend: (messageId: string, newText: string) => void
  onExportSession: (format: 'md' | 'html') => void
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
  lightMode,
  onToggleLightMode,
  onStartFresh,
  onCompact,
  compacting,
  onOpenCheckpoints,
  onOpenGit,
  onRetry,
  onEditResend,
  onExportSession
}: Props) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [markdownCopied, setMarkdownCopied] = useState(false)
  const [markdownSaved, setMarkdownSaved] = useState(false)
  // Per-chat terminal toggle, keyed by session id so each chat remembers its own state.
  const [termOpenById, setTermOpenById] = useState<Record<string, boolean>>({})
  const termOpen = !!(session && termOpenById[session.id])
  const toggleTerminal = () => {
    if (!session) return
    setTermOpenById((prev) => ({ ...prev, [session.id]: !prev[session.id] }))
  }
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickerListRef = useRef<HTMLDivElement>(null)

  // ── Slash-command picker ──────────────────────────────────────────────────
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerActive, setPickerActive] = useState(0)

  // Fetch command list whenever the project path changes.
  useEffect(() => {
    let cancelled = false
    window.electronAPI.commandsList(session?.projectPath).then((cmds) => {
      if (!cancelled) setSlashCommands(cmds)
    }).catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [session?.projectPath])

  // Compute the query string after the leading slash (first word only).
  const slashQuery = (() => {
    if (!input.startsWith('/')) return null
    // Only show picker before the user has added a space + args
    const space = input.indexOf(' ')
    if (space !== -1) return null
    return input.slice(1).toLowerCase()
  })()

  // Filtered list based on what they've typed after '/'.
  const pickerItems = slashQuery !== null
    ? slashCommands.filter((c) =>
        slashQuery === '' || c.name.toLowerCase().includes(slashQuery) ||
        (c.description ?? '').toLowerCase().includes(slashQuery)
      )
    : []

  // Open/close the picker; reset selection to 0 on every open.
  useEffect(() => {
    const shouldOpen = slashQuery !== null && pickerItems.length > 0
    setPickerOpen(shouldOpen)
    if (shouldOpen) setPickerActive(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery])

  // Keep the active index in bounds when the filtered list shrinks.
  useEffect(() => {
    if (pickerItems.length > 0) {
      setPickerActive((prev) => (prev >= pickerItems.length ? pickerItems.length - 1 : prev))
    }
    if (pickerItems.length === 0) setPickerOpen(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerItems.length])

  // Scroll active item into view.
  useEffect(() => {
    const el = pickerListRef.current?.querySelector('.slash-picker-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [pickerActive])

  const acceptPickerItem = (item: SlashCommand) => {
    const insertion = item.kind === 'skill'
      ? `Use the "${item.name}" skill to `
      : `/${item.name} `
    setInput(insertion)
    setPickerOpen(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages])

  const handleCopyMarkdown = () => {
    if (!session) return
    navigator.clipboard.writeText(sessionToMarkdown(session)).then(() => {
      // Keep the dropdown open long enough for the "Copied ✓" label to be seen,
      // then close it (closing immediately would hide the only feedback).
      setMarkdownCopied(true)
      setTimeout(() => {
        setMarkdownCopied(false)
        setExportMenuOpen(false)
      }, 1200)
    })
  }

  const handleSaveMarkdown = async () => {
    if (!session) return
    const md = sessionToMarkdown(session)
    const result = await window.electronAPI.exportMarkdown(session.name || 'chat', md)
    if (result.saved) {
      setMarkdownSaved(true)
      setTimeout(() => setMarkdownSaved(false), 1500)
    }
  }

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
    if (pickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPickerActive((a) => Math.min(a + 1, pickerItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPickerActive((a) => Math.max(a - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        // Don't accept during IME composition (keyCode 229 is the IME sentinel)
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        const item = pickerItems[pickerActive]
        if (item) acceptPickerItem(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPickerOpen(false)
        return
      }
    }
    // Don't send during IME composition
    if (e.key === 'Enter' && !e.shiftKey && !streaming && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      handleSend()
    }
  }

  // Close the picker when the textarea loses focus (e.g. user clicks elsewhere).
  // Use a short delay so a click on a picker item fires its onClick before the list unmounts.
  const handleBlur = () => {
    setTimeout(() => setPickerOpen(false), 150)
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

  const formatTokens = (n: number): string => {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
    return String(n)
  }

  const totalTokens = (session?.inputTokens ?? 0) + (session?.outputTokens ?? 0) +
    (session?.cacheReadTokens ?? 0) + (session?.cacheCreationTokens ?? 0)
  const showUsageChip = !!session && ((session.costUsd ?? 0) > 0 || totalTokens > 0)

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
          {showUsageChip && (
            <span
              className="chat-usage-chip"
              title={[
                `Input: ${formatTokens(session!.inputTokens ?? 0)} tok`,
                `Output: ${formatTokens(session!.outputTokens ?? 0)} tok`,
                `Cache read: ${formatTokens(session!.cacheReadTokens ?? 0)} tok`,
                `Cache write: ${formatTokens(session!.cacheCreationTokens ?? 0)} tok`
              ].join('\n')}
            >
              ${(session!.costUsd ?? 0).toFixed(4)} · {formatTokens(totalTokens)} tok
            </span>
          )}
        </div>
        <div className="chat-header-right">
          <button
            className={`approve-toggle ${autoApprove ? 'auto' : 'ask'}`}
            onClick={onToggleAutoApprove}
            title={autoApprove ? 'Auto-approving all tools — click to require approval' : 'Asking before file edits & commands — click to auto-approve'}
            aria-label={autoApprove ? 'Auto-approving all tools — click to require approval' : 'Asking before file edits & commands — click to auto-approve'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {autoApprove ? (
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              ) : (
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              )}
            </svg>
            {autoApprove ? 'Auto' : 'Approve'}
          </button>
          <button
            className={`approve-toggle ${lightMode ? 'auto' : 'ask'}`}
            onClick={onToggleLightMode}
            title={
              lightMode
                ? 'Light mode ON — no tools sent (cheapest for plain chat). Click to enable tools.'
                : 'Tools enabled. Click for Light mode: no tools, fewer tokens per turn (best for plain Q&A).'
            }
            aria-label="Toggle light (no-tools) chat mode"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {lightMode ? 'Light' : 'Full'}
          </button>
          <button className="header-icon-btn" onClick={onOpenGit} title="Git" aria-label="Git">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="9" r="3" />
              <path d="M18 12a9 9 0 0 1-9 9M6 9v6" />
            </svg>
          </button>
          <button
            className={`header-icon-btn ${termOpen ? 'term-active' : ''}`}
            onClick={toggleTerminal}
            title="Terminal for this chat"
            aria-label="Terminal for this chat"
            aria-pressed={termOpen}
            disabled={!session}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <polyline points="6 9 10 12 6 15" />
              <line x1="12" y1="15" x2="16" y2="15" />
            </svg>
          </button>
          <div className="export-menu-wrap" style={{ position: 'relative' }}>
            <button
              className="header-icon-btn"
              onClick={() => !isEmpty && setExportMenuOpen((v) => !v)}
              title="Export chat"
              aria-label="Export chat"
              disabled={isEmpty}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            {exportMenuOpen && (
              <div className="export-dropdown" onMouseLeave={() => setExportMenuOpen(false)}>
                <button onClick={() => { setExportMenuOpen(false); handleSaveMarkdown() }}>
                  {markdownSaved ? 'Saved ✓' : 'Export as .md'}
                </button>
                <button onClick={handleCopyMarkdown}>
                  {markdownCopied ? 'Copied ✓' : 'Copy as Markdown'}
                </button>
                <button onClick={() => { setExportMenuOpen(false); onExportSession('html') }}>Export as HTML</button>
              </div>
            )}
          </div>
          <button className="header-icon-btn" onClick={onOpenCheckpoints} title="Checkpoints / timeline" aria-label="Checkpoints / timeline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
            </svg>
          </button>
          <button className="header-icon-btn" onClick={onOpenClaudeMd} title="Edit CLAUDE.md" aria-label="Edit CLAUDE.md">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

      <div className="chat-messages" style={termOpen ? { display: 'none' } : undefined}>
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
            {session!.messages.map((msg, idx) => {
              const isLast = idx === session!.messages.length - 1
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  streaming={streaming && isLast && msg.role === 'assistant'}
                  onRetry={isLast && msg.role === 'assistant' && msg.error ? onRetry : undefined}
                  onEditResend={onEditResend}
                />
              )
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {session && termOpen && (
        <ChatTerminal
          key={session.id}
          terminalId={`chatterm_${session.id}`}
          cwd={session.projectPath}
          accountId={currentAccount}
          wslDistro={session.wslDistro}
          resumeSessionId={session.claudeSessionId}
          onClose={toggleTerminal}
        />
      )}

      <div className="chat-input-area" style={termOpen ? { display: 'none' } : undefined}>
        {session && session.messages.length >= 40 && (
          <div className="long-session-banner">
            <span className="long-session-text">
              This chat has {session.messages.length} messages — the whole history is re-sent every
              turn, which burns tokens. Compact it or start fresh.
            </span>
            <div className="long-session-actions">
              <button onClick={onCompact} disabled={compacting}>
                {compacting ? 'Compacting…' : 'Compact'}
              </button>
              <button onClick={onStartFresh} disabled={compacting}>
                Start fresh
              </button>
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a, i) => (
              <div className="attachment" key={i}>
                <img src={a.preview} alt="attachment" />
                <button className="attachment-remove" onClick={() => removeAttachment(i)} title="Remove" aria-label="Remove attachment">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-wrapper">
          {pickerOpen && (
            <div className="slash-picker" role="listbox" aria-label="Slash commands">
              <div className="slash-picker-list" ref={pickerListRef}>
                {pickerItems.length === 0 ? (
                  <div className="slash-picker-empty">No matches</div>
                ) : (
                  pickerItems.map((item, i) => (
                    <div
                      key={`${item.kind}:${item.scope}:${item.name}`}
                      className={`slash-picker-item${i === pickerActive ? ' active' : ''}`}
                      role="option"
                      aria-selected={i === pickerActive}
                      onMouseEnter={() => setPickerActive(i)}
                      onClick={() => acceptPickerItem(item)}
                    >
                      <span className="slash-picker-name">/{item.name}</span>
                      {item.description && (
                        <span className="slash-picker-desc">{item.description}</span>
                      )}
                      <span className="slash-picker-badges">
                        <span className={`slash-badge slash-badge-kind-${item.kind}`}>
                          {item.kind}
                        </span>
                        {item.scope === 'project' && (
                          <span className="slash-badge slash-badge-scope-project">project</span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="slash-picker-foot">
                <span>↑↓ navigate</span>
                <span>↵ Tab accept</span>
                <span>esc dismiss</span>
              </div>
            </div>
          )}
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
            aria-label="Attach image"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            onBlur={handleBlur}
            rows={1}
            disabled={!ready}
          />
          <button
            className={`send-btn ${streaming ? 'stop' : input.trim() || attachments.length ? 'active' : ''}`}
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0 && !streaming) || !ready}
            title={streaming ? 'Stop' : 'Send (Enter)'}
            aria-label={streaming ? 'Stop' : 'Send'}
          >
            {streaming ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
