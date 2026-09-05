# AI Usage Dashboard — agent instructions

Local-first Electron app tracking coding-agent usage and quota across Grok
Build, Claude Code, Codex CLI and OpenCode. All code lives in `app/`.

**Read [`HANDOVER.md`](./HANDOVER.md) before starting work.** It holds the
current triage, the backlog, and the protocol for working in parallel with
another agent. This file is only the rules that must never be violated.

## Verify before every commit

```bash
cd app && npm test && npm run typecheck && npm run build
```

`npm run verify:real` additionally runs the collectors against the machine's
real CLI data. Run it for any collector or pricing change — it has caught bugs
no fixture contained.

## Non-negotiable rules

1. **Never store prompts or responses.** Token counts and metadata only. Project
   names are basenames, never full paths.
2. **Never invent a number.** A model with no known rate is `unpriced`
   (`cost_usd IS NULL`), never priced at a default. Quota is `live` only when a
   connected source returned a real figure.
3. **`reasoning` is a subset of `output`**, never added into a total. Providers
   disagree about this; the parsers normalize into `src/shared/tokens.ts`.
4. **Migrations are append-only and numbered.** Highest is currently **7**.
   Before writing one, check `git log -1 -- app/src/main/db/schema.ts` and
   announce the number you are claiming — two agents writing migration 8
   corrupts user databases unrecoverably.
5. **Never `catch {}` into an empty result.** An empty collector result is
   indistinguishable from "no usage", which is how a native-module failure hid
   for weeks. Throw; `collectors/service.ts` records it on the health row.
6. **`npm test` stays hermetic.** Anything needing real credentials,
   transcripts, or the network belongs in `app/scripts/` under
   `vitest.verify.config.ts`.
7. **Plans are per user** — resolved API → user override → `Unknown`. Never
   hard-code a plan.

## Known environment quirks

- **`better-sqlite3` throws `NODE_MODULE_VERSION` under plain Node.** It is
  built for Electron's ABI; this is correct. Tests needing real SQLite use
  `node:sqlite` with a `.transaction()` shim — see `src/main/db/events.test.ts`.
  Do not rebuild it for Node.
- **Prefer the Write/Edit tools for source changes.** Scripted edits via shell
  heredocs have twice injected escape bugs here, including raw NUL bytes that
  made files read as binary to git and grep.
- **`npm run dev` hot-reloads the main process**, re-running collectors and
  migrations against the real database while you edit.

## Conventions

- Comments explain *why*, not what. Match the density of surrounding code.
- Parsers are pure and separately tested; filesystem walking lives in
  `sessions.ts`, mapping in `parse.ts`.
- Commit messages: imperative subject, body explains the reasoning and states
  what was verified.
