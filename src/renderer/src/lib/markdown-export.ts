import { Session, ToolCall } from '../types'

/** Short "HH:MM" for a message heading. */
function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Short date range across all messages, e.g. "Jun 3, 2026" or "Jun 3 – Jun 5, 2026". */
function dateRange(messages: Session['messages']): string {
  if (messages.length === 0) return ''
  const first = new Date(messages[0].timestamp)
  const last = new Date(messages[messages.length - 1].timestamp)
  const fmt = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return first.toDateString() === last.toDateString() ? fmt(first) : `${fmt(first)} – ${fmt(last)}`
}

/** The one input field worth showing inline for a tool call, without dumping the full input. */
function primaryToolArg(tool: ToolCall): string | undefined {
  const input = tool.input as Record<string, unknown> | undefined
  if (!input || typeof input !== 'object') return undefined
  const candidate = input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.path
  return typeof candidate === 'string' ? candidate : undefined
}

function toolCallLine(tool: ToolCall): string {
  const arg = primaryToolArg(tool)
  return arg ? `- \u{1F527} ${tool.tool} ${arg}` : `- \u{1F527} ${tool.tool}`
}

/** Renders a chat session as a standalone Markdown document (skips thinking blocks). */
export function sessionToMarkdown(session: Session): string {
  const lines: string[] = []
  lines.push(`# ${session.name || 'Chat'}`)

  const meta: string[] = []
  if (session.projectPath) meta.push(session.projectPath)
  const range = dateRange(session.messages)
  if (range) meta.push(range)
  if (meta.length > 0) lines.push(`_${meta.join(' · ')}_`)
  lines.push('')

  for (const msg of session.messages) {
    const who = msg.role === 'user' ? 'You' : 'Claude'
    lines.push(`## ${who} — ${shortTime(msg.timestamp)}`)
    lines.push('')
    if (msg.content) {
      lines.push(msg.content)
      lines.push('')
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) lines.push(toolCallLine(tc))
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}
