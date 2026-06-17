/**
 * Shared parser for the `claude -p --output-format stream-json` line protocol, used by
 * both the SSH and WSL backends. Translates each JSONL event into the same shapes the
 * local Agent SDK path emits so the chat UI is identical across backends.
 */

export interface StreamEmit {
  onEvent: (e: Record<string, unknown>) => void
  onDone: (d: {
    claudeSessionId?: string
    costUsd: number
    isError: boolean
    errorText?: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }) => void
}

export interface StreamState {
  sessionId?: string
  /** True once we've seen partial stream events — then full assistant text is a duplicate. */
  sawPartial?: boolean
}

export function handleStreamLine(
  line: string,
  appSessionId: string,
  state: StreamState,
  emit: StreamEmit
): void {
  if (!line.trim()) return
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return
  }
  if (obj.session_id) state.sessionId = obj.session_id

  if (obj.type === 'system' && obj.subtype === 'init') {
    emit.onEvent({
      appSessionId,
      kind: 'system',
      claudeSessionId: state.sessionId,
      tools: obj.tools ?? []
    })
  } else if (obj.type === 'stream_event' && obj.event) {
    // Partial messages (--include-partial-messages): stream text/thinking deltas live.
    state.sawPartial = true
    const ev = obj.event
    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        emit.onEvent({ appSessionId, kind: 'text', content: ev.delta.text })
      } else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
        emit.onEvent({ appSessionId, kind: 'thinking', content: ev.delta.thinking })
      }
    }
  } else if (obj.type === 'assistant' && obj.message?.content) {
    for (const b of obj.message.content) {
      if (b.type === 'tool_use') {
        emit.onEvent({ appSessionId, kind: 'tool-use', tool: b.name, input: b.input, toolId: b.id })
      } else if (!state.sawPartial && b.type === 'text' && b.text) {
        // No partials available — emit the full text once.
        emit.onEvent({ appSessionId, kind: 'text', content: b.text })
      } else if (!state.sawPartial && b.type === 'thinking' && b.thinking) {
        emit.onEvent({ appSessionId, kind: 'thinking', content: b.thinking })
      }
    }
  } else if (obj.type === 'user' && obj.message?.content) {
    for (const b of obj.message.content) {
      if (b.type === 'tool_result') {
        const text =
          typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? b.content.map((c: any) => c.text ?? '').join('')
              : ''
        emit.onEvent({
          appSessionId,
          kind: 'tool-result',
          toolId: b.tool_use_id,
          content: text.slice(0, 50000),
          isError: !!b.is_error
        })
      }
    }
  } else if (obj.type === 'result') {
    emit.onDone({
      claudeSessionId: state.sessionId,
      costUsd: obj.total_cost_usd ?? 0,
      isError: obj.subtype !== 'success',
      errorText: obj.subtype !== 'success' ? obj.result ?? obj.subtype : undefined,
      inputTokens: obj.usage?.input_tokens ?? 0,
      outputTokens: obj.usage?.output_tokens ?? 0,
      cacheReadTokens: obj.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: obj.usage?.cache_creation_input_tokens ?? 0
    })
  }
}

/** A reusable buffered line splitter for streamed stdout. */
export function makeLineBuffer(onLine: (line: string) => void): {
  push: (chunk: string) => void
  flush: () => void
} {
  let buffer = ''
  return {
    push(chunk: string) {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        onLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    },
    flush() {
      if (buffer.trim()) onLine(buffer)
      buffer = ''
    }
  }
}
