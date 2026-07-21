# Provider smoke test

Verifies the **Codex** and **Gemini** engine adapters
(`src/main/providers/{codex,gemini}.ts`) against the real CLIs — specifically the
success-path event shapes, which were originally written from docs rather than
captured live.

## What it does

Runs each CLI exactly as its adapter does (same args, prompt on stdin, read-only
sandbox), prints every raw JSONL event, then checks each field the adapter's
parser reads and shows the **actual** value found — or ✗ plus the event types
that really appeared. It does *not* import the adapters (they pull in `electron`
via `config.ts` and can't load in a plain Node process); it reproduces the spawn
independently, which also makes it an honest check rather than trusting the code
under test.

> The spawn/args logic in `run.mjs` mirrors `cli-resolve.ts` and each adapter's
> `buildArgs()`. If you change those, update `run.mjs` to match.

## Prerequisites

```
npm i -g @openai/codex @google/gemini-cli
codex login          # ChatGPT OAuth
gemini               # run once, choose "Login with Google"
```

## Usage

```
node scripts/smoke-providers/run.mjs codex
node scripts/smoke-providers/run.mjs gemini
node scripts/smoke-providers/run.mjs both
node scripts/smoke-providers/run.mjs codex "your own prompt"
SMOKE_MODEL=gpt-5.6-luna node scripts/smoke-providers/run.mjs codex   # pin a model
```

Exit code is `0` only if every assumption for every target matched.

## Reading the result

- **All ✓** → that adapter's parser matches the live CLI; nothing to do.
- **Any ✗** → the printed `event types seen` and per-check detail tell you the
  real field names. Update the corresponding `switch (obj.type)` case in
  `src/main/providers/<provider>.ts` to match, then re-run until green.

## Status (last run)

- **Codex** (`@openai/codex`, logged in): ✓ all assumptions matched live —
  `thread.started` / `item.completed{agent_message}` / `turn.completed.usage`
  confirmed.
- **Gemini** (`@google/gemini-cli`, installed): not yet logged in — run the
  `gemini` login above, then `node scripts/smoke-providers/run.mjs gemini`.
