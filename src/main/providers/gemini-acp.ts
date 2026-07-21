import { spawn } from 'child_process'
import { JsonRpcConnection } from './jsonrpc'
import { resolveGemini } from './cli-resolve'
import { costFromTokens } from './cost'
import { ZERO_USAGE } from './types'
import type { EngineMessage, EngineRequest } from './types'

const NOT_FOUND_MESSAGE = 'Gemini CLI not found. Install with: npm install -g @google/gemini-cli'

/**
 * Gemini's real per-tool-approval hook — used only when `req.canUseTool` is set
 * (interactive chat in 'ask' mode), via the Agent Client Protocol (`gemini
 * --acp`, the same protocol editors like Zed use). Everything else uses the
 * simpler `gemini --output-format stream-json` path in `gemini.ts`, which has
 * no approval callback at all.
 *
 * Ground-truthed against the official `@agentclientprotocol/sdk` npm package's
 * own generated TypeScript types (first-party — not community docs) for
 * method names and payload shapes, plus a live-traced `initialize` handshake
 * against the installed CLI (0.51.0) confirming newline-delimited JSON-RPC
 * framing, matching `codex app-server`. `session/new`/`session/prompt` and the
 * `session/request_permission` approval flow itself could not be traced live —
 * this machine has no Gemini login yet — so beyond `initialize` this is
 * spec-derived, not captured; needs a real smoke test once login is set up.
 *
 * Like the Codex app-server path, this reconnects per turn (`session/load` on
 * resume) rather than holding one process open for the whole chat — `AiEngine.
 * run(req)` has no session-lifecycle hook to know when to tear down a
 * long-lived process, so per-turn reconnect is the simpler fit for today's
 * interface.
 */

interface AcpMcpServerStdio {
  name: string
  command: string
  args: string[]
  env: { name: string; value: string }[]
}

/** ACP's session/new|load `mcpServers` param is an array of stdio-server
 * objects with an ARRAY-of-pairs `env` (not the object-keyed shape Claude/
 * gemini's own settings.json use) — confirmed via the SDK's `McpServerStdio`
 * type. Remote (sse/http) servers are skipped, matching the simple engine's
 * same stdio-only limitation. */
function toAcpMcpServers(servers: Record<string, unknown> | undefined): AcpMcpServerStdio[] {
  if (!servers) return []
  const out: AcpMcpServerStdio[] = []
  for (const [name, raw] of Object.entries(servers)) {
    const cfg = raw as { command?: string; args?: string[]; env?: Record<string, unknown> }
    if (!cfg?.command) continue
    out.push({
      name,
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env ? Object.entries(cfg.env).map(([k, v]) => ({ name: k, value: String(v) })) : []
    })
  }
  return out
}

export async function* runGeminiAcp(req: EngineRequest, prompt: string): AsyncGenerator<EngineMessage> {
  if (!req.canUseTool) {
    yield { type: 'error', message: 'runGeminiAcp requires canUseTool.' }
    return
  }
  const canUseTool = req.canUseTool

  const { command, prefixArgs } = resolveGemini()
  const child = spawn(command, [...prefixArgs, '--acp'], {
    cwd: req.cwd,
    env: { ...process.env, ...req.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    signal: req.abortController.signal
  })

  let spawnErr: NodeJS.ErrnoException | undefined
  let stderrBuf = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString()
  })
  child.on('error', (err) => {
    spawnErr = err as NodeJS.ErrnoException
  })

  const rpc = new JsonRpcConnection(child)

  const queue: EngineMessage[] = []
  let queueWake: (() => void) | null = null
  let done = false
  const push = (m: EngineMessage) => {
    queue.push(m)
    if (queueWake) {
      const wake = queueWake
      queueWake = null
      wake()
    }
  }
  const finish = () => {
    done = true
    if (queueWake) {
      const wake = queueWake
      queueWake = null
      wake()
    }
  }

  let sessionId: string | undefined = req.resume

  rpc.onNotification('session/update', (params) => {
    const p = params as {
      update?: { sessionUpdate?: string; content?: { type?: string; text?: string } }
    }
    const u = p.update
    if (!u?.content || u.content.type !== 'text' || !u.content.text) return
    if (u.sessionUpdate === 'agent_message_chunk') {
      push({ type: 'text-delta', text: u.content.text })
    } else if (u.sessionUpdate === 'agent_thought_chunk') {
      push({ type: 'thinking-delta', text: u.content.text })
    }
    // tool_call/tool_call_update updates exist in the protocol but aren't
    // mapped to tool-use/tool-result EngineMessages here — this phase's scope
    // is the approval round trip; rendering gemini's tool activity in the
    // transcript is a reasonable follow-up, not required for approvals to work.
  })

  // The actual point of this module: respond to the agent's permission
  // request by running it through the same canUseTool callback the renderer's
  // approval modal already drives for Claude. No tool-name allowlist gate on
  // this side — trust that ACP only raises this for genuinely risky calls.
  rpc.onRequest('session/request_permission', async (params) => {
    const p = params as {
      toolCall?: { title?: string; kind?: string }
      options?: { optionId: string; kind: string }[]
    }
    const toolName = p.toolCall?.kind === 'edit' ? 'Edit' : 'Bash'
    const decision = await canUseTool(toolName, { description: p.toolCall?.title ?? '' })
    const options = p.options ?? []
    const wantPrefix = decision.behavior === 'allow' ? 'allow' : 'reject'
    const picked = options.find((o) => o.kind.startsWith(wantPrefix))
    if (!picked) return { outcome: { outcome: 'cancelled' } }
    return { outcome: { outcome: 'selected', optionId: picked.optionId } }
  })

  const closed = new Promise<number | null>((resolve) => child.on('close', resolve))

  ;(async () => {
    try {
      await rpc.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
      })

      const mcpServers = toAcpMcpServers(req.mcpServers)
      let sid: string
      if (req.resume) {
        await rpc.request('session/load', { sessionId: req.resume, cwd: req.cwd, mcpServers })
        sid = req.resume
      } else {
        const res = (await rpc.request('session/new', { cwd: req.cwd, mcpServers })) as { sessionId: string }
        sid = res.sessionId
      }
      sessionId = sid
      push({ type: 'init', sessionId: sid, tools: [] })

      const result = (await rpc.request('session/prompt', {
        sessionId: sid,
        prompt: [{ type: 'text', text: prompt }]
      })) as { usage?: { inputTokens?: number; outputTokens?: number } }

      const usage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      }
      push({
        type: 'result',
        sessionId: sid,
        isError: false,
        costUsd: costFromTokens(req.model, usage),
        usage
      })
      finish()
    } catch (err) {
      push({
        type: 'result',
        sessionId,
        isError: true,
        errorText: err instanceof Error ? err.message : String(err),
        costUsd: 0,
        usage: ZERO_USAGE
      })
      finish()
    }
  })()

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as EngineMessage
        continue
      }
      if (done) break
      if (spawnErr) {
        const isNotFound = spawnErr.code === 'ENOENT'
        yield { type: 'error', message: isNotFound ? NOT_FOUND_MESSAGE : spawnErr.message }
        break
      }
      await new Promise<void>((resolve) => {
        queueWake = resolve
      })
    }
  } finally {
    rpc.dispose('Gemini ACP process ending.')
    try {
      child.kill()
    } catch {
      // best-effort
    }
    await closed
    if (!done && stderrBuf.trim()) {
      yield {
        type: 'result',
        sessionId,
        isError: true,
        errorText: stderrBuf.trim(),
        costUsd: 0,
        usage: ZERO_USAGE
      }
    }
  }
}
