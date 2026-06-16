import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
      })
    })
  })
}

export interface GitFile {
  path: string
  index: string
  worktree: string
  staged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  files: GitFile[]
  ahead: number
  behind: number
}

export async function getStatus(cwd: string): Promise<GitStatus> {
  if (!cwd || !fs.existsSync(cwd)) return { isRepo: false, branch: '', files: [], ahead: 0, behind: 0 }

  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() !== 'true') return { isRepo: false, branch: '', files: [], ahead: 0, behind: 0 }

  const branchRes = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchRes.stdout.trim()

  const statusRes = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  const files: GitFile[] = []
  for (const line of statusRes.stdout.split('\n')) {
    if (!line.trim()) continue
    const index = line[0]
    const worktree = line[1]
    const filePath = line.slice(3).replace(/^"|"$/g, '')
    files.push({
      path: filePath,
      index,
      worktree,
      staged: index !== ' ' && index !== '?',
      untracked: index === '?' && worktree === '?'
    })
  }

  let ahead = 0
  let behind = 0
  const ab = await git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  if (ab.code === 0) {
    const [b, a] = ab.stdout.trim().split(/\s+/).map(Number)
    behind = b || 0
    ahead = a || 0
  }

  return { isRepo: true, branch, files, ahead, behind }
}

/** Unified diff for a file (staged or working tree). Untracked files are shown as all-add. */
export async function getDiff(cwd: string, filePath: string, staged: boolean): Promise<string> {
  const untrackedCheck = await git(cwd, ['ls-files', '--error-unmatch', filePath])
  if (untrackedCheck.code !== 0) {
    // Untracked: synthesize an all-additions view from the file content.
    try {
      const content = fs.readFileSync(path.join(cwd, filePath), 'utf-8')
      return content
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n')
    } catch {
      return ''
    }
  }
  const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath]
  const res = await git(cwd, args)
  return res.stdout
}

export async function stageFile(cwd: string, filePath: string): Promise<GitStatus> {
  await git(cwd, ['add', '--', filePath])
  return getStatus(cwd)
}

export async function unstageFile(cwd: string, filePath: string): Promise<GitStatus> {
  await git(cwd, ['restore', '--staged', '--', filePath])
  return getStatus(cwd)
}

export async function stageAll(cwd: string): Promise<GitStatus> {
  await git(cwd, ['add', '-A'])
  return getStatus(cwd)
}

export interface CommitResult {
  ok: boolean
  message: string
}

export async function commit(cwd: string, message: string): Promise<CommitResult> {
  if (!message.trim()) return { ok: false, message: 'Empty commit message' }
  const res = await git(cwd, ['commit', '-m', message])
  return { ok: res.code === 0, message: (res.stdout || res.stderr).trim() }
}
