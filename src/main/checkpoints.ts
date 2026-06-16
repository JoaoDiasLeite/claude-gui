import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface CheckpointFile {
  path: string
  content: string
  existed: boolean
}

export interface Checkpoint {
  id: string
  sessionId: string
  label: string
  createdAt: number
  messageCount: number
  files: CheckpointFile[]
}

export interface CheckpointMeta {
  id: string
  sessionId: string
  label: string
  createdAt: number
  messageCount: number
  fileCount: number
}

const root = path.join(app.getPath('userData'), 'checkpoints')

function sessionDir(sessionId: string): string {
  const dir = path.join(root, sessionId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

let seq = 0
function genId(): string {
  seq += 1
  return `cp_${seq}_${(seq * 99991) % 1000000}`
}

function snapshotFiles(files: string[]): CheckpointFile[] {
  const seen = new Set<string>()
  const out: CheckpointFile[] = []
  for (const p of files) {
    if (seen.has(p)) continue
    seen.add(p)
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        out.push({ path: p, content: fs.readFileSync(p, 'utf-8'), existed: true })
      } else {
        out.push({ path: p, content: '', existed: false })
      }
    } catch {
      // unreadable — record as non-existing so restore is a no-op
      out.push({ path: p, content: '', existed: false })
    }
  }
  return out
}

function toMeta(c: Checkpoint): CheckpointMeta {
  return {
    id: c.id,
    sessionId: c.sessionId,
    label: c.label,
    createdAt: c.createdAt,
    messageCount: c.messageCount,
    fileCount: c.files.length
  }
}

export function createCheckpoint(
  sessionId: string,
  label: string,
  files: string[],
  messageCount: number,
  createdAt: number
): CheckpointMeta {
  const cp: Checkpoint = {
    id: genId(),
    sessionId,
    label,
    createdAt,
    messageCount,
    files: snapshotFiles(files)
  }
  fs.writeFileSync(path.join(sessionDir(sessionId), `${cp.id}.json`), JSON.stringify(cp))
  return toMeta(cp)
}

export function listCheckpoints(sessionId: string): CheckpointMeta[] {
  const dir = path.join(root, sessionId)
  if (!fs.existsSync(dir)) return []
  const metas: CheckpointMeta[] = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const c: Checkpoint = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      metas.push(toMeta(c))
    } catch {
      // skip
    }
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt)
}

function read(sessionId: string, id: string): Checkpoint | null {
  const p = path.join(root, sessionId, `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

export interface RestoreResult {
  restored: number
  safetyCheckpointId: string | null
}

export function restoreCheckpoint(sessionId: string, id: string, createdAt: number): RestoreResult {
  const cp = read(sessionId, id)
  if (!cp) return { restored: 0, safetyCheckpointId: null }

  // Safety net: snapshot the CURRENT state of these files before overwriting, so the
  // restore itself can be undone.
  const safety = createCheckpoint(
    sessionId,
    `Before restore of "${cp.label}"`,
    cp.files.map((f) => f.path),
    cp.messageCount,
    createdAt
  )

  let restored = 0
  for (const f of cp.files) {
    try {
      if (f.existed) {
        fs.mkdirSync(path.dirname(f.path), { recursive: true })
        fs.writeFileSync(f.path, f.content)
        restored++
      } else if (fs.existsSync(f.path)) {
        fs.unlinkSync(f.path)
        restored++
      }
    } catch {
      // skip files we can't write
    }
  }
  return { restored, safetyCheckpointId: safety.id }
}

export function deleteCheckpoint(sessionId: string, id: string): CheckpointMeta[] {
  const p = path.join(root, sessionId, `${id}.json`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  return listCheckpoints(sessionId)
}
