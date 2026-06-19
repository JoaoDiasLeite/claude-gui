import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface SlashCommand {
  name: string
  kind: 'command' | 'skill'
  scope: 'user' | 'project'
  description?: string
}

/** Extract the first markdown heading or frontmatter description from file content. */
function extractDescription(content: string): string | undefined {
  // Check frontmatter block (--- ... ---)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const descMatch = fm.match(/^description:\s*(.+)$/m)
    if (descMatch) return descMatch[1].trim()
  }
  // First markdown heading
  const headingMatch = content.match(/^#{1,6}\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  return undefined
}

/** Maximum directory depth to recurse into (prevents stack overflow on cyclic/deep trees). */
const MAX_WALK_DEPTH = 8
/** Maximum total commands returned from a single scan (prevents freeze on enormous dirs). */
const MAX_COMMANDS = 300
/** Maximum file size in bytes to read for description extraction (64 KB). */
const MAX_DESCRIPTION_FILE_BYTES = 64 * 1024

/** Scan a commands directory and return slash command entries. */
function scanCommandDir(dir: string, scope: 'user' | 'project'): SlashCommand[] {
  if (!fs.existsSync(dir)) return []
  const results: SlashCommand[] = []
  function walk(current: string, prefix: string, depth: number): void {
    if (depth > MAX_WALK_DEPTH) return
    if (results.length >= MAX_COMMANDS) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_COMMANDS) break
      // Skip symlinks to avoid following loops into arbitrary locations
      if (entry.isSymbolicLink()) continue
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        const ns = prefix ? `${prefix}:${entry.name}` : entry.name
        walk(fullPath, ns, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const base = entry.name.slice(0, -3)
        const name = prefix ? `${prefix}:${base}` : base
        let description: string | undefined
        try {
          const stat = fs.statSync(fullPath)
          if (stat.size <= MAX_DESCRIPTION_FILE_BYTES) {
            const content = fs.readFileSync(fullPath, 'utf-8')
            description = extractDescription(content)
          }
        } catch {
          // ignore unreadable files
        }
        results.push({ name, kind: 'command', scope, description })
      }
    }
  }
  walk(dir, '', 0)
  return results
}

/** Scan a skills directory and return skill entries. */
function scanSkillDir(dir: string, scope: 'user' | 'project'): SlashCommand[] {
  if (!fs.existsSync(dir)) return []
  const results: SlashCommand[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (results.length >= MAX_COMMANDS) break
    // Only real directories; skip symlinks to avoid loops
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const skillName = entry.name
    const skillFile = path.join(dir, skillName, 'SKILL.md')
    let description: string | undefined
    if (fs.existsSync(skillFile)) {
      try {
        const stat = fs.statSync(skillFile)
        if (stat.size <= MAX_DESCRIPTION_FILE_BYTES) {
          const content = fs.readFileSync(skillFile, 'utf-8')
          // Prefer frontmatter name: override (still use dir name as canonical id)
          const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
          if (fmMatch) {
            const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m)
            if (descMatch) description = descMatch[1].trim()
          }
          if (!description) description = extractDescription(content)
        }
      } catch {
        // ignore
      }
    }
    results.push({ name: skillName, kind: 'skill', scope, description })
  }
  return results
}

/** List all available slash commands and skills, deduped and sorted. */
export function listCommands(projectPath?: string): SlashCommand[] {
  const claudeHome = path.join(os.homedir(), '.claude')
  const all: SlashCommand[] = []

  // User-scope commands
  all.push(...scanCommandDir(path.join(claudeHome, 'commands'), 'user'))

  // Project-scope commands
  if (projectPath) {
    all.push(...scanCommandDir(path.join(projectPath, '.claude', 'commands'), 'project'))
  }

  // User-scope skills
  all.push(...scanSkillDir(path.join(claudeHome, 'skills'), 'user'))

  // Project-scope skills
  if (projectPath) {
    all.push(...scanSkillDir(path.join(projectPath, '.claude', 'skills'), 'project'))
  }

  // Dedup by kind+name (project takes precedence over user)
  const seen = new Map<string, SlashCommand>()
  for (const cmd of all) {
    const key = `${cmd.kind}:${cmd.name}`
    if (!seen.has(key) || cmd.scope === 'project') {
      seen.set(key, cmd)
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'command' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
