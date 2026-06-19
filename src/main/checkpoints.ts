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

export interface CheckpointFileDiff {
  path: string
  before: string
  after: string
}

export interface CheckpointDiff {
  files: CheckpointFileDiff[]
}

/**
 * Compare two checkpoints (or one checkpoint vs current on-disk state).
 * Pass idB = 'current' to compare the snapshot against what's on disk right now.
 */
export function compareCheckpoints(
  sessionId: string,
  idA: string,
  idB: string
): CheckpointDiff {
  const cpA = read(sessionId, idA)
  if (!cpA) return { files: [] }

  const allPaths = new Set<string>(cpA.files.map((f) => f.path))

  let bMap: Map<string, string>
  if (idB === 'current') {
    // Read current on-disk content for each path in cpA
    bMap = new Map()
    for (const f of cpA.files) {
      try {
        if (fs.existsSync(f.path) && fs.statSync(f.path).isFile()) {
          bMap.set(f.path, fs.readFileSync(f.path, 'utf-8'))
        } else {
          bMap.set(f.path, '')
        }
      } catch {
        bMap.set(f.path, '')
      }
    }
  } else {
    const cpB = read(sessionId, idB)
    if (!cpB) return { files: [] }
    for (const f of cpB.files) allPaths.add(f.path)
    bMap = new Map(cpB.files.map((f) => [f.path, f.existed ? f.content : '']))
  }

  const aMap = new Map(cpA.files.map((f) => [f.path, f.existed ? f.content : '']))

  const files: CheckpointFileDiff[] = []
  for (const p of allPaths) {
    const before = aMap.get(p) ?? ''
    const after = bMap.get(p) ?? ''
    if (before !== after) {
      files.push({ path: p, before, after })
    }
  }
  return { files }
}

// ─── Minimal LCS-based unified diff ──────────────────────────────────────────

function lcs(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

type EditOp = { type: 'context' | 'add' | 'del'; text: string }

function buildEdits(a: string[], b: string[], dp: number[][]): EditOp[] {
  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] })
      i++
    } else {
      ops.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i++] })
  while (j < b.length) ops.push({ type: 'add', text: b[j++] })
  return ops
}

function buildUnifiedPatch(filePath: string, before: string, after: string, context = 3): string {
  const aLines = before === '' ? [] : before.split('\n')
  const bLines = after === '' ? [] : after.split('\n')
  const dp = lcs(aLines, bLines)
  const ops = buildEdits(aLines, bLines, dp)

  // Map ops back to line numbers so we can emit hunks with context.
  type TaggedOp = EditOp & { aLine: number; bLine: number }
  const tagged: TaggedOp[] = []
  let aLine = 1
  let bLine = 1
  for (const op of ops) {
    tagged.push({ ...op, aLine, bLine })
    if (op.type !== 'add') aLine++
    if (op.type !== 'del') bLine++
  }

  // Find change positions and group into hunks.
  const changeIdx = tagged
    .map((op, i) => (op.type !== 'context' ? i : -1))
    .filter((i) => i >= 0)

  if (changeIdx.length === 0) return ''

  const hunks: Array<{ start: number; end: number }> = []
  let hStart = Math.max(0, changeIdx[0] - context)
  let hEnd = Math.min(tagged.length - 1, changeIdx[0] + context)
  for (let k = 1; k < changeIdx.length; k++) {
    const idx = changeIdx[k]
    if (idx - context <= hEnd + 1) {
      hEnd = Math.min(tagged.length - 1, idx + context)
    } else {
      hunks.push({ start: hStart, end: hEnd })
      hStart = Math.max(0, idx - context)
      hEnd = Math.min(tagged.length - 1, idx + context)
    }
  }
  hunks.push({ start: hStart, end: hEnd })

  const safeFile = filePath.replace(/\\/g, '/')
  const header = `--- a/${safeFile}\n+++ b/${safeFile}\n`
  const hunkTexts = hunks.map((h) => {
    const slice = tagged.slice(h.start, h.end + 1)
    const aCount = slice.filter((o) => o.type !== 'add').length
    const bCount = slice.filter((o) => o.type !== 'del').length
    const aStart = slice[0].aLine
    const bStart = slice[0].bLine
    const hunkHeader = `@@ -${aStart},${aCount} +${bStart},${bCount} @@`
    const lines = slice.map((o) => {
      const sign = o.type === 'add' ? '+' : o.type === 'del' ? '-' : ' '
      return `${sign}${o.text}`
    })
    return [hunkHeader, ...lines].join('\n')
  })

  return header + hunkTexts.join('\n') + '\n'
}

/**
 * Build a unified-diff patch comparing a checkpoint's snapshot against
 * current on-disk state, or against another checkpoint (idB = 'current' for disk).
 */
export function exportPatch(sessionId: string, idA: string, idB: string): string {
  const diff = compareCheckpoints(sessionId, idA, idB)
  if (diff.files.length === 0) return ''
  return diff.files.map((f) => buildUnifiedPatch(f.path, f.before, f.after)).join('\n')
}
