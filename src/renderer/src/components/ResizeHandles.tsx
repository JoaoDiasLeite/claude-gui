import { useRef } from 'react'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

// Keep in sync with the window's minWidth/minHeight in the main process.
const MIN_W = 900
const MIN_H = 600

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface DragState {
  edge: Edge
  startX: number
  startY: number
  bounds: { x: number; y: number; width: number; height: number }
}

/**
 * Custom edge/corner resize handles for the frameless transparent window (which loses
 * native edge-resize). Each handle drives mainWindow.setBounds through window:set-bounds,
 * keeping the opposite edge fixed and clamping to the window's minimum size.
 */
export default function ResizeHandles() {
  const drag = useRef<DragState | null>(null)

  const onMove = (e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.screenX - d.startX
    const dy = e.screenY - d.startY
    let { x, y, width, height } = d.bounds
    const { edge } = d
    if (edge.includes('e')) width = d.bounds.width + dx
    if (edge.includes('s')) height = d.bounds.height + dy
    if (edge.includes('w')) {
      width = d.bounds.width - dx
      x = d.bounds.x + dx
    }
    if (edge.includes('n')) {
      height = d.bounds.height - dy
      y = d.bounds.y + dy
    }
    if (width < MIN_W) {
      if (edge.includes('w')) x = d.bounds.x + (d.bounds.width - MIN_W)
      width = MIN_W
    }
    if (height < MIN_H) {
      if (edge.includes('n')) y = d.bounds.y + (d.bounds.height - MIN_H)
      height = MIN_H
    }
    window.electronAPI.windowSetBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    })
  }

  const onUp = () => {
    drag.current = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
  }

  const startResize = (edge: Edge) => async (e: React.MouseEvent) => {
    e.preventDefault()
    const bounds = await window.electronAPI.windowGetBounds()
    drag.current = { edge, startX: e.screenX, startY: e.screenY, bounds }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
  }

  return (
    <>
      {EDGES.map((edge) => (
        <div key={edge} className={`resize-handle rz-${edge}`} onMouseDown={startResize(edge)} />
      ))}
    </>
  )
}
