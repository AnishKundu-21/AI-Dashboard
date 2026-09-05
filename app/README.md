# AI Usage Dashboard — Electron app

Local-first desktop app for **Grok Build**, **Claude Code**, and **Codex CLI** usage and remaining quota.

See the repo root [`README.md`](../README.md) and [`PLAN.md`](../PLAN.md) for product context.

## Prerequisites

- Node.js 20+
- npm
- Windows: **Visual Studio Build Tools** (C++ workload) for `better-sqlite3`
- For live quota: logged-in Grok Build / Codex / Claude Code CLIs

## Scripts

```powershell
cd app
npm install
# If better-sqlite3 fails on very new Node (e.g. 25.x), use:
#   npm install --ignore-scripts
#   npm run rebuild:native
npm run dev        # Electron + Vite HMR
npm run build      # compile main/preload/renderer
npm run typecheck
npm test
npm run dist       # Windows NSIS installer (after build)
npm run dist:signed # production artifact; requires signing environment/certificate
```

**Note:** `better-sqlite3` is rebuilt for the **Electron** ABI (`rebuild:native`), not for system Node. That is expected.

## Current phase

**Phase 4 + Phase A correctness pass:** real-data hardening, diagnostics,
security, Windows packaging, and a rebuilt usage/pricing pipeline.

### Phase A — token accounting and pricing

Usage is now parsed into a canonical four-class token model
(`uncached_input` / `cached_input` / `cache_creation` / `output`, plus
`reasoning` as a documented subset of output) and priced per class:

- **Model prices come from LiteLLM's public rate table**, fetched on a 24h TTL
  and snapshotted to `%APPDATA%` so pricing survives being offline. A model
  with no known rate is reported as **unpriced**, never priced at a guess.
  Per-model overrides can be set in settings for private or unreleased models.
- **Cache reads and writes are priced separately** from uncached input. A
  coding agent's traffic is mostly cache reads, at roughly a tenth of the input
  rate, so a single blended rate cannot approximate it. Cache savings are
  reported alongside cost.
- **`tokens_total` includes cached tokens for every provider.** It previously
  excluded them for Claude and included them for Codex, so the two could not be
  compared.
- **De-duplication is global, keyed on `messageId:requestId`.** Claude writes
  one record per assistant content block, each repeating the whole usage
  object, and replays earlier messages into new transcripts when a session is
  resumed.
- **Codex reads per-turn deltas** (`last_token_usage`), not the cumulative
  `total_token_usage`, and **suppresses the copied parent history** at the head
  of a forked or subagent rollout.
- **Grok counts only `turn_completed` updates**, and emits one event per model
  so a multi-model turn is priced at each model's own rate.
- **Usage is stored per model call**, not per session (`usage_events`). A
  session that ran past midnight contributes to both days and one that switched
  models is priced at each model's own rate; on this developer's machine that is
  16 and 12 sessions respectively out of 97. Overview totals, the daily chart
  and the model mix all read events. Costs are stored at ingest and repriced
  when the rate table or a price override changes.
- **Day bucketing is timezone-correct**, tested against half-hour offsets and
  DST boundaries.
- **Transcript scanning is incremental.** Files are memoised by `(size, mtime)`
  and a grown file resumes from a byte offset behind a guard hash, so the
  previous per-provider file caps (250 / 80 / 250) are gone and full history is
  scanned.
- **FX rates are fetched** from Frankfurter (ECB reference rates, no API key)
  with the same TTL-and-snapshot pattern. With no rate available, amounts are
  shown in USD rather than converted at a stale hardcoded rate.

- Live collectors (Grok / Codex / Claude discovery) from Phase 2
- Overview with cost-by-provider + avg daily tokens
- Daily chart legends · burn history from snapshots + 3-day projection
- Model mix donut · session search · richer CSV/JSON export (save dialog)
- Forecasts with days-to-empty + recommendations
- Settings: currency (FX), locale, notify, network quota, per-provider plan auto/manual
- Empty databases stay empty: production never inserts sample sessions or fake live quota
- Real-time CLI filesystem watchers push local changes in under a second; remote quota falls back to 15-second focused polling
- Provider-neutral token detail for Grok, Codex, and Claude: input, output, cached, reasoning (when emitted), model calls, provider-reported cost, and API duration
- Today / 3 / 5 / 7 / 30 / 180 / 365 day and lifetime views, with timezone-aware day boundaries
- Clickable chart/model drill-down, session sorting, bounded pagination, and collector health/rescan controls
- Sandboxed preload, trusted-sender IPC checks, branded Windows icon, NSIS installer, and optional HTTPS auto-update feed

## Release configuration

- Set `AI_USAGE_UPDATE_URL` to an HTTPS generic electron-builder update feed to enable update checks in packaged builds.
- Set electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` variables and run `npm run dist:signed` to sign production artifacts. `npm run dist` remains the unsigned local-build path.
- Claude session tokens are read from local Claude Code JSONL. A remaining-quota percentage is shown only if a supported authenticated source returns it.

## Data directory

```text
%APPDATA%\ai-usage-dashboard\
  usage.db
  config.json
  logs\app.log
```

## Security

- Tokens never reach the renderer
- IPC validated with zod
- IPC accepts calls only from the packaged renderer (or the configured Vite dev origin)
- Electron renderer sandbox enabled
- No prompt/response storage
- Project names are basenames only
