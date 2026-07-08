import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Packaged builds load the Agent SDK from inside app.asar, so its own binary
 * resolution lands on an in-asar claude.exe — a path that fs sees but that can't
 * be spawned. Point every query() at the asarUnpack'd copy instead. Returns {}
 * in dev (unpackaged runs resolve normally) or if the unpacked binary is missing,
 * letting the SDK fall back to its own resolution.
 */
export function sdkExecutable(): { pathToClaudeCodeExecutable?: string } {
  if (!app.isPackaged) return {}
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const unpacked = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    exe
  )
  return fs.existsSync(unpacked) ? { pathToClaudeCodeExecutable: unpacked } : {}
}
