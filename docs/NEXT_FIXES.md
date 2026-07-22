# Next fixes

Follow-ups left open after the 0.6.0 multi-provider work (commits `56364c5`..`34b0c5c`).
Ordered roughly by value-for-effort. Each item states what's wrong, where, and how it was
found — nothing here is speculative unless marked **unverified**.

---

## 1. Unbound Codex chats run on the wrong account

**Severity:** medium — silently uses the wrong login.

Same class of mismatch as `34b0c5c`, which fixed it for Claude only.

`App.tsx:479-481` builds the run payload:

```ts
accountId: session.accountId ?? defaultAccountId,   // Claude: falls back
codexAccountId: session.codexAccountId,             // Codex: no fallback
geminiAccountId: session.geminiAccountId,           // Gemini: no fallback
```

A Codex chat created before per-provider accounts existed (or any chat whose
`codexAccountId` never got set) passes `undefined` to
`providerAccountEnv('codex', undefined)` in `index.ts:758`, which returns `{}` — the
machine-default `CODEX_HOME`. So the chat runs on the machine default even when the
picker clearly shows a different Codex account selected.

The sidebar is already consistent with this (`Sidebar.tsx`'s `acctOf` keeps `'default'`
for Codex precisely because it matches the run), so **fixing the run means updating both
together**, or the list/row will drift again.

**Fix:** pass `session.codexAccountId ?? codexDefaultAccountId` in the payload, add
`codexDefaultAccountId` to the `sessionPayload` `useMemo` deps (currently
`[defaultModel, defaultAccountId]`), and flip `acctOf`'s Codex branch to match.

Gemini needs no equivalent — it has exactly one account (see item 4).

---

## 2. The scoping logic has no test in the repo

**Severity:** medium — the bug in `34b0c5c` was only caught by a throwaway script.

There is no test runner at all: no `test` script in `package.json`, no vitest/jest, only
the `scripts/smoke-providers` and `scripts/visual-check` harnesses. `visual-check` renders
a single seeded account, so it cannot exercise account switching — the exact area where
the last two bugs lived.

The harness that caught the `acctOf` bug is a *copy* of the logic living in a scratchpad
dir, so it will silently rot the moment `Sidebar.tsx` changes.

**Fix:** extract the pure scoping helpers (`provOf`, `acctOf`, `idFor`, and the
`visibleSessions` predicate) out of the `Sidebar` component body into a
`src/renderer/src/lib/account-scope.ts`, then add vitest and port the four cases
(no active chat / active chat on a non-default account / active Codex chat / unbound
legacy chat). Extraction is the load-bearing half — it makes the logic testable *and*
stops `App.tsx` and `Sidebar.tsx` from each maintaining their own fallback rules, which
is what caused both bugs.

---

## 3. Provider account IPC accepts Gemini calls that do nothing

**Severity:** low — no user-facing path hits it today.

`provider-accounts:add|rename|remove|set-default` are provider-generic, but
`listProviderAccountStatus('gemini')` hard-returns a single fixed Antigravity account
(`provider-accounts.ts:283-292`). A Gemini account created over IPC gets a directory on
disk and a `provider-accounts.json` entry, and is then never surfaced or used.

`addProviderAccount` documents this, but documenting an inert code path is weaker than
refusing it.

**Fix:** have the mutating handlers reject `provider === 'gemini'` outright, and drop any
stored Gemini accounts on load in `loadGroup`.

---

## 4. Stale comment about Gemini env isolation

**Severity:** trivial.

`index.ts:756-757` still says the injected env is "CODEX_HOME / fake HOME". The fake-HOME
path was removed in `7021943` — `providerAccountEnv` now returns `{}` for Gemini
unconditionally. The comment describes behaviour that no longer exists.

**Fix:** reword to mention `CODEX_HOME` only, and note Gemini's login is machine-wide in
the OS keyring.

---

## 5. Model discovery only covers Codex

**Severity:** low — feature gap, not a defect.

`models-catalog.ts` has exactly one discovery source, `discoverCodexModelIds()` (line 34).
`IMPLEMENTATION_PLAN.md` §3 also called for "Claude/Gemini via CLI/API where available",
and for flagging entries where a newer same-family model exists but is missing. Neither
landed: `discovered` currently only means "the Codex CLI knows this id and we don't".

A Claude model shipping between releases therefore still requires either a code change or
a hand-written `models.json` override.

**Fix:** add a Claude discovery source. Check the `claude-api` skill for the canonical
model-id list rather than inventing ids or pricing — the plan explicitly warns about this,
and discovered entries deliberately render as "pricing not yet catalogued" instead of
guessing.

---

## 6. Renderer bundle is ~1.7 MB in one chunk

**Severity:** low.

`npm run build` warns on every run: `index-*.js` is 1,716 kB. It's a local Electron app so
there's no network cost, but it does slow cold start and buries real warnings in build
output.

**Fix:** `build.rollupOptions.output.manualChunks` to split the vendor half out, or lazy-load
the heavier views (`PlannerView`, `UsageView`) behind `React.lazy`. **Unverified** which of
the two dominates — measure before splitting.

---

## Not doing

- **Multi-account Gemini.** Not possible: Antigravity's login is machine-wide in the OS
  keyring, not under a config dir, so there is nothing to isolate per account. The
  contradictory fake-HOME scaffolding was removed in `7021943`. Revisit only if Antigravity
  gains a config-dir override.
