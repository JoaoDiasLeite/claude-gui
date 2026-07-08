import { BrowserWindow, shell } from 'electron'

// Schemes that are safe to hand to the OS. Anything else — file:, smb:, or an
// arbitrary registered protocol handler (ms-msdt:, search-ms:, …) — can execute
// code on click, and chat markdown links come straight from model output.
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Lock down a window's web contents: window.open only reaches the default browser
 * for http(s)/mailto URLs, and in-window navigation away from the app is blocked.
 * Renderers run with sandbox:false, so a page that navigated to remote content
 * would inherit the preload bridge and its full IPC surface — never allow it.
 */
export function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    // Dev-server reloads (vite full-reload does a page-initiated reload) stay in-app;
    // everything else is blocked, with safe links bounced to the default browser.
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })
}
