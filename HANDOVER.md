# AI Usage Dashboard — handover & triage

**Last updated:** 2026-09-05 · **Branch:** `anish` · **Baseline commit:** `4c294e4`
**State:** 181 tests passing, typecheck clean, build clean, app runs.

This document exists so a second agent can pick up work **in parallel** without
colliding with the first. If you read only one section, read
[Parallel work protocol](#parallel-work-protocol) and [Traps](#traps-that-will-waste-your-time).

---

## 1. Orientation in 60 seconds

| | |
|---|---|
| What it is | Local-first Electron desktop app that shows where your coding-agent allowance goes across **Grok Build, Claude Code, Codex CLI and OpenCode** |
| Where the code is | `app/` — everything. Repo root holds docs only |
| Language / stack | TypeScript, Electron 34, React 18, Vite, better-sqlite3, zod |
| Data source | The agent CLIs' own on-disk session transcripts + their quota APIs |
| Privacy rule | **Never store prompts or responses.** Metadata and token counts only |
| Honesty rule | Never invent a number. `live` / `estimate` / `unknown`, and unpriced means unpriced |

```bash
cd app
npm install          # if node_modules missing
npm test             # 181 tests, hermetic, ~3s
npm run typecheck
npm run build
npm run dev          # launches the Electron app with HMR
npm run verify:real  # opt-in: runs collectors against YOUR real CLI data
```

Read next, in order: [`PLAN.md`](PLAN.md) §4 (locked product decisions) → [`app/README.md`](app/README.md)
(current phase detail) → this file.

---

## 2. Architecture map

Electron three-process split. **Tokens never reach the renderer.**

```
main process (Node)                    preload            renderer (React)
─────────────────────                  ────────           ────────────────
collectors/  ── read CLI transcripts   contextBridge      App.tsx + components/
pricing/     ── LiteLLM rates, FX      zod-validated      charts are hand-rolled SVG
db/          ── SQLite (better-sqlite3)  IPC              no chart library
analytics/   ── burn, projections
alerts/      ── rules + Windows toasts
```

### Where things live

| Concern | Path | Notes |
|---|---|---|
| Provider registry | [`app/src/shared/providers.ts`](app/src/shared/providers.ts) | Runtime manifests. **Add a provider here** |
| Canonical token model | [`app/src/shared/tokens.ts`](app/src/shared/tokens.ts) | The most important file in the repo |
| Shared schemas | [`app/src/shared/types.ts`](app/src/shared/types.ts) | zod; shared main↔renderer |
| IPC contract | [`app/src/shared/ipc.ts`](app/src/shared/ipc.ts) | 16 channels |
| Collector orchestration | [`app/src/main/collectors/service.ts`](app/src/main/collectors/service.ts) | watchers, polling, stale handling |
| Per-provider parsers | `app/src/main/collectors/{claude,codex,grok,opencode}/parse.ts` | **pure**, heavily tested |
| Per-provider collectors | `.../{provider}/sessions.ts` | filesystem/DB walking |
| Event → session rollup | [`app/src/main/collectors/aggregate.ts`](app/src/main/collectors/aggregate.ts) | dedupe, pricing, attribution |
| Incremental scan cache | [`app/src/main/collectors/scanCache.ts`](app/src/main/collectors/scanCache.ts) | `(size, mtime)` + byte-offset resume |
| Rate table | [`app/src/main/pricing/rateTable.ts`](app/src/main/pricing/rateTable.ts) + [`store.ts`](app/src/main/pricing/store.ts) | LiteLLM, 24h TTL, disk snapshot |
| Cost arithmetic | [`app/src/main/pricing/cost.ts`](app/src/main/pricing/cost.ts) | four token classes |
| FX | [`app/src/main/pricing/fx.ts`](app/src/main/pricing/fx.ts) | Frankfurter/ECB |
| Migrations | [`app/src/main/db/schema.ts`](app/src/main/db/schema.ts) | 7 so far, append-only |
| Event store | [`app/src/main/db/events.ts`](app/src/main/db/events.ts) | upsert, reprice, day rebuild |
| Read queries | [`app/src/main/db/queries.ts`](app/src/main/db/queries.ts) | 700 lines; the biggest file |
| Timezone maths | [`app/src/main/util/time.ts`](app/src/main/util/time.ts) | tested vs DST + half-hour zones |

### Runtime data (not in the repo)

```
%APPDATA%\ai-usage-dashboard\
  usage.db            SQLite (WAL mode)
  model-rates.json    LiteLLM snapshot
  fx-rates.json       ECB snapshot
  scan-cache.json     parsed transcripts, keyed by (size, mtime)
  logs\app.log
```

---

## 3. Data model

### Tables

| Table | Grain | Purpose |
|---|---|---|
| `usage_events` | **one model call** | The durable record. Every time-dependent aggregate reads this |
| `sessions` | one session | Metadata + a rollup cache of its events |
| `usage_daily` | (day, provider) | Derived from events, in the display timezone |
| `quota_snapshots` | one poll | Quota history; drives burn charts |
| `collector_health` | one provider | Last scan, last error, watcher status |
| `alerts`, `settings`, `schema_version` | | |

### Invariants — do not break these

1. **The canonical token model is five fields**, and `reasoning` is a **subset of
   `output`**, never added into a total. Providers disagree about this; the
   parsers normalize. See [`tokens.ts`](app/src/shared/tokens.ts).
2. **`tokens_total` = uncached_input + cached_input + cache_creation + output.**
   It includes cached tokens for every provider. It did not before Phase A, and
   that made providers incomparable.
3. **Events carry the *raw* provider model id**, because it is the rate-table
   lookup key. Display normalization happens on read.
4. **Unpriced is a state, never a guess.** `cost_usd IS NULL` means no rate was
   found. Never substitute a default rate.
5. **De-duplication is global**, by `dedupe_key`, across files.
6. **Costs stored in `usage_events` are a cache of the rate table.** If you
   change pricing inputs you must call `repriceEvents` + `refreshSessionRollups`,
   and `rebuildAllDays` if the timezone changed. See the `settingsSet` handler.
7. **Day bucketing happens in JS, not SQL**, because SQLite cannot resolve an
   IANA zone.

### Provider quirks (each one cost real debugging)

| Provider | Quirk |
|---|---|
| Claude | One record per **content block**, each repeating the full usage object → dedupe on `messageId:requestId` or overcount ~2.4× |
| Claude | `<synthetic>` records are CLI-composed placeholders (rate-limit notices), not model calls |
| Claude | Thinking tokens are folded into `output`; there is no reasoning split |
| Codex | `total_token_usage` is **cumulative** — sum `last_token_usage` deltas instead |
| Codex | Forked/subagent rollouts replay the parent's history re-stamped; suppressed by a 1s gap heuristic |
| Codex | `input_tokens` **includes** the cached half |
| Codex | `token_count` events carry no model; carried forward from `turn_context` |
| Grok | Usage only on `sessionUpdate === 'turn_completed'`; other lines double-count |
| Grok | Cost is in ticks at **1e10 per USD** (was 1e9 → 10× overstatement) |
| OpenCode | `input` **excludes** cache; `reasoning` sits **beside** output, not inside |

---

## 4. What has been done

Five commits on top of `5b254e3`. All verified against real data on the dev machine.

| Commit | What |
|---|---|
| `0f8d013` | **Phase A** — canonical token model, LiteLLM per-class pricing, global dedupe, Codex fork suppression, incremental scanning, timezone maths, live FX |
| `a31e7d5` | Ignore Claude `<synthetic>` records; add `npm run verify:real` |
| `cc0d1db` | **Phase A5** — `usage_events` table; overview/daily/model-mix read events |
| `6fad399` | **Phase B** — Codex quota via `codex app-server` JSON-RPC; tolerant Claude auth with precise diagnosis; normalized windows + unavailability model |
| `4c294e4` | **Phase C** — open provider registry; OpenCode support; open model normalization |

### Measured impact on the dev machine

- Claude `tokens_total` **6.24M → 2.28B** (365×) — cached tokens were being discarded
- **16 of 97 sessions span >1 day**; **12 use >1 model** — all previously mis-attributed
- Claude unpriced sessions **8 → 0** after the `<synthetic>` fix
- Warm scan **1,116ms → 11ms**
- OpenCode: our independent pricing produced **$0.1473 — the same figure OpenCode itself recorded**

---

## 5. TRIAGE — open problems

Ordered by severity. `[P1]` blocks trust in the numbers or ships broken; `[P2]`
matters for production; `[P3]` is polish.

### P1 — correctness / trust

| # | Problem | Where | Notes |
|---|---|---|---|
| T1 | **Grok tick divisor unverified against a live account.** Changed 1e9 → 1e10 on T3 Code's reading. Circumstantial evidence supports 1e10 ($7.55 vs $75.47 for 18.5M tokens) but it is not confirmed | [`grok/parse.ts`](app/src/main/collectors/grok/parse.ts) `GROK_COST_TICKS_PER_USD` | Needs one cross-check against an xAI billing statement |
| T2 | **Claude quota is fragile and silently broke for 55 min** on 2026-09-05, six minutes after Claude Code rewrote `.credentials.json`. Root cause never confirmed | [`claude/auth.ts`](app/src/main/collectors/claude/auth.ts) | Diagnosis is now specific, but the underlying endpoint is still private |
| T3 | **The rendered UI has never been visually verified** against the new data shape. Pipeline and DB verified; the React layer was not | `app/src/renderer/` | See [Traps](#traps-that-will-waste-your-time) for why |

### P2 — production readiness

| # | Problem | Notes |
|---|---|---|
| T4 | **No CI whatsoever.** No workflow, no lint, no format config | A `windows-latest` job running `typecheck` + `test` + `build` is the single highest-value addition |
| T5 | **No code signing.** `dist:signed` exists but is unprovisioned | An unsigned installer that reads AI credentials will trip SmartScreen |
| T6 | **Update feed points nowhere.** `AI_USAGE_UPDATE_URL` is wired but unset | GitHub Releases as a generic feed is enough |
| T7 | **`better-sqlite3` cannot load under plain Node** (built for Electron's ABI). DB tests use `node:sqlite` as a stand-in | Tests the SQL, *not* the driver. CI must account for this |
| T8 | **No in-app privacy disclosure.** The app reads four credential files; only the README says so | Should be a first-run panel |
| T9 | **Windows only.** Paths are `homedir()`-based and portable; packaging is not | |

### P3 — gaps and polish

| # | Problem | Notes |
|---|---|---|
| T10 | **No UI for price overrides.** `settings.price_overrides` works end to end and repricing is wired, but nothing in the renderer edits it | Blocks users from pricing `codex-auto-review`, `grok-4.x-build` |
| T11 | **`quota_windows` / `unavailable` / `transport` are not rendered.** Populated by collectors, ignored by the UI, which still reads the legacy `windows` array | |
| T12 | **OpenCode has no filesystem watcher.** Other providers get sub-second push; OpenCode only refreshes on the poll | `service.ts` `ensureRealtimeWatchers` hardcodes three homes |
| T13 | **`queries.ts` is ~700 lines** and mixes settings, quota, sessions, export | Split candidate |
| T14 | **Alerts engine still speaks the old vocabulary** (`estimate-only`) rather than the new `unavailable.reason` | [`alerts/engine.ts`](app/src/main/alerts/engine.ts) |
| T15 | **`getBurn` / `getProjections` still read `sessions` + `usage_daily`,** not events | Lower impact; daily table is now event-derived |

---

## 6. Backlog — what to do next

Sized roughly. **Pick from different rows to work in parallel.**

| Task | Size | Touches | Conflicts with |
|---|---|---|---|
| **B1. CI workflow** (T4) | S | `.github/workflows/` | nothing |
| **B2. ESLint + Prettier** (T4) | S | root configs, maybe every file on first format | *everything* — do alone |
| **B3. Price-override UI** (T10) | M | `SettingsPanel.tsx`, `App.tsx` | B5 |
| **B4. Render quota windows + unavailability** (T11) | M | `QuotaCard.tsx`, `App.tsx` | B3, B5 |
| **B5. Renderer visual pass** (T3) | M | `app/src/renderer/**` | B3, B4 |
| **B6. Multi-machine** (Phase C13, not started) | L | new module, `db/`, IPC, UI | B7 |
| **B7. Move burn/projections to events** (T15) | M | `queries.ts`, `analytics/` | B6 |
| **B8. OpenCode watcher** (T12) | S | `service.ts` | B6 |
| **B9. Alerts vocabulary** (T14) | S | `alerts/engine.ts` | nothing |
| **B10. Privacy disclosure** (T8) | S | renderer, new component | B5 |
| **B11. Add a provider** (Gemini / Copilot / Antigravity) | M each | new `collectors/<id>/`, `providers.ts` | other provider work only at `providers.ts` |
| **B12. macOS/Linux packaging** (T9) | L | `package.json` build config | nothing |

### Notes on B6 (multi-machine), the largest untouched item

Design not yet chosen. Two candidates:
- **Export/import signed usage bundles** — simple, offline, user-driven. Events
  already have globally unique `dedupe_key`s, so merging is an upsert.
- **Sync daemon** — better UX, much more surface (auth, transport, conflict).

The event store was deliberately designed to make the first option easy. Start
there unless the user says otherwise.

### Adding a provider — the short version

1. Add a manifest to [`providers.ts`](app/src/shared/providers.ts).
2. Create `collectors/<id>/parse.ts` — **pure**, one function, line/row → `UsageEvent`.
   Normalize into the canonical token model; get the reasoning/cache semantics right.
3. Create `collectors/<id>/sessions.ts` — walk the store, call `collectUsage(events, facts)`.
4. Create `collectors/<id>/index.ts` — the `ProviderAdapter`. If the provider has
   no subscription quota, return `unavailable: { reason: 'unsupported' }`, not `unknown`.
5. Register it in [`registry.ts`](app/src/main/collectors/registry.ts).
6. Write `parse.test.ts` with fixtures **captured from a real store**.
7. Add it to `scripts/verify-real-data.test.ts`.

Nothing in `db/`, `ipc/` or the renderer needs to change. That is the point of Phase C.

Known candidates present on the dev machine: `~/.gemini`, `~/.copilot`,
`~/.antigravity` — all exist but were not investigated for usage data.

---

## 7. Parallel work protocol

### File ownership zones

Claim a zone in your first message. Zones rarely conflict.

| Zone | Files | Typical tasks |
|---|---|---|
| **A. Collectors** | `app/src/main/collectors/**` except `service.ts` | B11, provider fixes |
| **B. Pricing** | `app/src/main/pricing/**` | rate/FX work |
| **C. Storage** | `app/src/main/db/**` | B6, B7, migrations |
| **D. Renderer** | `app/src/renderer/**` | B3, B4, B5, B10 |
| **E. Infra** | `.github/`, root configs, `package.json` | B1, B2, B12 |

### Shared files — coordinate before editing

These are touched by almost everything. Announce, edit, commit quickly.

- `app/src/shared/types.ts` — additive changes only; never reorder or remove
- `app/src/shared/ipc.ts` — adding a channel means preload + handler + renderer
- `app/src/main/collectors/service.ts` — the orchestrator
- `app/src/main/db/schema.ts` — **see migration rule below**

### Migration rule

Migrations are **append-only and numbered**. Two agents adding migration 8
simultaneously will corrupt user databases in a way that cannot be recovered by
re-running.

> **Before writing a migration, check `git log -1 --format=%H -- app/src/main/db/schema.ts`
> and announce the version number you are claiming.** If someone else has claimed
> it, take the next one.

Current highest: **7**.

### Commit convention

- One logical change per commit; imperative subject line
- Body explains *why*, and states what was verified
- Never commit with failing tests or a failing typecheck
- Run `npm test && npm run typecheck && npm run build` before every commit

---

## 8. Traps that will waste your time

1. **`better-sqlite3` throws `NODE_MODULE_VERSION` under plain Node.** It is
   compiled for Electron's ABI. This is expected. Tests that need real SQLite use
   `node:sqlite` with a small `.transaction()` shim — see
   [`events.test.ts`](app/src/main/db/events.test.ts). Never "fix" this by
   rebuilding for Node; that breaks the app.

2. **A `catch {}` that returns an empty result is a bug.** An empty collector
   result is indistinguishable from "this provider has no usage", which is how a
   native-module failure hid for weeks. Throw, and let `service.ts` record it on
   the health row.

3. **Editing source with shell heredocs + Python injects escape bugs.** Two
   separate incidents in this repo: a literal NUL byte written into
   `queries.ts` and `events.ts` (made git treat them as binary), and a stray
   backslash in an import. Prefer the Write/Edit tools for source. If you must
   script an edit, grep for raw NULs afterwards:
   ```bash
   python -c "import io,glob; print([f for f in glob.glob('app/src/**/*.ts',recursive=True) if b'\x00' in io.open(f,'rb').read()])"
   ```

4. **`npm run dev` hot-reloads the main process.** If the app is running while
   you edit, it re-runs collectors and migrations against the *real* database.
   That is usually convenient and occasionally surprising.

5. **Migration 6 was destructive by design** (cleared `sessions` + `usage_daily`
   so they would rebuild from transcripts). Sessions whose transcripts were
   already deleted are gone. Do not repeat this pattern without saying so
   explicitly in the migration comment and to the user.

6. **`npm test` must stay hermetic.** Anything needing real credentials, real
   transcripts, or the network goes in `app/scripts/` under
   `vitest.verify.config.ts` (`npm run verify:real`).

7. **Reading credential files may be blocked by the harness**, and that is
   correct. Do not work around it. Diagnose from the app's own records instead —
   `quota_snapshots` history is very informative.

8. **computer-use cannot attach to the dev build.** The window runs as
   `electron.exe` (title "AI Usage Dashboard") and the allowlist resolver only
   matches Start-menu entries, so `request_access` fails for both "Electron" and
   "AI Usage Dashboard". To verify the UI visually you likely need to run the
   packaged build from `app/release/win-unpacked/` so it registers under a
   resolvable name. **This is why T3 is still open.**

---

## 9. How to verify your work

```bash
cd app
npm test              # hermetic; must stay green
npm run typecheck     # both tsconfigs
npm run build         # main + preload + renderer
npm run verify:real   # against YOUR machine's CLIs — prints real numbers
```

`verify:real` is the highest-signal check for collector work. It found the
Claude `<synthetic>` bug that no fixture contained. It prints per-provider
totals, the token-class split, unpriced counts, scan timings, event counts, and
how many sessions span multiple days or models.

Sanity checks it asserts on real data: totals equal the sum of their parts,
reasoning never exceeds output, costs are non-negative, session ids are unique,
event dedupe keys are unique.

---

## 10. Product decisions that are locked

From [`PLAN.md`](PLAN.md) §4. Do not relitigate without asking the user.

1. Plans are **per user**, resolved API → user override → `Unknown`. Never
   hard-code a plan.
2. **Never store prompts or responses.**
3. Project names are **basenames only** — never full paths.
4. `AUTH LIVE` only when a connected source returned a real figure. Otherwise
   `LOCAL ESTIMATE` with a source line.
5. **API-equivalent cost is a comparison metric, not a subscription bill.**
6. Charts: solid = observed, dashed = projection.

---

## 11. Open questions for the user

Carry these forward; do not decide them unilaterally.

1. **Grok tick divisor** — can they confirm 1e10 against an xAI statement? (T1)
2. **Multi-machine design** — export/import bundles, or a sync daemon? (B6)
3. **Which provider next** — Gemini, Copilot, Antigravity? (B11)
4. **Do they want the UI verified visually** before more backend work? (T3)
