import { useEffect, useMemo, useState } from 'react'
import { UsageReport, UsageEntry, SourceInfo, UsageLimits } from '../types'
import './views.css'

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

  const apply = (rep: UsageReport, srcs: SourceInfo[], lim: UsageLimits) => {
    setReport(rep)
    setSources(srcs)
    setLimits(lim)
    setActiveSources((prev) => (prev.size ? prev : new Set(srcs.map((s) => s.id))))
  }

  // Recompute in the background (no full-screen spinner) and update in place.
  const refresh = async () => {
    setRefreshing(true)
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
      byDay: [...byDay.entries()].map(([day, c]) => ({ day, costUsd: c })).sort((a, b) => a.day.localeCompare(b.day)),
      byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
      byProject: [...byProject.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.costUsd - a.costUsd),
      byAccount: [...byAccount.values()]
        .map((a) => ({ ...a, sources: [...a.sources] }))
        .sort((a, b) => b.costUsd - a.costUsd)
    }
  }, [report, range, activeSources, sources])

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

  const maxDay = Math.max(...view.byDay.map((d) => d.costUsd), 0.0001)
  const recentDays = view.byDay.slice(-60)
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
          <div className="usage-card">
            <div className="usage-card-value">${view.cost.toFixed(2)}</div>
            <div className="usage-card-label">Est. cost</div>
          </div>
          <div className="usage-card">
            <div className="usage-card-value">{fmtNum(view.inTok)}</div>
            <div className="usage-card-label">Input tokens</div>
          </div>
          <div className="usage-card">
            <div className="usage-card-value">{fmtNum(view.outTok)}</div>
            <div className="usage-card-label">Output tokens</div>
          </div>
          <div className="usage-card">
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
          <h2>Cost by day {recentDays.length > 0 && <span className="usage-section-sub">({recentDays.length} days)</span>}</h2>
          {recentDays.length === 0 ? (
            <div className="view-empty small">No activity in this range.</div>
          ) : (
            <div className="usage-chart">
              {recentDays.map((d) => (
                <div className="usage-bar-col" key={d.day} title={`${d.day}: $${d.costUsd.toFixed(4)}`}>
                  <div className="usage-bar" style={{ height: `${Math.max(2, (d.costUsd / maxDay) * 100)}%` }} />
                  <div className="usage-bar-label">{d.day.slice(5)}</div>
                </div>
              ))}
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
    </div>
  )
}
