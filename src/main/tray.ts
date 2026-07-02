import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

// System tray: keeps the app (and its scheduler) alive when the window is closed,
// and gives quick access to the main window, a new chat, and the quick launcher.

let tray: Tray | null = null
// Kept so the context menu can be rebuilt later (e.g. when the shortcut label changes)
// without the caller having to re-supply the action callbacks.
let trayActions: TrayActions | null = null

export interface TrayActions {
  onShowMain: () => void
  onNewChat: () => void
  onToggleOverlay: () => void
  onQuit: () => void
}

function buildMenu(actions: TrayActions, overlayShortcut: string): Menu {
  return Menu.buildFromTemplate([
    { label: 'Open Claude GUI', click: actions.onShowMain },
    { label: 'New chat', click: actions.onNewChat },
    {
      label: overlayShortcut ? `Quick launcher (${overlayShortcut})` : 'Quick launcher',
      click: actions.onToggleOverlay
    },
    { type: 'separator' },
    { label: 'Quit Claude GUI', click: actions.onQuit }
  ])
}

/** Returns the created tray, or null when no usable icon exists (close-to-tray is
 *  disabled in that case so the app can't be stranded invisible). */
export function createTray(actions: TrayActions, overlayShortcut: string): Tray | null {
  const icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
  if (icon.isEmpty()) return null

  trayActions = actions
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Claude GUI')
  tray.setContextMenu(buildMenu(actions, overlayShortcut))
  tray.on('click', actions.onShowMain)
  return tray
}

/** Rebuild the context menu with an updated quick-launcher shortcut label. No-op
 *  if the tray hasn't been created (or has been torn down). */
export function updateTrayShortcutLabel(shortcut: string): void {
  if (!tray || !trayActions) return
  tray.setContextMenu(buildMenu(trayActions, shortcut))
}
