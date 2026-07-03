import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentDef, Session } from '../types'
import { useModalA11y } from '../hooks/useModalA11y'
import './views.css'
import './RoomsView.css'

interface Props {
  sessions: Session[]
  runningIds: Set<string>
  attentionIds: Set<string>
  onOpenSession: (id: string) => void
  onOpenAgentsView: () => void
  onDeploy: (agent: AgentDef, projectPath: string | undefined, prompt: string) => void
}

interface Room {
  key: string
  label: string
  path?: string
  sessions: Session[]
}

const MAX_VISIBLE_CHIPS = 8

function folderBasename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || trimmed || p
}

export default function RoomsView({ sessions, runningIds, attentionIds, onOpenAgentsView, onOpenSession, onDeploy }: Props) {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [dragOverRoom, setDragOverRoom] = useState<string | null>(null)
  // Mission popover: which room it targets (undefined path = Unassigned / new), which agent,
  // and whether it's the top-level "Deploy agent" flow (needs a room + agent picker too).
  const [mission, setMission] = useState<{
    roomKey: string
    projectPath?: string
    agentId?: string
    pickRoom?: boolean
  } | null>(null)
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.agentsList().then(setAgents)
  }, [])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  // Only sessions with at least one message "live" in a room.
  const occupied = useMemo(() => sessions.filter((s) => s.messages.length > 0), [sessions])

  const rooms: Room[] = useMemo(() => {
    const byPath = new Map<string, Session[]>()
    const unassigned: Session[] = []
    for (const s of occupied) {
      if (s.projectPath) {
        const list = byPath.get(s.projectPath) ?? []
        list.push(s)
        byPath.set(s.projectPath, list)
      } else {
        unassigned.push(s)
      }
    }
    const result: Room[] = Array.from(byPath.entries()).map(([path, list]) => ({
      key: path,
      label: folderBasename(path),
      path,
      sessions: list.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    result.sort((a, b) => a.label.localeCompare(b.label))
    if (unassigned.length > 0) {
      result.push({
        key: '__unassigned__',
        label: 'Unassigned',
        sessions: unassigned.sort((a, b) => b.updatedAt - a.updatedAt)
      })
    }
    return result
  }, [occupied])

  const workingCount = occupied.filter((s) => runningIds.has(s.id)).length
  const waitingCount = occupied.filter((s) => attentionIds.has(s.id)).length
  const summary =
    occupied.length === 0
      ? 'No agents deployed yet'
      : `${workingCount} agent${workingCount === 1 ? '' : 's'} working${waitingCount > 0 ? ` · ${waitingCount} waiting for approval` : ''}`

  const openMissionForRoom = (room: Room, agentId?: string) => {
    setMission({ roomKey: room.key, projectPath: room.path, agentId })
  }

  const handleDrop = (room: Room) => {
    setDragOverRoom(null)
    if (!dragAgentId) return
    openMissionForRoom(room, dragAgentId)
    setDragAgentId(null)
  }

  const deployFromMission = (prompt: string) => {
    if (!mission || !mission.agentId) return
    const agent = agentById.get(mission.agentId)
    if (!agent) return
    onDeploy(agent, mission.projectPath, prompt)
    setMission(null)
  }

  const startTopLevelDeploy = () => {
    setMission({ roomKey: rooms[0]?.key ?? '__unassigned__', projectPath: rooms[0]?.path, pickRoom: true })
  }

  const pickNewRoom = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) {
      setMission((m) => (m ? { ...m, roomKey: path, projectPath: path } : m))
    }
  }

  return (
    <div className="view rooms-view">
      <div className="view-header">
        <div>
          <h1>Rooms</h1>
          <p className="view-sub">{summary}</p>
        </div>
        <div className="header-actions">
          <button className="btn-primary" onClick={startTopLevelDeploy} disabled={agents.length === 0}>
            + Deploy agent
          </button>
        </div>
      </div>

      <AgentShelf agents={agents} onDragAgent={setDragAgentId} onOpenAgentsView={onOpenAgentsView} />

      <div className="view-scroll">
        {rooms.length === 0 ? (
          <div className="view-empty">
            <div className="view-empty-icon">🏠</div>
            <div className="view-empty-msg">
              No rooms yet. Start a chat in a project folder, or drag an agent from the shelf above to deploy one.
            </div>
          </div>
        ) : (
          <div className="rooms-grid">
            {rooms.map((room) => (
              <RoomCard
                key={room.key}
                room={room}
                agentById={agentById}
                runningIds={runningIds}
                attentionIds={attentionIds}
                isDropTarget={dragOverRoom === room.key}
                expanded={expandedRoom === room.key}
                onToggleExpand={() => setExpandedRoom((k) => (k === room.key ? null : room.key))}
                onDragOver={() => dragAgentId && setDragOverRoom(room.key)}
                onDragLeave={() => setDragOverRoom((k) => (k === room.key ? null : k))}
                onDrop={() => handleDrop(room)}
                onOpenSession={onOpenSession}
                onAddClick={() => openMissionForRoom(room)}
              />
            ))}
          </div>
        )}
      </div>

      {mission && (
        <MissionPopover
          mission={mission}
          agents={agents}
          rooms={rooms}
          onPickAgent={(id) => setMission((m) => (m ? { ...m, agentId: id } : m))}
          onPickRoomKey={(key) => {
            const room = rooms.find((r) => r.key === key)
            setMission((m) => (m ? { ...m, roomKey: key, projectPath: room?.path } : m))
          }}
          onPickNewRoom={pickNewRoom}
          onCancel={() => setMission(null)}
          onDeploy={deployFromMission}
        />
      )}
    </div>
  )
}

// ─── Agent shelf ─────────────────────────────────────────────────────────────
function AgentShelf({
  agents,
  onDragAgent,
  onOpenAgentsView
}: {
  agents: AgentDef[]
  onDragAgent: (id: string | null) => void
  onOpenAgentsView: () => void
}) {
  return (
    <div className="agent-shelf">
      {agents.length === 0 ? (
        <div className="agent-shelf-empty">
          No agents yet —{' '}
          <button className="btn-text" onClick={onOpenAgentsView}>
            create one in Agents
          </button>
          .
        </div>
      ) : (
        <div className="agent-shelf-list">
          {agents.map((a) => (
            <div
              key={a.id}
              className="shelf-card"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/agent-id', a.id)
                e.dataTransfer.effectAllowed = 'copy'
                onDragAgent(a.id)
              }}
              onDragEnd={() => onDragAgent(null)}
              title={`Drag into a room to deploy ${a.name}`}
            >
              <span className="shelf-card-icon">{a.icon}</span>
              <span className="shelf-card-name">{a.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Room card ───────────────────────────────────────────────────────────────
function RoomCard({
  room,
  agentById,
  runningIds,
  attentionIds,
  isDropTarget,
  expanded,
  onToggleExpand,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenSession,
  onAddClick
}: {
  room: Room
  agentById: Map<string, AgentDef>
  runningIds: Set<string>
  attentionIds: Set<string>
  isDropTarget: boolean
  expanded: boolean
  onToggleExpand: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onOpenSession: (id: string) => void
  onAddClick: () => void
}) {
  const visible = expanded ? room.sessions : room.sessions.slice(0, MAX_VISIBLE_CHIPS)
  const overflow = room.sessions.length - visible.length

  return (
    <div
      className={`room-card ${isDropTarget ? 'drop-target' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
    >
      <div className="room-card-head">
        <div className="room-card-title" title={room.path ?? 'Sessions with no project folder'}>
          {room.label}
        </div>
        <span className="room-card-count">{room.sessions.length}</span>
        <button className="room-add-btn" onClick={onAddClick} title="Deploy an agent into this room">
          +
        </button>
      </div>
      <div className="room-floor">
        {room.sessions.length === 0 ? (
          <div className="room-floor-empty">Empty room</div>
        ) : (
          <>
            {visible.map((s) => (
              <OccupantChip
                key={s.id}
                session={s}
                agent={s.agentId ? agentById.get(s.agentId) : undefined}
                running={runningIds.has(s.id)}
                attention={attentionIds.has(s.id)}
                onClick={() => onOpenSession(s.id)}
              />
            ))}
            {overflow > 0 && (
              <button className="occupant-chip overflow-chip" onClick={onToggleExpand} title="Show all occupants">
                +{overflow} more
              </button>
            )}
            {expanded && room.sessions.length > MAX_VISIBLE_CHIPS && (
              <button className="occupant-chip overflow-chip" onClick={onToggleExpand} title="Collapse">
                Show less
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Occupant chip ───────────────────────────────────────────────────────────
function OccupantChip({
  session,
  agent,
  running,
  attention,
  onClick
}: {
  session: Session
  agent?: AgentDef
  running: boolean
  attention: boolean
  onClick: () => void
}) {
  const lastMsg = session.messages[session.messages.length - 1]
  const status = attention ? 'attention' : running ? 'running' : lastMsg?.error ? 'error' : 'idle'
  const statusTitle =
    status === 'attention'
      ? 'Waiting for approval'
      : status === 'running'
        ? 'Running'
        : status === 'error'
          ? 'Ended with an error'
          : 'Idle'
  const icon = agent?.icon ?? '✳'
  return (
    <button
      className="occupant-chip"
      onClick={onClick}
      title={`${session.name || 'New chat'} — ${statusTitle}`}
    >
      <span className="occupant-avatar">
        {icon}
        <span className={`occupant-dot ${status}`} />
      </span>
      <span className="occupant-name">{session.name || 'New chat'}</span>
    </button>
  )
}

// ─── Mission popover (deploy flow) ──────────────────────────────────────────
function MissionPopover({
  mission,
  agents,
  rooms,
  onPickAgent,
  onPickRoomKey,
  onPickNewRoom,
  onCancel,
  onDeploy
}: {
  mission: { roomKey: string; projectPath?: string; agentId?: string; pickRoom?: boolean }
  agents: AgentDef[]
  rooms: Room[]
  onPickAgent: (id: string) => void
  onPickRoomKey: (key: string) => void
  onPickNewRoom: () => void
  onCancel: () => void
  onDeploy: (prompt: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(dialogRef, onCancel)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const roomLabel =
    mission.roomKey === '__unassigned__'
      ? 'Unassigned'
      : rooms.find((r) => r.key === mission.roomKey)?.label ?? folderBasename(mission.projectPath ?? '')

  const canDeploy = !!mission.agentId && prompt.trim().length > 0

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal mission-popover" ref={dialogRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Deploy agent{mission.pickRoom ? '' : ` · ${roomLabel}`}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {mission.pickRoom && (
            <div className="form-group">
              <label>Room</label>
              <select
                className="text-input"
                value={mission.roomKey}
                onChange={(e) => {
                  if (e.target.value === '__new__') onPickNewRoom()
                  else onPickRoomKey(e.target.value)
                }}
              >
                {rooms.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
                {/* A folder just picked via "New room…" that has no existing room card yet. */}
                {mission.projectPath && !rooms.some((r) => r.key === mission.roomKey) && mission.roomKey !== '__unassigned__' && (
                  <option value={mission.roomKey}>{folderBasename(mission.projectPath)} (new)</option>
                )}
                <option value="__unassigned__">Unassigned</option>
                <option value="__new__">New room…</option>
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Agent</label>
            <select
              className="text-input"
              value={mission.agentId ?? ''}
              onChange={(e) => onPickAgent(e.target.value)}
            >
              <option value="" disabled>Choose an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>First prompt</label>
            <textarea
              ref={taRef}
              className="text-input textarea"
              rows={3}
              placeholder="What should this agent start working on?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canDeploy) onDeploy(prompt.trim())
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => onDeploy(prompt.trim())} disabled={!canDeploy}>
            Deploy
          </button>
        </div>
      </div>
    </div>
  )
}
