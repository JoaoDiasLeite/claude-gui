import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { UsageReport, UsageEntry, SourceInfo, UsageLimits, PlanUsage } from '../types'
import './views.css'
import './UsageView.css'

function fmtNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

type RangeKey = '2d' | 'week' | 'month' | 'year' | 'all'
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '2d', label: 'Last 2 days', days: 2 },
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: 'Last month', days: 30 },
  { key: 'year', label: 'Last year', days: 365 },
  { key: 'all', label: 'All time', days: null }
]

// "resets in 3h 12m" / "resets Mon 14:00" for plan-window reset timestamps.
function fmtReset(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ''
  const mins = Math.round((t - Date.now()) / 60000)
  if (mins <= 0) return 'resets soon'
  if (mins < 60) return `resets in ${mins}m`
  if (mins < 48 * 60) return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m`
  const d = new Date(t)
  return `resets ${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function PlanRow({ label, utilization, resetsAt }: { label: string; utilization: number; resetsAt?: string }) {
  const level = utilization >= 90 ? 'danger' : utilization >= 70 ? 'warn' : 'ok'
  return (
    <div className="limit-row">
      <div className="limit-head">
        <span className="limit-label">{label}</span>
        <span className="limit-figs">
          {resetsAt && <span className="limit-cap">{fmtReset(resetsAt)}</span>}
          <span className={`limit-pct ${level}`}>{utilization.toFixed(0)}% used</span>
        </span>
      </div>
      <div className="limit-track">
        <div className={`limit-fill ${level}`} style={{ width: `${Math.min(100, utilization)}%` }} />
      </div>
    </div>
  )
}

function WindowRow({
  label,
  costUsd,
  tokens,
  cap
}: {
  label: string
  costUsd: number
  tokens: number
  cap: number
}) {
  const hasCap = cap > 0
  const pct = hasCap ? Math.min(100, (costUsd / cap) * 100) : 0
  const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  return (
    <div className="limit-row">
      <div className="limit-head">
        <span className="limit-label">{label}</span>
        <span className="limit-figs">
          {fmtNum(tokens)} tok · <span className="limit-cap">~${costUsd.toFixed(2)}</span>
          {hasCap && (
            <span className={`limit-pct ${level}`}>
              {pct.toFixed(0)}% of ${cap.toFixed(0)}
            </span>
          )}
        </span>
      </div>
      {hasCap && (
        <div className="limit-track">
          <div className={`limit-fill ${level}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function UsageView() {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<RangeKey>('week')
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set())
  const [limits, setLimits] = useState<UsageLimits>({ hourUsd: 10, sessionUsd: 25, weekUsd: 150 })
  const [editingLimits, setEditingLimits] = useState(false)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanUsage | null>(null)

  const apply = (rep: UsageReport, srcs: SourceInfo[], lim: UsageLimits) => {
    setReport(rep)
    setSources(srcs)
    setLimits(lim)
    setActiveSources((prev) => (prev.size ? prev : new Set(srcs.map((s) => s.id))))
  }

  // Recompute in the background (no full-screen spinner) and update in place.
  const refresh = async () => {
    setRefreshing(true)
    window.electronAPI.ccPlanUsage(true).then(setPlan).catch(() => {})
    const [rep, srcs, cfg] = await Promise.all([
      window.electronAPI.ccUsage(true),
      window.electronAPI.ccSources(),
      window.electronAPI.getConfig()
    ])
    apply(rep, srcs, cfg.limits)
    setRefreshing(false)
  }

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      window.electronAPI.ccPlanUsage(false).then((p) => { if (!cancelled) setPlan(p) }).catch(() => {})
      // Paint instantly from cache…
      const [rep, srcs, cfg] = await Promise.all([
        window.electronAPI.ccUsage(false),
        window.electronAPI.ccSources(),
        window.electronAPI.getConfig()
      ])
      if (cancelled) return
      apply(rep, srcs, cfg.limits)
      setLoading(false)
      // …then, if the cache is stale, silently refresh in the background.
      if (Date.now() - rep.generatedAt > 60_000) refresh()
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  const relTime = (ts: number) => {
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return new Date(ts).toLocaleString()
  }

  const toggleSource = (id: string) => {
    setActiveSources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveLimits = async (next: UsageLimits) => {
    setLimits(next)
    await window.electronAPI.setLimits(next)
  }

  // Filter entries by range + active sources, then aggregate.
  const view = useMemo(() => {
    if (!report) return null
    const days = RANGES.find((r) => r.key === range)?.days ?? null
    const cutoff = days ? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10) : null
    const entries = report.entries.filter(
      (e: UsageEntry) =>
        activeSources.has(e.source) && e.day !== 'unknown' && (!cutoff || e.day >= cutoff)
    )

    // source id -> account email/label, for grouping by account.
    const srcMeta = new Map(sources.map((s) => [s.id, s]))
    const accountKey = (sourceId: string) => srcMeta.get(sourceId)?.account?.email || `(${srcMeta.get(sourceId)?.label ?? sourceId})`

    let cost = 0
    let inTok = 0
    let outTok = 0
    let cacheTok = 0
    const byDay = new Map<string, number>()
    const byModel = new Map<string, { costUsd: number; inputTokens: number; outputTokens: number }>()
    const byProject = new Map<string, { costUsd: number; tokens: number }>()
    const byAccount = new Map<string, { email: string; plan?: string; costUsd: number; tokens: number; sources: Set<string> }>()
    for (const e of entries) {
      cost += e.costUsd
      inTok += e.inputTokens
      outTok += e.outputTokens
      cacheTok += e.cacheTokens
      const ak = accountKey(e.source)
      const acc = byAccount.get(ak) ?? { email: ak, plan: srcMeta.get(e.source)?.account?.plan, costUsd: 0, tokens: 0, sources: new Set<string>() }
      acc.costUsd += e.costUsd
      acc.tokens += e.inputTokens + e.outputTokens
      acc.sources.add(srcMeta.get(e.source)?.label ?? e.source)
      byAccount.set(ak, acc)
      byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.costUsd)
      const m = byModel.get(e.model) ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 }
      m.costUsd += e.costUsd
      m.inputTokens += e.inputTokens
      m.outputTokens += e.outputTokens
      byModel.set(e.model, m)
      const p = byProject.get(e.project) ?? { costUsd: 0, tokens: 0 }
      p.costUsd += e.costUsd
      p.tokens += e.inputTokens + e.outputTokens
      byProject.set(e.project, p)
    }
    return {
      cost,
      inTok,
      outTok,
      cacheTok,
      entries,
      byDay: [...byDay.entries()].map(([day, c]) => ({ day, costUsd: c })).sort((a, b) => a.day.localeCompare(b.day)),
      byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
      byProject: [...byProject.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.costUsd - a.costUsd),
      byAccount: [...byAccount.values()]
        .map((a) => ({ ...a, sources: [...a.sources] }))
        .sort((a, b) => b.costUsd - a.costUsd)
    }
  }, [report, range, activeSources, sources])

  // Build a CONTINUOUS timeline (fills empty days with $0) over the selected range,
  // so gaps in activity read correctly. Long ranges bucket by week to keep it legible.
  const chart = useMemo(() => {
    if (!view) return null
    const map = new Map(view.byDay.map((d) => [d.day, d.costUsd]))
    const pad = (n: number) => String(n).padStart(2, '0')
    const ymd = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = RANGES.find((r) => r.key === range)?.days ?? null
    const firstDay = view.byDay[0]?.day // earliest day with activity (byDay is sorted asc)
    let start: Date
    if (days) {
      start = new Date(today)
      start.setDate(start.getDate() - (days - 1))
    } else {
      start = firstDay ? new Date(`${firstDay}T00:00:00`) : new Date(today)
    }
    // Don't render empty time before any activity exists — clamp the window to the first
    // active day (so e.g. "Last year" with only 51 days of history shows 51 days, not 53
    // mostly-empty weeks).
    if (firstDay) {
      const first = new Date(`${firstDay}T00:00:00`)
      if (first > start) start = first
    }
    if (start > today) start = new Date(today)
    const spanDays = Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1
    const weekly = spanDays > 92
    const buckets: { key: string; label: string; cost: number; from: string; to: string }[] = []
    if (!weekly) {
      const cur = new Date(start)
      for (let i = 0; i < spanDays; i++) {
        const k = ymd(cur)
        buckets.push({ key: k, label: `${pad(cur.getMonth() + 1)}/${pad(cur.getDate())}`, cost: map.get(k) ?? 0, from: k, to: k })
        cur.setDate(cur.getDate() + 1)
      }
    } else {
      const cur = new Date(start)
      cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)) // align to Monday
      while (cur <= today) {
        let sum = 0
        for (let i = 0; i < 7; i++) {
          const dd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + i)
          sum += map.get(ymd(dd)) ?? 0
        }
        const end = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 6)
        buckets.push({ key: ymd(cur), label: `${pad(cur.getMonth() + 1)}/${pad(cur.getDate())}`, cost: sum, from: ymd(cur), to: ymd(end) })
        cur.setDate(cur.getDate() + 7)
      }
    }
    const max = Math.max(...buckets.map((b) => b.cost), 0.0001)
    const tickEvery = Math.max(1, Math.ceil(buckets.length / 12))
    return { buckets, max, weekly, tickEvery }
  }, [view, range])

  // Per-bucket breakdown for the detail modal: re-aggregate the filtered entries for the
  // clicked day (or week) into totals, by-model and by-project.
  const detail = useMemo(() => {
    if (!detailKey || !view || !chart) return null
    const bucket = chart.buckets.find((b) => b.key === detailKey)
    if (!bucket) return null
    const es = view.entries.filter((e) => e.day >= bucket.from && e.day <= bucket.to)
    let cost = 0,
      inTok = 0,
      outTok = 0,
      cacheTok = 0
    const byModel = new Map<string, { costUsd: number; inputTokens: number; outputTokens: number }>()
    const byProject = new Map<string, { costUsd: number; tokens: number }>()
    for (const e of es) {
      cost += e.costUsd
      inTok += e.inputTokens
      outTok += e.outputTokens
      cacheTok += e.cacheTokens
      const m = byModel.get(e.model) ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 }
      m.costUsd += e.costUsd
      m.inputTokens += e.inputTokens
      m.outputTokens += e.outputTokens
      byModel.set(e.model, m)
      const p = byProject.get(e.project) ?? { costUsd: 0, tokens: 0 }
      p.costUsd += e.costUsd
      p.tokens += e.inputTokens + e.outputTokens
      byProject.set(e.project, p)
    }
    const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    const title = bucket.from === bucket.to ? fmtDay(bucket.from) : `${fmtDay(bucket.from)} – ${fmtDay(bucket.to)}`
    return {
      title,
      weekly: bucket.from !== bucket.to,
      cost,
      inTok,
      outTok,
      cacheTok,
      byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
      byProject: [...byProject.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.costUsd - a.costUsd)
    }
  }, [detailKey, view, chart])

  // Esc closes the day-detail modal.
  useEffect(() => {
    if (!detailKey) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDetailKey(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailKey])

  if (loading) return (
    <div className="view">
      <div className="view-loading">
        <div className="view-spinner" />
        <span className="view-loading-text">Crunching usage across local + WSL…</span>
      </div>
    </div>
  )
  if (!report || !view) return (
    <div className="view">
      <div className="view-empty">
        <span className="view-empty-icon">📊</span>
        <span className="view-empty-msg">No usage data found. Use Claude Code to start tracking token usage.</span>
      </div>
    </div>
  )

  const win = report.windows

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Usage</h1>
          <p className="view-sub">
            Combined across local and connected WSL distros ·{' '}
            {refreshing ? 'refreshing…' : `updated ${relTime(report.generatedAt)}`}
          </p>
        </div>
        <button className="btn-ghost" onClick={refresh} disabled={refreshing}>
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={refreshing ? 'spin' : ''}
          >
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="view-scroll">
        {/* Real plan usage — live from Anthropic via the Claude Code OAuth token. */}
        {plan && (
          <div className="usage-section">
            <h2>
              Plan usage
              {plan.subscriptionType && (
                <span className="plan-pill">{plan.subscriptionType}{plan.rateLimitTier ? ` · ${plan.rateLimitTier}` : ''}</span>
              )}
            </h2>
            {plan.windows.length > 0 && (
              <div className="limits-grid">
                {plan.windows.map((w) => (
                  <PlanRow key={w.key} label={w.label} utilization={w.utilization} resetsAt={w.resetsAt} />
                ))}
              </div>
            )}
            {plan.status === 'ok' && plan.windows.length === 0 && (
              <p className="field-hint">The usage endpoint responded but reported no rate-limit windows (API keys and some plans don't expose them).</p>
            )}
            {plan.status === 'unauthorized' && (
              <p className="field-hint">
                The Claude Code token has expired — it refreshes automatically the next time a
                Claude run executes (here or in the CLI). Then hit Refresh.
              </p>
            )}
            {plan.status === 'no-credentials' && (
              <p className="field-hint">No Claude Code login found — log in to see real plan usage.</p>
            )}
            {plan.status === 'rate-limited' && (
              <p className="field-hint">
                Anthropic is rate-limiting the usage endpoint right now
                {plan.stale ? ' — showing the last fetched numbers.' : ' — it retries automatically in a couple of minutes.'}
              </p>
            )}
            {plan.status === 'error' && (
              <p className="field-hint">
                Couldn't reach the usage endpoint ({plan.error ?? 'unknown error'})
                {plan.stale ? ' — showing the last fetched numbers.' : '.'}
              </p>
            )}
            {plan.status === 'ok' && plan.windows.length > 0 && (
              <p className="field-hint">
                <strong>Live from Anthropic</strong> — the same numbers as Claude → Settings → Usage
                (fetched via the Claude Code login; unofficial endpoint, cached 5 min).
              </p>
            )}
          </div>
        )}

        {/* Recent activity windows */}
        <div className="usage-section">
          <h2>
            Recent activity
            <button className="btn-text limit-edit" onClick={() => setEditingLimits((v) => !v)}>
              {editingLimits ? 'Done' : 'Set budgets'}
            </button>
          </h2>
          {editingLimits && (
            <div className="limit-edit-row">
              {(['hourUsd', 'sessionUsd', 'weekUsd'] as const).map((k) => (
                <label key={k} className="limit-edit-field">
                  <span>{k === 'hourUsd' ? 'Hour budget $' : k === 'sessionUsd' ? 'Session (5h) $' : 'Week budget $'}</span>
                  <input
                    className="text-input"
                    type="number"
                    placeholder="0 = off"
                    value={limits[k] || ''}
                    onChange={(e) => saveLimits({ ...limits, [k]: Number(e.target.value) || 0 })}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="limits-grid">
            <WindowRow label="Last hour" costUsd={win.hour.costUsd} tokens={win.hour.tokens} cap={limits.hourUsd} />
            <WindowRow label="Last 5 hours (session window)" costUsd={win.session.costUsd} tokens={win.session.tokens} cap={limits.sessionUsd} />
            <WindowRow label="Last 7 days" costUsd={win.week.costUsd} tokens={win.week.tokens} cap={limits.weekUsd} />
          </div>
          <p className="field-hint">
            These are <strong>local estimates</strong> of your own activity (tokens; cost at public
            API rates — not your subscription bill). Your real plan limits and reset times live in
            Claude → Settings → Usage; they're metered server-side and can't be read locally. Set a
            personal budget above to show a progress bar against it.
          </p>
        </div>

        {/* Controls */}
        <div className="usage-controls">
          <div className="range-tabs">
            {RANGES.map((r) => (
              <button key={r.key} className={`range-tab ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          {sources.length > 1 && (
            <div className="source-chips">
              {sources.map((s) => (
                <button
                  key={s.id}
                  className={`source-chip ${activeSources.has(s.id) ? 'on' : ''} ${s.kind}`}
                  onClick={() => toggleSource(s.id)}
                  title={s.account?.email ? `${s.account.email}${s.account.plan ? ` · ${s.account.plan}` : ''}` : undefined}
                >
                  <span className="source-chip-name">{s.kind === 'wsl' ? `⊞ ${s.label}` : s.label}</span>
                  {s.account?.email && <span className="source-chip-acct">{s.account.email}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {(() => {
          const emails = new Set(
            sources.filter((s) => activeSources.has(s.id) && s.account?.email).map((s) => s.account!.email!)
          )
          return emails.size > 1 ? (
            <div className="acct-warn">
              Combining {emails.size} different accounts: {[...emails].join(', ')}. Toggle sources above to view one at a time.
            </div>
          ) : null
        })()}

        {/* Cards */}
        <div className="usage-cards">
          <div className="usage-card usage-card--cost">
            <div className="usage-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="usage-card-value">${view.cost.toFixed(2)}</div>
            <div className="usage-card-label">Est. cost</div>
          </div>
          <div className="usage-card usage-card--in">
            <div className="usage-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
              </svg>
            </div>
            <div className="usage-card-value">{fmtNum(view.inTok)}</div>
            <div className="usage-card-label">Input tokens</div>
          </div>
          <div className="usage-card usage-card--out">
            <div className="usage-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 7 12 3 8 7"/><line x1="12" y1="3" x2="12" y2="12"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
              </svg>
            </div>
            <div className="usage-card-value">{fmtNum(view.outTok)}</div>
            <div className="usage-card-label">Output tokens</div>
          </div>
          <div className="usage-card usage-card--cache">
            <div className="usage-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
            </div>
            <div className="usage-card-value">{fmtNum(view.cacheTok)}</div>
            <div className="usage-card-label">Cache tokens</div>
          </div>
        </div>

        {/* By account */}
        {view.byAccount.length > 1 && (
          <div className="usage-section">
            <h2>By account</h2>
            <div className="account-cards">
              {view.byAccount.map((a) => (
                <div className="account-card" key={a.email}>
                  <div className="account-card-top">
                    <span className="account-email">{a.email}</span>
                    {a.plan && <span className="account-plan">{a.plan}</span>}
                  </div>
                  <div className="account-figs">
                    <span className="account-cost">${a.costUsd.toFixed(2)}</span>
                    <span className="account-tok">{fmtNum(a.tokens)} tok</span>
                  </div>
                  <div className="account-sources">{a.sources.join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="usage-section">
          <h2>
            Cost by {chart?.weekly ? 'week' : 'day'}{' '}
            {chart && chart.buckets.length > 0 && (
              <span className="usage-section-sub">
                ({chart.buckets.length} {chart.weekly ? 'weeks' : 'days'})
              </span>
            )}
          </h2>
          {!chart || chart.buckets.length === 0 ? (
            <div className="view-empty small">No activity in this range.</div>
          ) : (
            <div className="usage-chart">
              <div className="usage-chart-yaxis">
                <span>${chart.max >= 100 ? Math.round(chart.max) : chart.max.toFixed(2)}</span>
                <span>$0</span>
              </div>
              <div className="usage-chart-main">
                <div className="usage-chart-plot">
                  {chart.buckets.map((b) => (
                    <div
                      className={`usage-bar-col ${b.cost > 0 ? 'clickable' : 'empty'}`}
                      key={b.key}
                      title={`${b.key}${chart.weekly ? ' · week' : ''} · $${b.cost.toFixed(2)}${b.cost > 0 ? ' · click for details' : ''}`}
                      onClick={b.cost > 0 ? () => setDetailKey(b.key) : undefined}
                      role={b.cost > 0 ? 'button' : undefined}
                      tabIndex={b.cost > 0 ? 0 : undefined}
                      onKeyDown={b.cost > 0 ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setDetailKey(b.key)) : undefined}
                    >
                      <div className="usage-bar" style={{ height: `${(b.cost / chart.max) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="usage-chart-labels">
                  {chart.buckets.map((b, i) => (
                    <div className="usage-bar-label" key={b.key}>
                      {i % chart.tickEvery === 0 ? b.label : ''}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tables */}
        <div className="usage-tables">
          <div className="usage-section">
            <h2>By model</h2>
            <table className="usage-table">
              <thead><tr><th>Model</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
              <tbody>
                {view.byModel.map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model}</td>
                    <td>{fmtNum(m.inputTokens)}</td>
                    <td>{fmtNum(m.outputTokens)}</td>
                    <td>${m.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="usage-section">
            <h2>By project</h2>
            <table className="usage-table">
              <thead><tr><th>Project</th><th>Tokens</th><th>Cost</th></tr></thead>
              <tbody>
                {view.byProject.map((p) => (
                  <tr key={p.project}>
                    <td>{p.project}</td>
                    <td>{fmtNum(p.tokens)}</td>
                    <td>${p.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detail && createPortal(
        <div className="usage-modal-overlay" onClick={() => setDetailKey(null)}>
          <div className="usage-modal" onClick={(e) => e.stopPropagation()}>
            <div className="usage-modal-head">
              <div>
                <div className="usage-modal-title">{detail.title}</div>
                <div className="usage-modal-sub">{detail.weekly ? 'Week total' : 'Day total'} · local estimate at public API rates</div>
              </div>
              <button className="usage-modal-close" onClick={() => setDetailKey(null)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="usage-modal-body">
              <div className="usage-cards">
                <div className="usage-card usage-card--cost">
                  <div className="usage-card-value">${detail.cost.toFixed(2)}</div>
                  <div className="usage-card-label">Est. cost</div>
                </div>
                <div className="usage-card usage-card--in">
                  <div className="usage-card-value">{fmtNum(detail.inTok)}</div>
                  <div className="usage-card-label">Input</div>
                </div>
                <div className="usage-card usage-card--out">
                  <div className="usage-card-value">{fmtNum(detail.outTok)}</div>
                  <div className="usage-card-label">Output</div>
                </div>
                <div className="usage-card usage-card--cache">
                  <div className="usage-card-value">{fmtNum(detail.cacheTok)}</div>
                  <div className="usage-card-label">Cache</div>
                </div>
              </div>

              {detail.byModel.length === 0 ? (
                <div className="view-empty small">No activity recorded for this {detail.weekly ? 'week' : 'day'}.</div>
              ) : (
                <>
                  <div className="usage-section">
                    <h2>By model</h2>
                    <table className="usage-table">
                      <thead><tr><th>Model</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
                      <tbody>
                        {detail.byModel.map((m) => (
                          <tr key={m.model}>
                            <td className="mono">{m.model}</td>
                            <td>{fmtNum(m.inputTokens)}</td>
                            <td>{fmtNum(m.outputTokens)}</td>
                            <td>${m.costUsd.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="usage-section">
                    <h2>By project</h2>
                    <table className="usage-table">
                      <thead><tr><th>Project</th><th>Tokens</th><th>Cost</th></tr></thead>
                      <tbody>
                        {detail.byProject.map((p) => (
                          <tr key={p.project}>
                            <td>{p.project}</td>
                            <td>{fmtNum(p.tokens)}</td>
                            <td>${p.costUsd.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
