import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './ChatTerminal.css'

interface Props {
  /** Stable PTY id for this chat (e.g. `chatterm_<sessionId>`). */
  terminalId: string
  /** Working dir — the chat's project folder (falls back to home in main). */
  cwd?: string
  /** Claude Code account this terminal runs under. */
  accountId?: string
  /** If the chat runs in WSL, the distro name — the terminal opens inside it. */
  wslDistro?: string
  /** The chat's Claude Code session id — resumed when launching claude. */
  resumeSessionId?: string
  onClose: () => void
}

// xterm's canvas needs a concrete opaque color, not a CSS var — read the live theme.
function themeColors(): { background: string; foreground: string } {
  const cs = getComputedStyle(document.documentElement)
  const bg = (cs.getPropertyValue('--bg-elev') || cs.getPropertyValue('--bg') || '').trim()
  const fg = (cs.getPropertyValue('--text') || cs.getPropertyValue('--fg') || '').trim()
  return { background: bg || '#17140f', foreground: fg || '#e8e2d6' }
}

export default function ChatTerminal({ terminalId, cwd, accountId, wslDistro, resumeSessionId, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef(terminalId)
  // Keep the latest resume id available to the (stable) button handler.
  const resumeRef = useRef(resumeSessionId)
  resumeRef.current = resumeSessionId
  // Auto-launch claude when the terminal opens; skipped for an explicit "Restart".
  const autoStartRef = useRef(true)
  const [exited, setExited] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Create the xterm instance once for this component's lifetime.
  useEffect(() => {
    if (!hostRef.current) return
    const { background, foreground } = themeColors()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, "Cascadia Code", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background, foreground, cursor: foreground }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    term.onData((d) => window.electronAPI.terminalWrite(idRef.current, d))
    termRef.current = term
    fitRef.current = fit

    const doFit = () => {
      try {
        fit.fit()
        if (idRef.current) window.electronAPI.terminalResize(idRef.current, term.cols, term.rows)
      } catch {
        // container mid-layout / zero-sized — ignore
      }
    }
    const ro = new ResizeObserver(() => doFit())
    ro.observe(hostRef.current)
    requestAnimationFrame(doFit)

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // (Re)spawn the PTY when the id, cwd, account, or an explicit restart changes.
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return

    idRef.current = terminalId
    setExited(false)
    term.reset()

    let cols = term.cols
    let rows = term.rows
    try {
      fit.fit()
      cols = term.cols
      rows = term.rows
    } catch {
      // ignore
    }

    const offData = window.electronAPI.onTerminalData((e) => {
      if (e.id === terminalId) term.write(e.data)
    })
    const offExit = window.electronAPI.onTerminalExit((e) => {
      if (e.id === terminalId) {
        setExited(true)
        term.write(`\r\n\x1b[2m[process exited${e.exitCode ? ` · code ${e.exitCode}` : ''}]\x1b[0m\r\n`)
      }
    })

    let autoStartTimer: ReturnType<typeof setTimeout> | undefined
    window.electronAPI.terminalCreate(terminalId, { cwd, accountId, wslDistro, cols, rows }).then((res) => {
      if (!res.ok) {
        term.write('\r\n\x1b[31mFailed to start terminal.\x1b[0m\r\n')
        return
      }
      term.focus()
      // On open (not on an explicit Restart), auto-launch claude, resuming this chat's
      // session. A short delay lets the shell finish printing its prompt first.
      if (autoStartRef.current) {
        autoStartTimer = setTimeout(() => {
          window.electronAPI.terminalStartClaude(terminalId, resumeRef.current)
        }, 600)
      }
      autoStartRef.current = true
    })

    return () => {
      if (autoStartTimer) clearTimeout(autoStartTimer)
      offData()
      offExit()
      window.electronAPI.terminalKill(terminalId)
    }
  }, [terminalId, cwd, accountId, wslDistro, reloadKey])

  return (
    <div className="chat-terminal">
      <div className="chat-terminal-bar">
        <span className="chat-terminal-label">
          Terminal
          {cwd && <span className="chat-terminal-cwd" title={cwd}>{cwd.split(/[\\/]/).filter(Boolean).pop()}</span>}
        </span>
        <div className="chat-terminal-actions">
          <button
            className="chat-terminal-btn primary"
            onClick={() => window.electronAPI.terminalStartClaude(idRef.current, resumeRef.current)}
            title={
              resumeSessionId
                ? 'Launch claude, resuming this chat’s conversation'
                : 'Launch the interactive claude CLI'
            }
          >
            {resumeSessionId ? 'Resume in Claude' : 'Start Claude'}
          </button>
          <button
            className="chat-terminal-btn"
            onClick={() => {
              autoStartRef.current = false
              setReloadKey((k) => k + 1)
            }}
            title="Restart the shell (plain, no claude)"
          >
            Restart
          </button>
          <button className="chat-terminal-btn icon" onClick={onClose} title="Close terminal" aria-label="Close terminal">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="chat-terminal-host-wrap">
        <div ref={hostRef} className="chat-terminal-host" />
        {exited && (
          <button className="chat-terminal-restart" onClick={() => setReloadKey((k) => k + 1)}>
            Restart terminal
          </button>
        )}
      </div>
    </div>
  )
}
