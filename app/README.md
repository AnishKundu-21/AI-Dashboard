# AI Usage Dashboard — Electron app

Local-first desktop app for **Grok Build**, **Claude Code**, **Codex CLI**,
**Cursor CLI**, and **OpenCode** usage. Subscription quota is shown for the
providers that expose it.

See the repo root [`README.md`](../README.md) and [`PLAN.md`](../PLAN.md) for product context.

## Prerequisites

- Node.js 20+
- npm
- Windows: **Visual Studio Build Tools** (C++ workload) for `better-sqlite3`
- For live quota: logged-in Grok Build / Codex / Claude Code CLIs
- For local usage: Cursor CLI and/or OpenCode data stores when those providers are enabled

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

- Live collectors (Grok / Codex / Claude / Cursor / OpenCode discovery)
- Overview with cost-by-provider + avg daily tokens
- Analytics with selectable multi-series line/area graphs for daily provider usage and ranked provider/model comparisons, plus full detail tables
- Forecast uses aggregate weekly allowance windows and can overlay every provider/model-specific weekly quota stream in one burn graph
- Forecasts with days-to-empty + recommendations
- Settings: currency (FX), locale, notify, network quota, and plan labels for every provider (auto-detected where available, manual everywhere)
- Provider selector: disable local collection and dashboard display per provider without deleting history
- Empty databases stay empty: production never inserts sample sessions or fake live quota
- Real-time CLI filesystem watchers push local changes in under a second; remote quota falls back to 15-second focused polling
- Provider-neutral analytics across Grok, Codex, Claude, Cursor, and OpenCode: uncached input, cache reads, cache writes, output, reasoning (when emitted), model calls, sessions, provider-reported cost, API-equivalent cost, cache savings, and unpriced-call coverage, broken down by day, provider, and model
- Today / 3 / 5 / 7 / 30 / 180 / 365 day and lifetime views, with timezone-aware day boundaries
- Clickable chart/model drill-down, session sorting, bounded pagination, and collector health/rescan controls
- Sandboxed preload, trusted-sender IPC checks, branded Windows icon, NSIS installer, and optional HTTPS auto-update feed

### Phase B — quota transports

- **Codex quota comes from `codex app-server`**, its own local JSON-RPC
  protocol (`account/rateLimits/read`), over a long-lived child process. No
  scraped bearer token, auth refreshed by the CLI, and strictly more data than
  the private HTTP endpoint returned: both windows with their real durations,
  the plan, and reset credits with titles and expiry. The old
  `chatgpt.com/backend-api/wham/usage` path remains as a labelled fallback for
  CLIs without `app-server`.
- **Claude quota still reads `api.anthropic.com/api/oauth/usage` directly.**
  The Claude Agent SDK exposes the same figures, but its method is named
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` and its own
  docstring says the windows come "from the claude.ai usage endpoint" — the
  same source. Routing through it would add a heavy dependency and a spawned
  process without removing the underlying fragility.
- **Credential reading is tolerant and diagnoses precisely.** Several known
  token shapes are tried, and a failure now distinguishes *missing* from
  *unparseable* from *present but unrecognised* — the last of which reports the
  top-level key names it did find. The single hardcoded path previously failed
  on a real machine after a CLI update and reported "install Claude Code and
  login" at a working installation.
- **Quota windows are normalised** to `{id, kind, label, used_pct, resets_at,
  window_duration_mins}` across providers, and missing figures carry an
  explicit reason: `not_connected`, `auth_unreadable`, `unsupported`,
  `probe_failed` or `network_disabled`. `unsupported` is authoritative — an
  API-key account cannot have subscription windows, so it replaces a previous
  live value instead of being retried as a transient failure.

### Phase C — open provider registry

- **Providers are runtime-registered manifests**, not a closed `as const` union
  threaded through zod, SQL and the UI. Adding one is a manifest plus a
  collector; provider ids are validated by shape so a database or export
  written by a build that knew about a provider stays loadable by one that
  does not, and an unknown id renders with neutral metadata instead of
  crashing on a missing lookup.
- **OpenCode is supported**, as the proof that the registry is genuinely open.
  Usage comes from its SQLite store, one event per assistant message, reading
  only the `message` row's usage blob — prompt and response text live in the
  separate `part` table and are never touched. Two provider-specific facts are
  handled: its `input` count excludes the cached half (unlike Codex and Grok),
  and its `reasoning` count sits beside `output` rather than inside it, so it
  is folded in to keep the canonical invariant. Priced independently, our
  figure matched OpenCode's own recorded cost on this machine.
- **Cursor CLI is supported** through its local Agent transcript JSONL files.
  The collector accepts the provider-native and hook/headless token shapes,
  stores usage metadata only, and reports subscription quota as unsupported
  because Cursor does not expose it through the local transcript surface.
- **Model normalisation is open too.** The three original providers keep their
  family patterns; anything else accepts a plausible model id and lets the rate
  table decide whether it is priceable, rather than relabelling real usage as
  Unknown.
- OpenCode reports `unsupported` for quota rather than a perpetual "unknown":
  it bills per call through the user's own provider keys, so there is no
  subscription window to show.

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
