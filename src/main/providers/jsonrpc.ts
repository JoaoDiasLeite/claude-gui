import type { ChildProcessWithoutNullStreams } from 'child_process'

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

type PendingEntry = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * Minimal bidirectional JSON-RPC 2.0 client over a child process's stdio,
 * newline-delimited — confirmed empirically for both `codex app-server` and
 * `gemini --acp` (same framing as their simple `exec --json`/`stream-json`
 * modes; no LSP-style Content-Length headers).
 *
 * Handles three message shapes: responses to our own requests (id + result/
 * error), server-initiated requests that need a reply (id + method — e.g. a
 * tool-approval prompt), and one-way notifications (method only, no id).
 */
export class JsonRpcConnection {
  private nextId = 1
  private pending = new Map<number, PendingEntry>()
  private buffer = ''
  private notificationHandlers = new Map<string, (params: unknown) => void>()
  private requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>()
  private disposed = false

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString()
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      this.handleMessage(msg)
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const id = msg.id
    if (id !== undefined && ('result' in msg || 'error' in msg)) {
      const entry = typeof id === 'number' ? this.pending.get(id) : undefined
      if (!entry) return
      this.pending.delete(id as number)
      if (msg.error) {
        const err = msg.error as JsonRpcError
        entry.reject(new Error(err.message || 'RPC error'))
      } else {
        entry.resolve(msg.result)
      }
      return
    }
    if (typeof msg.method === 'string' && id !== undefined) {
      const handler = this.requestHandlers.get(msg.method)
      if (!handler) {
        this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `No handler for ${msg.method}` } })
        return
      }
      handler(msg.params).then(
        (result) => this.write({ jsonrpc: '2.0', id, result }),
        (err: unknown) =>
          this.write({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: err instanceof Error ? err.message : String(err) }
          })
      )
      return
    }
    if (typeof msg.method === 'string') {
      this.notificationHandlers.get(msg.method)?.(msg.params)
    }
  }

  private write(msg: unknown): void {
    if (this.disposed) return
    try {
      this.child.stdin.write(JSON.stringify(msg) + '\n')
    } catch {
      // stdin closed (process exiting) — the caller's pending promises reject via dispose().
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler)
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.requestHandlers.set(method, handler)
  }

  /** Rejects any still-outstanding requests — call when the child process exits. */
  dispose(reason: string): void {
    this.disposed = true
    for (const entry of this.pending.values()) entry.reject(new Error(reason))
    this.pending.clear()
  }
}
