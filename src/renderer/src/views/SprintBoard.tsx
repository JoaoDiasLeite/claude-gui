import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sprint, SprintItem, ItemStatus, SprintStatus, CCAccountStatus, ModelInfo } from '../types'
import './views.css'
import './PlannerView.css'
import './SprintBoard.css'

export type PlannerMode = 'week' | 'sprint'

interface SprintBoardProps {
  mode: PlannerMode
  onMode: (m: PlannerMode) => void
  accounts: CCAccountStatus[]
  models: ModelInfo[]
  defaultModel: string
  defaultAccountId: string
}

// ─── Date helpers (local time, never round-trip through UTC) ────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(dateStr: string, n: number): string {
  const d = parseYmd(dateStr)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const uid = () =>
  crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`

const COLUMNS: { status: ItemStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in-progress', label: 'In progress' },
  { status: 'done', label: 'Done' }
]
const STATUS_LABELS: Record<SprintStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed'
}

function pointsOf(i: SprintItem): number {
  return typeof i.points === 'number' && i.points > 0 ? i.points : 0
}

// Shared Week|Sprint segmented toggle — rendered by both PlannerView and SprintBoard so
// the control sits in the same header slot regardless of the active mode.
export function PlannerModeToggle({ mode, onMode }: { mode: PlannerMode; onMode: (m: PlannerMode) => void }) {
  return (
    <div className="seg-control planner-mode" title="Switch between the weekly planner and the sprint board">
      {(['week', 'sprint'] as const).map((m) => (
        <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>
          {m === 'week' ? 'Week' : 'Sprint'}
        </button>
      ))}
    </div>
  )
}

export default function SprintBoard({ mode, onMode }: SprintBoardProps) {
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [drag, setDrag] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<ItemStatus | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [sprintModal, setSprintModal] = useState<'new' | 'edit' | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = sprints.find((s) => s.id === activeId) ?? null

  // Load all sprints on mount; select the most-recently-updated one.
  useEffect(() => {
    let cancelled = false
    window.electronAPI.sprintList().then((list) => {
      if (cancelled) return
      setSprints(list)
      setActiveId((prev) => prev || list[0]?.id || '')
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Persist one sprint (debounced) and keep it in the in-memory list.
  const persist = (next: Sprint) => {
    setSprints((prev) => {
      const has = prev.some((s) => s.id === next.id)
      return has ? prev.map((s) => (s.id === next.id ? next : s)) : [next, ...prev]
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.electronAPI.sprintSave(next), 350)
  }

  // Mutate the active sprint immutably, then persist.
  const mutate = (fn: (s: Sprint) => Sprint) => {
    if (!active) return
    persist(fn(active))
  }

  // ─── Sprint CRUD ──────────────────────────────────────────────────────────
  const createSprint = (draft: { name: string; goal: string; startDate: string; endDate: string; status: SprintStatus }) => {
    const now = Date.now()
    const s: Sprint = {
      id: uid(),
      name: draft.name.trim() || `Sprint ${sprints.length + 1}`,
      goal: draft.goal.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      status: draft.status,
      items: [],
      standups: [],
      createdAt: now,
      updatedAt: now
    }
    persist(s)
    setActiveId(s.id)
    setSprintModal(null)
  }
  const patchSprint = (patch: Partial<Sprint>) => mutate((s) => ({ ...s, ...patch }))
  const deleteSprint = async () => {
    if (!active) return
    const list = await window.electronAPI.sprintDelete(active.id)
    setSprints(list)
    setActiveId(list[0]?.id ?? '')
    setSprintModal(null)
  }

  // ─── Item CRUD ────────────────────────────────────────────────────────────
  const addItem = (status: ItemStatus, title: string) => {
    const t = title.trim()
    if (!t) return
    mutate((s) => ({
      ...s,
      items: [
        ...s.items,
        { id: uid(), title: t, status, points: null, createdAt: Date.now(), completedAt: status === 'done' ? Date.now() : null }
      ]
    }))
  }
  const updateItem = (id: string, patch: Partial<SprintItem>) =>
    mutate((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === id ? applyItemPatch(i, patch) : i))
    }))
  const deleteItem = (id: string) => mutate((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }))
  const moveItem = (id: string, status: ItemStatus) => updateItem(id, { status })

  // ─── Metrics ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const items = active?.items ?? []
    const total = items.reduce((n, i) => n + pointsOf(i), 0)
    const done = items.filter((i) => i.status === 'done').reduce((n, i) => n + pointsOf(i), 0)
    const byCol = (st: ItemStatus) => items.filter((i) => i.status === st)
    const pct = total ? Math.round((done / total) * 100) : 0
    return { total, done, remaining: total - done, count: items.length, byCol, pct }
  }, [active])

  const editingItem = active?.items.find((i) => i.id === editingItemId) ?? null

  return (
    <div className="view">
      <div className="view-header planner-header">
        <div className="sprint-head-left">
          <PlannerModeToggle mode={mode} onMode={onMode} />
          {active && (
            <div>
              <h1 className="sprint-title">{active.name}</h1>
              <p className="view-sub">
                {parseYmd(active.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {' – '}
                {parseYmd(active.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {' · '}
                {stats.done}/{stats.total} pts · {stats.count} items
              </p>
            </div>
          )}
        </div>
        <div className="planner-header-actions">
          {sprints.length > 0 && (
            <SprintSwitcher
              sprints={sprints}
              activeId={activeId}
              onSelect={setActiveId}
            />
          )}
          {active && (
            <button className="assist-btn" onClick={() => setSprintModal('edit')} title="Sprint settings">
              <GearIcon /> Settings
            </button>
          )}
          <button className="assist-btn primary" onClick={() => setSprintModal('new')}>
            + New sprint
          </button>
        </div>
      </div>

      {loading ? (
        <div className="view-loading">
          <div className="view-spinner" />
          <span className="view-loading-text">Loading sprints…</span>
        </div>
      ) : !active ? (
        <div className="sprint-empty">
          <div className="sprint-empty-card">
            <h2>No sprints yet</h2>
            <p>Create your first sprint to plan work on a Scrum board, log daily standups, and track a burndown.</p>
            <button className="assist-btn primary wide" onClick={() => setSprintModal('new')}>
              + New sprint
            </button>
          </div>
        </div>
      ) : (
        <div className="view-scroll sprint-scroll">
          {active.goal?.trim() && (
            <div className="sprint-goal">
              <span className="planner-label">Sprint goal</span>
              <p>{active.goal}</p>
            </div>
          )}

          {/* Kanban board */}
          <div className="sprint-board">
            {COLUMNS.map((col) => {
              const colItems = stats.byCol(col.status)
              const pts = colItems.reduce((n, i) => n + pointsOf(i), 0)
              return (
                <div
                  key={col.status}
                  className={`sprint-col ${overCol === col.status ? 'over' : ''} ${col.status}`}
                  onDragOver={(e) => {
                    if (drag) {
                      e.preventDefault()
                      setOverCol(col.status)
                    }
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget === e.target) setOverCol(null)
                  }}
                  onDrop={() => {
                    if (drag) moveItem(drag, col.status)
                    setDrag(null)
                    setOverCol(null)
                  }}
                >
                  <div className="sprint-col-head">
                    <span className="sprint-col-name">{col.label}</span>
                    <span className="sprint-col-count">
                      {colItems.length}
                      {pts > 0 && <em> · {pts}p</em>}
                    </span>
                  </div>
                  <div className="sprint-col-items">
                    {colItems.map((i) => (
                      <ItemCard
                        key={i.id}
                        item={i}
                        onDragStart={() => setDrag(i.id)}
                        onDragEnd={() => {
                          setDrag(null)
                          setOverCol(null)
                        }}
                        onOpen={() => setEditingItemId(i.id)}
                        onToggleDone={() =>
                          moveItem(i.id, i.status === 'done' ? 'todo' : 'done')
                        }
                        onDelete={() => deleteItem(i.id)}
                      />
                    ))}
                    <AddItemInline onAdd={(t) => addItem(col.status, t)} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sprintModal && (
        <SprintModal
          mode={sprintModal}
          sprint={sprintModal === 'edit' ? active : null}
          onCreate={createSprint}
          onPatch={patchSprint}
          onDelete={deleteSprint}
          onClose={() => setSprintModal(null)}
        />
      )}

      {editingItem && (
        <ItemModal
          item={editingItem}
          onPatch={(patch) => updateItem(editingItem.id, patch)}
          onDelete={() => {
            deleteItem(editingItem.id)
            setEditingItemId(null)
          }}
          onClose={() => setEditingItemId(null)}
        />
      )}
    </div>
  )
}

// Setting an item to 'done' stamps completedAt (burndown anchor); leaving 'done' clears it.
function applyItemPatch(item: SprintItem, patch: Partial<SprintItem>): SprintItem {
  const next = { ...item, ...patch }
  if (patch.status !== undefined && patch.status !== item.status) {
    if (patch.status === 'done') next.completedAt = item.completedAt ?? Date.now()
    else next.completedAt = null
  }
  return next
}

// ─── Sprint switcher (custom dropdown — native <select> popups don't render here) ──
function SprintSwitcher({
  sprints,
  activeId,
  onSelect
}: {
  sprints: Sprint[]
  activeId: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = sprints.find((s) => s.id === activeId)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div className="sprint-switcher" ref={ref}>
      <button className="assist-btn" onClick={() => setOpen((v) => !v)}>
        {active?.name ?? 'Select sprint'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="sprint-switcher-menu">
          {sprints.map((s) => (
            <button
              key={s.id}
              className={`sprint-switcher-item ${s.id === activeId ? 'on' : ''}`}
              onClick={() => {
                onSelect(s.id)
                setOpen(false)
              }}
            >
              <span className={`sprint-status-dot ${s.status}`} />
              <span className="sprint-switcher-name">{s.name}</span>
              <span className="sprint-switcher-status">{STATUS_LABELS[s.status]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Item card ──────────────────────────────────────────────────────────────
function ItemCard(props: {
  item: SprintItem
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onToggleDone: () => void
  onDelete: () => void
}) {
  const i = props.item
  return (
    <div
      className={`sprint-item ${i.status === 'done' ? 'done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart()
      }}
      onDragEnd={props.onDragEnd}
      onClick={props.onOpen}
      title="Click to edit · drag to move"
    >
      <div className="sprint-item-main">
        <button
          className={`task-check ${i.status === 'done' ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleDone()
          }}
          title={i.status === 'done' ? 'Mark not done' : 'Mark done'}
        >
          {i.status === 'done' ? '✓' : ''}
        </button>
        <span className="sprint-item-title">{i.title}</span>
        <button
          className="task-del"
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete()
          }}
          title="Delete"
        >
          ×
        </button>
      </div>
      {pointsOf(i) > 0 && (
        <div className="sprint-item-meta">
          <span className="sprint-points">{pointsOf(i)} pts</span>
        </div>
      )}
    </div>
  )
}

function AddItemInline({ onAdd }: { onAdd: (t: string) => void }) {
  const [val, setVal] = useState('')
  return (
    <input
      className="add-task-inline"
      placeholder="+ add item"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && val.trim()) {
          onAdd(val)
          setVal('')
        }
      }}
      onBlur={() => {
        if (val.trim()) {
          onAdd(val)
          setVal('')
        }
      }}
    />
  )
}

// ─── Item editor modal ────────────────────────────────────────────────────────
const POINT_CHOICES = [1, 2, 3, 5, 8, 13]
function ItemModal(props: {
  item: SprintItem
  onPatch: (patch: Partial<SprintItem>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const i = props.item
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(
    <div className="task-modal-overlay" onClick={props.onClose}>
      <div className="task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-modal-head">
          <span className="task-modal-heading">Edit item</span>
          <button className="chip-x lg" onClick={props.onClose}>×</button>
        </div>
        <div className="task-modal-body">
          <textarea
            className="text-input task-modal-title"
            rows={2}
            value={i.title}
            placeholder="Item title"
            autoFocus
            onChange={(e) => props.onPatch({ title: e.target.value })}
          />

          <div className="task-modal-field">
            <span className="task-modal-label">Status</span>
            <div className="pill-row">
              {COLUMNS.map((c) => (
                <button
                  key={c.status}
                  className={`pill ${i.status === c.status ? 'on' : ''}`}
                  onClick={() => props.onPatch({ status: c.status })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="task-modal-field">
            <span className="task-modal-label">Story points</span>
            <div className="pill-row">
              <button className={`pill ${!i.points ? 'on' : ''}`} onClick={() => props.onPatch({ points: null })}>
                —
              </button>
              {POINT_CHOICES.map((p) => (
                <button
                  key={p}
                  className={`pill ${i.points === p ? 'on' : ''}`}
                  onClick={() => props.onPatch({ points: p })}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="task-modal-field">
            <span className="task-modal-label">Notes</span>
            <textarea
              className="text-input"
              rows={3}
              value={i.notes ?? ''}
              placeholder="Optional detail, acceptance criteria…"
              onChange={(e) => props.onPatch({ notes: e.target.value || null })}
            />
          </div>
        </div>
        <div className="task-modal-foot">
          <button className="btn-text danger" onClick={props.onDelete}>Delete item</button>
          <button className="assist-btn primary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Sprint create/settings modal ──────────────────────────────────────────────
function SprintModal(props: {
  mode: 'new' | 'edit'
  sprint: Sprint | null
  onCreate: (draft: { name: string; goal: string; startDate: string; endDate: string; status: SprintStatus }) => void
  onPatch: (patch: Partial<Sprint>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const isEdit = props.mode === 'edit' && props.sprint
  const today = ymd(new Date())
  const [name, setName] = useState(props.sprint?.name ?? '')
  const [goal, setGoal] = useState(props.sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(props.sprint?.startDate ?? today)
  const [endDate, setEndDate] = useState(props.sprint?.endDate ?? addDays(today, 13))
  const [status, setStatus] = useState<SprintStatus>(props.sprint?.status ?? 'active')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // In edit mode, changes patch the live sprint immediately (consistent with the debounced save).
  const commitEdit = (patch: Partial<Sprint>) => isEdit && props.onPatch(patch)

  const statuses: SprintStatus[] = ['planning', 'active', 'completed']
  return createPortal(
    <div className="task-modal-overlay" onClick={props.onClose}>
      <div className="task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="task-modal-head">
          <span className="task-modal-heading">{isEdit ? 'Sprint settings' : 'New sprint'}</span>
          <button className="chip-x lg" onClick={props.onClose}>×</button>
        </div>
        <div className="task-modal-body">
          <div className="task-modal-field">
            <span className="task-modal-label">Name</span>
            <input
              className="text-input"
              value={name}
              autoFocus
              placeholder="e.g. Sprint 14 — Checkout revamp"
              onChange={(e) => {
                setName(e.target.value)
                commitEdit({ name: e.target.value })
              }}
            />
          </div>
          <div className="task-modal-field">
            <span className="task-modal-label">Goal</span>
            <textarea
              className="text-input"
              rows={2}
              value={goal}
              placeholder="The one outcome this sprint is about"
              onChange={(e) => {
                setGoal(e.target.value)
                commitEdit({ goal: e.target.value })
              }}
            />
          </div>
          <div className="task-modal-times">
            <label>
              <span className="task-modal-label">Start</span>
              <input
                type="date"
                className="text-input"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  commitEdit({ startDate: e.target.value })
                }}
              />
            </label>
            <label>
              <span className="task-modal-label">End</span>
              <input
                type="date"
                className="text-input"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  commitEdit({ endDate: e.target.value })
                }}
              />
            </label>
          </div>
          <div className="task-modal-field">
            <span className="task-modal-label">Status</span>
            <div className="pill-row">
              {statuses.map((st) => (
                <button
                  key={st}
                  className={`pill ${status === st ? 'on' : ''}`}
                  onClick={() => {
                    setStatus(st)
                    commitEdit({ status: st })
                  }}
                >
                  {STATUS_LABELS[st]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="task-modal-foot">
          {isEdit ? (
            <button className="btn-text danger" onClick={props.onDelete}>Delete sprint</button>
          ) : (
            <span />
          )}
          {isEdit ? (
            <button className="assist-btn primary" onClick={props.onClose}>Done</button>
          ) : (
            <button
              className="assist-btn primary"
              onClick={() => props.onCreate({ name, goal, startDate, endDate, status })}
            >
              Create sprint
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
