import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface AgentDef {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  allowedTools: string[]
  defaultProjectPath?: string
  createdAt: number
  updatedAt: number
}

const agentsDir = path.join(app.getPath('userData'), 'agents')

export function ensureAgentsDir(): void {
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true })
}

export function listAgents(): AgentDef[] {
  ensureAgentsDir()
  try {
    return fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(agentsDir, f), 'utf-8')))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function saveAgent(agent: AgentDef): AgentDef {
  ensureAgentsDir()
  fs.writeFileSync(path.join(agentsDir, `${agent.id}.json`), JSON.stringify(agent, null, 2))
  return agent
}

export function deleteAgent(id: string): void {
  const p = path.join(agentsDir, `${id}.json`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export function getAgent(id: string): AgentDef | null {
  const p = path.join(agentsDir, `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}
