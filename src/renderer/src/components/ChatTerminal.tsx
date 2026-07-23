import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ProviderId } from '../types'
import './ChatTerminal.css'

interface Props {
  /** Stable PTY id for this chat (e.g. `chatterm_<sessionId>`). */
  terminalId: string
  /** Working dir — the chat's project folder (falls back to home in main). */
  cwd?: string
  /** Provider account this terminal runs under. */
  accountId?: string
  /** If the chat runs in WSL, the distro name — the terminal opens inside it. */
  wslDistro?: string
  /** If the chat runs on a remote SSH host, its host id — the terminal connects to it. */
  remoteHostId?: string
  /** Which CLI to launch — the chat's provider. */
  provider: ProviderId
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

const FONT_SIZE_KEY = 'chatterm-font-size'
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 22

// How long the loading overlay is shown at most, regardless of what the CLI does — a
// backstop so a non-TUI CLI or unexpected output never leaves the loader stuck forever.
const STARTING_BACKSTOP_MS = 8000

// claude, codex, and Antigravity all render inline (no alt screen), so there's no single
// escape sequence that means "the CLI took over". Instead we reveal once the pty's output
// goes quiet after we launch it — the shell banner, screen clear, resume attempt/fallback,
// and CLI banner all stream out first, and once that settles the CLI is idle waiting for
// input. This is how long a gap in output has to be, after launch, before we call it settled.
const REVEAL_QUIET_MS = 600

function loadFontSize(): number {
  const saved = Number(localStorage.getItem(FONT_SIZE_KEY))
  return saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE ? saved : 13
}

export default function ChatTerminal({ terminalId, cwd, accountId, wslDistro, remoteHostId, provider, resumeSessionId, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef(terminalId)
  // Keep the latest resume id available to the auto-launch timer below.
  const resumeRef = useRef(resumeSessionId)
  resumeRef.current = resumeSessionId
  // Auto-launch claude when the terminal opens; skipped for an explicit "Restart".
  const autoStartRef = useRef(true)
  const [exited, setExited] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [fontSize, setFontSize] = useState(loadFontSize)
  // Hides the raw shell (banner + echoed launch command + a failed --resume bouncing back
  // to the prompt) until the CLI settles in and is idle waiting for input. Revealed by the
  // quiet-timer logic in onTerminalData below, once launched output stops streaming.
  const [starting, setStarting] = useState(true)
  // True from the moment we've typed the launch command until the terminal is revealed —
  // gates the quiet timer so it only arms for output produced by that launch, not for
  // whatever the shell happened to print beforehand.
  const awaitingRevealRef = useRef(false)
  // Debounced "output went quiet" timer, (re)armed by every data chunk while awaiting
  // reveal; fires setStarting(false) once REVEAL_QUIET_MS passes with no further output.
  const quietTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Create the xterm instance once for this component's lifetime.
  useEffect(() => {
    if (!hostRef.current) return
    const { background, foreground } = themeColors()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, "Cascadia Code", "DejaVu Sans Mono", monospace',
      fontSize: loadFontSize(),
      scrollback: 5000,
      theme: { background, foreground, cursor: foreground }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    term.onData((d) => window.electronAPI.terminalWrite(idRef.current, d))

    // Copy-on-select (like most native terminals), plus explicit Ctrl/Cmd+C
    // (when there's a selection) and Ctrl/Cmd+V for clipboard paste — xterm
    // only forwards raw keystrokes as PTY input by default.
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard.writeText(sel).catch(() => {})
    })
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      if (mod && e.key.toLowerCase() === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text) window.electronAPI.terminalWrite(idRef.current, text)
        }).catch(() => {})
        return false
      }
      return true
    })

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
    // A single rAF can still land before the panel's own layout (flex/display
    // swap) has settled, sizing the terminal off the stale hidden-state rect —
    // chain a second frame so fit() runs against the final visible layout.
    requestAnimationFrame(() => requestAnimationFrame(doFit))

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // Push font-size changes onto the live terminal and re-fit/resize the PTY.
  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontSize = fontSize
    try {
      fit.fit()
      if (idRef.current) window.electronAPI.terminalResize(idRef.current, term.cols, term.rows)
    } catch {
      // ignore
    }
  }, [fontSize])

  // (Re)spawn the PTY when the id, cwd, account, or an explicit restart changes.
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return

    idRef.current = terminalId
    setExited(false)
    // Only cover the terminal with the loader when we're about to auto-launch the CLI. An
    // explicit Restart (autoStartRef false) intentionally drops to a bare shell, which
    // never enters the alt screen — showing the loader over it would just stall on the
    // backstop timeout.
    setStarting(autoStartRef.current)
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

    // Backstop: reveal unconditionally after a while, even if output never goes quiet (a
    // chatty CLI, or one that never starts producing output at all) so the loader can
    // never get stuck hiding a perfectly usable terminal.
    const backstopTimer = setTimeout(reveal, STARTING_BACKSTOP_MS)

    // Reveal the terminal, clearing both timers — called either by the quiet timer once
    // launched output settles, or by the backstop above as an absolute fallback.
    function reveal(): void {
      setStarting(false)
      clearTimeout(backstopTimer)
      clearTimeout(quietTimerRef.current)
      awaitingRevealRef.current = false
    }

    const offData = window.electronAPI.onTerminalData((e) => {
      if (e.id !== terminalId) return
      term.write(e.data)
      // Data written above is already painted underneath the overlay, so there's no flash
      // of stale/empty content once it's revealed. Only arm the quiet timer once we've
      // actually launched the CLI (awaitingRevealRef stays true until reveal() flips it
      // back off) — every further chunk pushes the deadline back out, so the loader stays
      // up for as long as the shell/CLI keep streaming output and only reveals once that
      // goes quiet. (Checking the `starting` state itself here would read a stale closure
      // value from whenever this effect ran, not the current one — the ref is the
      // authoritative, always-current gate.)
      if (awaitingRevealRef.current) {
        clearTimeout(quietTimerRef.current)
        quietTimerRef.current = setTimeout(reveal, REVEAL_QUIET_MS)
      }
    })
    const offExit = window.electronAPI.onTerminalExit((e) => {
      if (e.id !== terminalId) return
      // STATUS_CONTROL_C_EXIT (0xC000013A) — the pty was torn down by us (a kill), not a
      // real program error. It only ever fires when we already know the terminal is gone,
      // so surfacing it as an "exited" state is just noise (and can race a live reuse).
      if (e.exitCode === -1073741510 || e.exitCode === 3221225786) return
      setExited(true)
      term.write(`\r\n\x1b[2m[process exited${e.exitCode ? ` · code ${e.exitCode}` : ''}]\x1b[0m\r\n`)
    })

    let autoStartTimer: ReturnType<typeof setTimeout> | undefined
    window.electronAPI.terminalCreate(terminalId, { cwd, accountId, wslDistro, remoteHostId, provider, cols, rows }).then((res) => {
      if (!res.ok) {
        term.write('\r\n\x1b[31mFailed to start terminal.\x1b[0m\r\n')
        setStarting(false)
        return
      }
      term.focus()
      // On open (not on an explicit Restart), auto-launch the CLI, resuming this chat's
      // session (claude only). A short delay lets the shell finish printing its prompt first.
      if (autoStartRef.current) {
        autoStartTimer = setTimeout(() => {
          // Arm the reveal gate right as we launch — the very next data chunk (the
          // launch command's own shell echo) starts the quiet timer above.
          awaitingRevealRef.current = true
          window.electronAPI.terminalStartCli(terminalId, provider, resumeRef.current)
        }, 600)
      }
      autoStartRef.current = true
    })

    return () => {
      if (autoStartTimer) clearTimeout(autoStartTimer)
      clearTimeout(backstopTimer)
      clearTimeout(quietTimerRef.current)
      awaitingRevealRef.current = false
      offData()
      offExit()
      // Deferred, not immediate: a React StrictMode dev remount runs this cleanup and
      // then immediately re-runs the effect for the same id. createTerminal() reuses the
      // still-live pty and this scheduled kill is cancelled. A real close/session-switch
      // has no follow-up create, so it fires after the delay.
      window.electronAPI.terminalKillDeferred(terminalId)
    }
  }, [terminalId, cwd, accountId, wslDistro, remoteHostId, provider, reloadKey])

  const providerLabel = provider === 'codex' ? 'Codex' : provider === 'gemini' ? 'Antigravity' : 'Claude'

  return (
    <div className="chat-terminal">
      <div className="chat-terminal-bar">
        <span className="chat-terminal-label">
          Terminal
          {cwd && <span className="chat-terminal-cwd" title={cwd}>{cwd.split(/[\\/]/).filter(Boolean).pop()}</span>}
        </span>
        <div className="chat-terminal-actions">
          <div className="chat-terminal-fontsize">
            <button
              className="chat-terminal-btn icon"
              onClick={() => setFontSize((s) => Math.max(MIN_FONT_SIZE, s - 1))}
              title="Decrease font size"
              aria-label="Decrease terminal font size"
              disabled={fontSize <= MIN_FONT_SIZE}
            >
              −
            </button>
            <span className="chat-terminal-fontsize-value">{fontSize}</span>
            <button
              className="chat-terminal-btn icon"
              onClick={() => setFontSize((s) => Math.min(MAX_FONT_SIZE, s + 1))}
              title="Increase font size"
              aria-label="Increase terminal font size"
              disabled={fontSize >= MAX_FONT_SIZE}
            >
              +
            </button>
          </div>
          <button
            className="chat-terminal-btn"
            onClick={() => {
              autoStartRef.current = false
              // Immediate, not deferred: Restart must force a genuinely fresh pty, not
              // reuse the live one.
              window.electronAPI.terminalKill(terminalId)
              setReloadKey((k) => k + 1)
            }}
            title="Restart the terminal (relaunch the CLI)"
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
        {starting && !exited && (
          <div className="chat-terminal-loading">
            <div className="chat-terminal-spinner" />
            <div className="chat-terminal-loading-text">Starting {providerLabel}…</div>
          </div>
        )}
        {exited && (
          <button
            className="chat-terminal-restart"
            onClick={() => {
              window.electronAPI.terminalKill(terminalId)
              setReloadKey((k) => k + 1)
            }}
          >
            Restart terminal
          </button>
        )}
      </div>
    </div>
  )
}
