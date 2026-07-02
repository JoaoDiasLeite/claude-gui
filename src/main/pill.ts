import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Agent status pill: a tiny always-on-top "picture-in-picture" flyout shown while
// an agent run is in flight AND the main window is hidden/minimized, so background
// activity is visible at a glance and one click jumps back to the app. Modeled on
// the approval toast (src/main/toast.ts): frameless acrylic, non-focus-stealing
// (shown via showInactive), never dismissed on blur. Unlike the toast it is
// user-draggable, so we remember its position for the rest of the session.

const PILL_WIDTH = 300
const PILL_HEIGHT = 52
const MARGIN = 12

// The toast occupies 380×170 at the bottom-right (see toast.ts). We stack the pill
// 12px above the toast's top edge so the two never overlap when both are showing.
const TOAST_HEIGHT = 170

let pillWindow: BrowserWindow | null = null
// Session-only remembered position (no config writes). Once the user drags the pill
// we reuse that spot on subsequent shows instead of snapping back to the default.
let lastPosition: { x: number; y: number } | null = null
// Resettable grace-period timer: a finished run hides the pill after a short delay,
// but a new run starting in that window cancels the timer to keep the pill alive.
let hideTimer: ReturnType<typeof setTimeout> | null = null

export function createPillWindow(): BrowserWindow {
  pillWindow = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never grab focus: a background run's status must not interrupt what the user
    // is doing. Mouse clicks (the "open" button) still work on a non-focusable window.
    focusable: false,
    // The user can reposition it; the toast is fixed, the pill is not.
    movable: true,
    alwaysOnTop: true,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  // Float above fullscreen apps like a native notification, not just normal windows.
  pillWindow.setAlwaysOnTop(true, 'screen-saver')

  // Remember where the user dragged it (session-only) so it reappears in place.
  pillWindow.on('moved', () => {
    if (!pillWindow || pillWindow.isDestroyed()) return
    const [x, y] = pillWindow.getPosition()
    lastPosition = { x, y }
  })

  pillWindow.on('closed', () => {
    pillWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    pillWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pill.html`)
  } else {
    pillWindow.loadFile(join(__dirname, '../renderer/pill.html'))
  }
  return pillWindow
}

/** Deliver an event to the pill renderer, if the window is alive. Best-effort. */
export function sendToPill(channel: string, payload?: unknown): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send(channel, payload)
  }
}

/**
 * Show the pill WITHOUT stealing focus. Positions it at the last dragged spot if the
 * user moved it this session, otherwise 12px above where the approval toast sits at
 * the bottom-right of the primary display's work area. Cancels any pending hide so a
 * run starting during the grace period keeps the pill up.
 */
export function showPill(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (!pillWindow || pillWindow.isDestroyed()) createPillWindow()
  const win = pillWindow!
  if (lastPosition) {
    win.setPosition(lastPosition.x, lastPosition.y)
  } else {
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea
    // Bottom-right, stacked above the toast's top edge (toast height + its own margin
    // + the gap between the two).
    win.setPosition(
      Math.round(x + width - PILL_WIDTH - MARGIN),
      Math.round(y + height - TOAST_HEIGHT - MARGIN - PILL_HEIGHT - MARGIN)
    )
  }
  win.showInactive()
}

export function hidePill(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (pillWindow && !pillWindow.isDestroyed() && pillWindow.isVisible()) {
    pillWindow.hide()
  }
}

/**
 * Hide the pill after a grace period (so a finished/errored run lingers briefly).
 * Any later showPill() cancels this, keeping the pill alive across back-to-back runs.
 */
export function hidePillSoon(delayMs: number): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    hidePill()
  }, delayMs)
}
