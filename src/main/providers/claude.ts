import type { query as QueryFn } from '@anthropic-ai/claude-agent-sdk'
import { sdkExecutable } from '../sdk-exe'
import type { AiEngine, EngineRequest } from './types'

/**
 * Claude engine — wraps the Agent SDK `query()`.
 *
 * The SDK ships as ESM, so it must be reached via a runtime dynamic import that
 * survives CommonJS transpilation (a bare `import()` would be rewritten to
 * `require()` and throw). This mirrors the loader that previously lived inline in
 * index.ts / scheduler.ts — now centralized here as the single SDK entry point.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  s: string
) => Promise<unknown>

let queryFn: typeof QueryFn | null = null

async function getQuery(): Promise<typeof QueryFn> {
  if (!queryFn) {
    const mod = (await dynamicImport('@anthropic-ai/claude-agent-sdk')) as {
      query: typeof QueryFn
    }
    queryFn = mod.query
  }
  return queryFn
}

export const claudeEngine: AiEngine = {
  id: 'claude',
  async *run(req: EngineRequest) {
    const query = await getQuery()

    // Map the provider-neutral request onto SDK options. Optional fields are only
    // set when present so the SDK's own defaults apply otherwise (e.g. an omitted
    // maxTurns stays uncapped, an omitted includePartialMessages stays false).
    const options: NonNullable<Parameters<typeof query>[0]['options']> = {
      ...sdkExecutable(),
      model: req.model,
      cwd: req.cwd,
      env: req.env,
      abortController: req.abortController,
      settingSources: req.settingSources,
      permissionMode: req.permissionMode,
      ...(req.allowedTools ? { allowedTools: req.allowedTools } : {}),
      ...(req.disallowedTools ? { disallowedTools: req.disallowedTools } : {}),
      ...(req.maxTurns !== undefined ? { maxTurns: req.maxTurns } : {}),
      ...(req.mcpServers ? { mcpServers: req.mcpServers } : {}),
      ...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
      ...(req.resume ? { resume: req.resume } : {}),
      ...(req.includePartialMessages !== undefined
        ? { includePartialMessages: req.includePartialMessages }
        : {}),
      ...(req.canUseTool ? { canUseTool: req.canUseTool } : {})
    }

    const stream = query({ prompt: req.prompt, options })
    for await (const message of stream) {
      yield message
    }
  }
}
