import * as fs from 'fs'
import * as path from 'path'

export interface ResolvedCli {
  command: string
  prefixArgs: string[]
}

/**
 * Resolve how to safely invoke an npm-globally-installed CLI without a shell.
 *
 * On Windows, npm installs a `.cmd` shim, and Windows' CreateProcess refuses to
 * run `.cmd`/`.bat` files directly (confirmed: spawning one without a shell
 * throws EINVAL) — only `cmd.exe` can launch them. The obvious fix,
 * `spawn(cmd, args, { shell: true })`, turned out to be unsafe AND unreliable
 * here: Node's own DEP0190 warning says shell:true does not escape an args
 * array, and a real run reproduced the breakage (a legitimate flag like `-a`
 * came back as "unexpected argument", i.e. argument boundaries got corrupted).
 * That matters because `prompt` is arbitrary chat text passed as an argument —
 * unescaped shell concatenation there is a real injection risk, not just a
 * correctness bug.
 *
 * The actual fix: skip the `.cmd` shim entirely. It's a thin, standardized npm
 * launcher that just does `node "<pkg>/bin/entry.js" %*` — so invoking
 * `node.exe <that same entry.js>` directly reaches the identical CLI, with
 * ordinary safe array-based argv and no shell involved. Verified against both
 * installed CLIs: identical output to the shim, `-a` no longer misparsed.
 *
 * On macOS/Linux the installed binary is directly executable — no shim, no
 * shell needed either way.
 */
function resolveWindowsEntry(pkgRelativeJs: string[]): string | null {
  const roots: string[] = []
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm'))
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'nodejs'))
  for (const root of roots) {
    const candidate = path.join(root, 'node_modules', ...pkgRelativeJs)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export function resolveCodex(): ResolvedCli {
  if (process.platform === 'win32') {
    const entry = resolveWindowsEntry(['@openai', 'codex', 'bin', 'codex.js'])
    if (entry) return { command: 'node', prefixArgs: [entry] }
  }
  return { command: 'codex', prefixArgs: [] }
}

export function resolveGemini(): ResolvedCli {
  if (process.platform === 'win32') {
    const entry = resolveWindowsEntry(['@google', 'gemini-cli', 'bundle', 'gemini.js'])
    if (entry) return { command: 'node', prefixArgs: [entry] }
  }
  return { command: 'gemini', prefixArgs: [] }
}
