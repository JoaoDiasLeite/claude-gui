import { useEffect, useState } from 'react'
import { AgentDef, ModelInfo, PermissionMode } from '../types'
import ModelPicker from '../components/ModelPicker'
import './views.css'

interface Props {
  models: ModelInfo[]
  defaultModel: string
  onRun: (agent: AgentDef) => void
}

const TOOL_OPTIONS = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite']
const ICON_OPTIONS = ['🤖', '🧠', '🔧', '🔍', '📝', '🚀', '🛡️', '⚡', '📊', '🧪']
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: 'Ask each time',
  acceptEdits: 'Auto-accept edits',
  bypassPermissions: 'Full access (no prompts)',
  plan: 'Plan only (read-only)'
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function emptyAgent(defaultModel: string): AgentDef {
  return {
    id: genId(),
    name: '',
    icon: '🤖',
    systemPrompt: '',
    model: defaultModel,
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

export default function AgentsView({ models, defaultModel, onRun }: Props) {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [editing, setEditing] = useState<AgentDef | null>(null)

  const load = async () => setAgents(await window.electronAPI.agentsList())
  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!editing || !editing.name.trim()) return
    await window.electronAPI.agentsSave({ ...editing, updatedAt: Date.now() })
    setEditing(null)
    load()
  }

  const remove = async (id: string) => {
    setAgents(await window.electronAPI.agentsDelete(id))
  }

  const toggleTool = (tool: string) => {
    if (!editing) return
    const has = editing.allowedTools.includes(tool)
    setEditing({
      ...editing,
      allowedTools: has
        ? editing.allowedTools.filter((t) => t !== tool)
        : [...editing.allowedTools, tool]
    })
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Agents</h1>
          <p className="view-sub">Custom agents with their own prompt, model, and tools.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(emptyAgent(defaultModel))}>
          + New agent
        </button>
      </div>

      <div className="view-scroll">
        {agents.length === 0 ? (
          <div className="view-empty">No agents yet. Create one to get started.</div>
        ) : (
          <div className="agents-grid">
            {agents.map((a) => (
              <div key={a.id} className="agent-card">
                <div className="agent-card-icon">{a.icon}</div>
                <div className="agent-card-name">{a.name}</div>
                <div className="agent-card-model">{models.find((m) => a.model.startsWith(m.id))?.label ?? a.model}</div>
                <div className="agent-card-prompt">{a.systemPrompt || 'No system prompt'}</div>
                <div className="agent-card-tools">
                  {a.allowedTools.slice(0, 5).map((t) => (
                    <span key={t} className="tool-chip">{t}</span>
                  ))}
                  {a.allowedTools.length > 5 && <span className="tool-chip">+{a.allowedTools.length - 5}</span>}
                </div>
                <div className="agent-card-actions">
                  <button className="btn-primary small" onClick={() => onRun(a)}>Run</button>
                  <button className="btn-ghost small" onClick={() => setEditing(a)}>Edit</button>
                  <button className="btn-text danger" onClick={() => remove(a.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{agents.find((a) => a.id === editing.id) ? 'Edit agent' : 'New agent'}</h3>
              <button className="icon-btn" onClick={() => setEditing(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="agent-edit-row">
                <div className="form-group icon-group">
                  <label>Icon</label>
                  <div className="icon-options">
                    {ICON_OPTIONS.map((ic) => (
                      <button
                        key={ic}
                        className={`icon-option ${editing.icon === ic ? 'selected' : ''}`}
                        onClick={() => setEditing({ ...editing, icon: ic })}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group grow">
                  <label>Name</label>
                  <input
                    className="text-input"
                    value={editing.name}
                    placeholder="e.g. Code Reviewer"
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-group">
                <label>System prompt</label>
                <textarea
                  className="text-input textarea"
                  rows={5}
                  value={editing.systemPrompt}
                  placeholder="Describe the agent's role, expertise, and how it should behave…"
                  onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                />
              </div>

              <div className="agent-edit-row">
                <div className="form-group">
                  <label>Model</label>
                  <ModelPicker
                    models={models}
                    value={editing.model}
                    onChange={(m) => setEditing({ ...editing, model: m })}
                  />
                </div>
                <div className="form-group grow">
                  <label>Permissions</label>
                  <select
                    className="text-input"
                    value={editing.permissionMode}
                    onChange={(e) => setEditing({ ...editing, permissionMode: e.target.value as PermissionMode })}
                  >
                    {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((pm) => (
                      <option key={pm} value={pm}>{PERMISSION_LABELS[pm]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Allowed tools</label>
                <div className="tool-checklist">
                  {TOOL_OPTIONS.map((t) => (
                    <button
                      key={t}
                      className={`tool-toggle ${editing.allowedTools.includes(t) ? 'on' : ''}`}
                      onClick={() => toggleTool(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={!editing.name.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
