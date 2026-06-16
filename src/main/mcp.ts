import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const claudeJsonPath = path.join(os.homedir(), '.claude.json')
const authCachePath = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json')

export interface McpServer {
  name: string
  scope: 'global' | 'project'
  projectPath?: string
  transport: 'stdio' | 'sse' | 'http' | 'unknown'
  command?: string
  args?: string[]
  url?: string
  needsAuth: boolean
  config: Record<string, unknown>
}

function readClaudeJson(): any {
  try {
    return JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
  } catch {
    return {}
  }
}

function authNeeded(): Set<string> {
  const set = new Set<string>()
  try {
    const cache = JSON.parse(fs.readFileSync(authCachePath, 'utf-8'))
    // Cache shape varies; collect any server names present.
    const collect = (o: unknown) => {
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (v === true) set.add(k)
          else if (typeof v === 'object') collect(v)
        }
      }
    }
    collect(cache)
  } catch {
    // ignore
  }
  return set
}

function transportOf(cfg: any): McpServer['transport'] {
  if (cfg.command) return 'stdio'
  if (cfg.type === 'sse' || (cfg.url && cfg.type === 'sse')) return 'sse'
  if (cfg.type === 'http' || cfg.url) return 'http'
  return 'unknown'
}

function toServer(
  name: string,
  cfg: any,
  scope: McpServer['scope'],
  needsAuthSet: Set<string>,
  projectPath?: string
): McpServer {
  return {
    name,
    scope,
    projectPath,
    transport: transportOf(cfg),
    command: cfg.command,
    args: cfg.args,
    url: cfg.url,
    needsAuth: needsAuthSet.has(name),
    config: cfg
  }
}

export function listMcpServers(): McpServer[] {
  const raw = readClaudeJson()
  const needs = authNeeded()
  const servers: McpServer[] = []

  if (raw.mcpServers && typeof raw.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(raw.mcpServers)) {
      servers.push(toServer(name, cfg, 'global', needs))
    }
  }

  if (raw.projects && typeof raw.projects === 'object') {
    for (const [projectPath, pdata] of Object.entries<any>(raw.projects)) {
      if (pdata?.mcpServers && typeof pdata.mcpServers === 'object') {
        for (const [name, cfg] of Object.entries(pdata.mcpServers)) {
          servers.push(toServer(name, cfg, 'project', needs, projectPath))
        }
      }
    }
  }

  return servers.sort((a, b) => a.name.localeCompare(b.name))
}

function backupAndWrite(data: unknown): void {
  if (fs.existsSync(claudeJsonPath)) {
    fs.copyFileSync(claudeJsonPath, `${claudeJsonPath}.bak`)
  }
  fs.writeFileSync(claudeJsonPath, JSON.stringify(data, null, 2))
}

/** Add or update a global MCP server. cfg is the raw server config object. */
export function upsertGlobalMcpServer(name: string, cfg: Record<string, unknown>): McpServer[] {
  const raw = readClaudeJson()
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') raw.mcpServers = {}
  raw.mcpServers[name] = cfg
  backupAndWrite(raw)
  return listMcpServers()
}

export function removeGlobalMcpServer(name: string): McpServer[] {
  const raw = readClaudeJson()
  if (raw.mcpServers && typeof raw.mcpServers === 'object') {
    delete raw.mcpServers[name]
    backupAndWrite(raw)
  }
  return listMcpServers()
}

/** Build the mcpServers object to pass to the Agent SDK for a given project. */
export function mcpServersForProject(projectPath?: string): Record<string, unknown> {
  const raw = readClaudeJson()
  const out: Record<string, unknown> = {}
  if (raw.mcpServers && typeof raw.mcpServers === 'object') {
    Object.assign(out, raw.mcpServers)
  }
  if (
    projectPath &&
    raw.projects?.[projectPath]?.mcpServers &&
    typeof raw.projects[projectPath].mcpServers === 'object'
  ) {
    Object.assign(out, raw.projects[projectPath].mcpServers)
  }
  return out
}
