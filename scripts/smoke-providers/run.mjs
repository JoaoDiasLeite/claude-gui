#!/usr/bin/env node
// @ts-check
/*
 * Smoke-test harness for the Codex and Gemini engine adapters.
 *
 * WHY THIS EXISTS
 * The adapters in src/main/providers/{codex,gemini}.ts parse each CLI's JSONL
 * event stream, but their SUCCESS-path field names were written from docs, not
 * captured live (neither CLI was logged in when they were built). This harness
 * runs the real CLI exactly as the adapter does — same args, prompt on stdin —
 * dumps every raw event, then checks each assumption the adapter's parser makes
 * and prints the actual value it found (or ✗ + the event types that DID appear).
 *
 * It deliberately does NOT import the adapters: those pull in electron (via
 * config.ts), which can't load outside an Electron process. Reproducing the
 * spawn independently is also a feature — it validates the adapter's assumptions
 * against ground truth rather than trusting the code under test. The spawn/args
 * logic below MUST stay in sync with cli-resolve.ts / codex.ts / gemini.ts; each
 * block cites the source it mirrors.
 *
 * USAGE
 *   node scripts/smoke-providers/run.mjs codex   ["prompt"]
 *   node scripts/smoke-providers/run.mjs gemini  ["prompt"]
 *   node scripts/smoke-providers/run.mjs both
 *   SMOKE_MODEL=gpt-5.6-luna node scripts/smoke-providers/run.mjs codex
 *
 * Requires the CLI installed (npm i -g @openai/codex / @google/gemini-cli) and
 * logged in (codex login / run `gemini` once and pick "Login with Google").
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RESET = '\x1b[0m'
const c = (code, s) => `\x1b[${code}m${s}${RESET}`
const bold = (s) => c('1', s)
const dim = (s) => c('2', s)
const green = (s) => c('32', s)
const red = (s) => c('31', s)
const yellow = (s) => c('33', s)
const cyan = (s) => c('36', s)

const DEFAULT_PROMPT = 'Reply with exactly the single word PONG and nothing else. Do not use any tools.'

// ── CLI resolution — mirrors src/main/providers/cli-resolve.ts ──────────────
// On Windows, npm installs a .cmd shim that CreateProcess can't spawn directly;
// invoke the package's node entry point instead (no shell → no injection).
function resolveWindowsEntry(pkgRelativeJs) {
  const roots = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'npm'))
  if (process.env.ProgramFiles) roots.push(join(process.env.ProgramFiles, 'nodejs'))
  for (const root of roots) {
    const candidate = join(root, 'node_modules', ...pkgRelativeJs)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveCli(id) {
  if (process.platform === 'win32') {
    const parts =
      id === 'codex'
        ? ['@openai', 'codex', 'bin', 'codex.js']
        : ['@google', 'gemini-cli', 'bundle', 'gemini.js']
    const entry = resolveWindowsEntry(parts)
    if (entry) return { command: 'node', prefixArgs: [entry] }
  }
  return { command: id, prefixArgs: [] }
}

// ── Arg building — mirrors buildArgs() in codex.ts / gemini.ts ──────────────
// Uses the safe, read-only sandbox/approval levels: the smoke test only needs a
// text reply, never tool execution.
function buildArgs(id, model) {
  if (id === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', process.cwd(), '-s', 'read-only']
    if (model) args.push('-m', model)
    args.push('-') // prompt via stdin
    return args
  }
  const args = ['--output-format', 'stream-json', '--approval-mode', 'plan', '--skip-trust']
  if (model) args.push('-m', model)
  return args // prompt via stdin
}

// ── Adapter assumptions to validate (the whole point of the harness) ────────
// Each check gets the array of raw events and returns { ok, detail }.
const CHECKS = {
  codex: [
    {
      what: "thread.started carries thread_id  → EngineMessage 'init'.sessionId",
      run: (evs) => {
        const e = evs.find((x) => x.type === 'thread.started')
        if (!e) return { ok: false, detail: 'no thread.started event seen' }
        return { ok: typeof e.thread_id === 'string', detail: `thread_id=${e.thread_id}` }
      }
    },
    {
      what: "item.completed{item.type:'agent_message'}.item.text  → 'text-delta'.text",
      run: (evs) => {
        const items = evs.filter((x) => x.type === 'item.completed' && x.item?.type === 'agent_message')
        if (!items.length) return { ok: false, detail: 'no agent_message item.completed seen' }
        const text = items.map((i) => i.item?.text).filter((t) => typeof t === 'string').join('')
        return { ok: !!text, detail: text ? `text=${JSON.stringify(text.slice(0, 80))}` : 'item.text missing/non-string' }
      }
    },
    {
      what: 'turn.completed.usage.{input_tokens,output_tokens,cached_input_tokens}  → result.usage',
      run: (evs) => {
        const e = evs.find((x) => x.type === 'turn.completed')
        if (!e) return { ok: false, detail: 'no turn.completed event seen' }
        const u = e.usage || {}
        const ok = typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number'
        return { ok, detail: `usage=${JSON.stringify(u)}` }
      }
    }
  ],
  gemini: [
    {
      what: "init.session_id  → EngineMessage 'init'.sessionId",
      run: (evs) => {
        const e = evs.find((x) => x.type === 'init')
        if (!e) return { ok: false, detail: 'no init event seen' }
        return { ok: typeof e.session_id === 'string', detail: `session_id=${e.session_id}` }
      }
    },
    {
      what: "message{role:'assistant'}.content  → 'text-delta'.text",
      run: (evs) => {
        const msgs = evs.filter((x) => x.type === 'message' && x.role === 'assistant')
        if (!msgs.length) return { ok: false, detail: 'no assistant message event seen' }
        const text = msgs.map((m) => m.content).filter((t) => typeof t === 'string').join('')
        return { ok: !!text, detail: text ? `content=${JSON.stringify(text.slice(0, 80))}` : 'content missing/non-string' }
      }
    },
    {
      what: 'result.status + result.stats.{input_tokens,output_tokens}  → result.{isError,usage}',
      run: (evs) => {
        const e = evs.find((x) => x.type === 'result')
        if (!e) return { ok: false, detail: 'no result event seen' }
        const s = e.stats || {}
        const ok = 'status' in e && typeof s.input_tokens === 'number'
        return { ok, detail: `status=${e.status} stats=${JSON.stringify(s)}` }
      }
    }
  ]
}

// ── Login preflight — mirrors agent-clis.ts ─────────────────────────────────
function preflight(id) {
  const { command, prefixArgs } = resolveCli(id)
  // Detect install: on win32 the node-entry must exist; otherwise assume PATH.
  if (process.platform === 'win32' && command !== 'node') {
    return { installed: false, loggedIn: false, note: 'CLI node entry not found under %APPDATA%\\npm' }
  }
  if (id === 'gemini') {
    const settings = join(homedir(), '.gemini', 'settings.json')
    let loggedIn = false
    try {
      loggedIn = !!JSON.parse(readFileSync(settings, 'utf-8'))?.security?.auth?.selectedAuthType
    } catch {
      loggedIn = false
    }
    return { installed: true, loggedIn, note: loggedIn ? '' : 'no selectedAuthType in ~/.gemini/settings.json' }
  }
  return { installed: true, loggedIn: existsSync(join(homedir(), '.codex', 'auth.json')), prefixArgs, note: '' }
}

// ── Run one provider ────────────────────────────────────────────────────────
async function runProvider(id, prompt, model) {
  console.log('\n' + bold(cyan(`━━━ ${id.toUpperCase()} ━━━`)))
  const pf = preflight(id)
  console.log(dim(`install=${pf.installed} loggedIn=${pf.loggedIn}${pf.note ? ` (${pf.note})` : ''}`))
  if (!pf.installed) {
    console.log(red(`✗ ${id} CLI not found. Install: npm i -g ${id === 'codex' ? '@openai/codex' : '@google/gemini-cli'}`))
    return false
  }
  if (!pf.loggedIn) {
    console.log(yellow(`⚠ ${id} not logged in. Run ${id === 'codex' ? '`codex login`' : '`gemini` and pick Login with Google'} first, then re-run.`))
    return false
  }

  const { command, prefixArgs } = resolveCli(id)
  const args = [...prefixArgs, ...buildArgs(id, model)]
  console.log(dim(`$ ${command} ${args.join(' ')}`))
  console.log(dim(`(prompt on stdin: ${JSON.stringify(prompt)})\n`))

  const events = []
  let stderr = ''
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdin.on('error', () => {})
  child.stdin.write(prompt)
  child.stdin.end()
  child.stderr.on('data', (d) => (stderr += d.toString()))

  let buffer = ''
  const onLine = (line) => {
    if (!line.trim()) return
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      console.log(dim(`[non-JSON] ${line}`))
      return
    }
    events.push(obj)
    console.log(`${dim('event')} ${bold(obj.type ?? '(no type)')} ${dim(JSON.stringify(obj).slice(0, 300))}`)
  }
  await new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      buffer += d.toString()
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        onLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    })
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer)
      console.log(dim(`\n(exit code ${code})`))
      if (stderr.trim()) console.log(dim(`stderr:\n${stderr.trim().slice(0, 1000)}`))
      resolve(undefined)
    })
    child.on('error', (err) => {
      console.log(red(`spawn error: ${err.message}`))
      resolve(undefined)
    })
  })

  // Validate the adapter's parser assumptions against what actually arrived.
  console.log('\n' + bold('Adapter assumption check:'))
  const seen = [...new Set(events.map((e) => e.type))].join(', ') || '(none)'
  console.log(dim(`event types seen: ${seen}`))
  let allOk = events.length > 0
  for (const check of CHECKS[id]) {
    const { ok, detail } = check.run(events)
    if (!ok) allOk = false
    console.log(`  ${ok ? green('✓') : red('✗')} ${check.what}\n      ${dim(detail)}`)
  }
  console.log(
    allOk
      ? green(`\n✓ ${id}: all assumptions matched — the ${id}.ts parser should work as written.`)
      : red(`\n✗ ${id}: MISMATCH — update src/main/providers/${id}.ts parser to the field names shown above.`)
  )
  return allOk
}

// ── Entry ────────────────────────────────────────────────────────────────────
const which = (process.argv[2] || '').toLowerCase()
const prompt = process.argv[3] || DEFAULT_PROMPT
const model = process.env.SMOKE_MODEL || ''

if (!['codex', 'gemini', 'both'].includes(which)) {
  console.log('Usage: node scripts/smoke-providers/run.mjs <codex|gemini|both> ["prompt"]')
  process.exit(2)
}

const targets = which === 'both' ? ['codex', 'gemini'] : [which]
let ok = true
for (const t of targets) {
  ok = (await runProvider(t, prompt, model)) && ok
}
process.exit(ok ? 0 : 1)
