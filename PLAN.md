# AI Usage Dashboard — Complete Project Plan

**Working name:** Local AI Usage Dashboard  
**Form factor:** Standalone **Electron** desktop app (Windows first)  
**Status:** Research-validated · ready for implementation  
**Last updated:** 2026-07-28 (plans per-user; §5.0 real demo worked example added)  

---

## Table of contents

1. [Vision](#1-vision)
2. [Problem statement](#2-problem-statement)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Locked product decisions](#4-locked-product-decisions)
5. [Research findings (auth + live usage)](#5-research-findings-auth--live-usage) — includes **§5.0 worked demo run**
6. [How live data works (with examples)](#6-how-live-data-works-with-examples)
7. [System architecture](#7-system-architecture)
8. [Tech stack](#8-tech-stack)
9. [Repository structure](#9-repository-structure)
10. [Data model](#10-data-model)
11. [Provider adapters](#11-provider-adapters)
12. [IPC contract](#12-ipc-contract)
13. [UI / feature inventory](#13-ui--feature-inventory)
14. [Security and privacy](#14-security-and-privacy)
15. [Alerts and notifications](#15-alerts-and-notifications)
16. [Pricing and currency](#16-pricing-and-currency)
17. [Phased delivery](#17-phased-delivery)
18. [Collaboration model](#18-collaboration-model)
19. [Testing strategy](#19-testing-strategy)
20. [Risks and mitigations](#20-risks-and-mitigations)
21. [Implementation recommendations](#21-implementation-recommendations)
22. [Definition of done (MVP-D)](#22-definition-of-done-mvp-d)
23. [Future work](#23-future-work)
24. [Appendix: demos and references](#24-appendix-demos-and-references)

---

## 1. Vision

One **installable desktop app** that answers:

> Where is my coding-agent allowance going — and how much is left?

It unifies **subscription quota**, **local session usage**, and **API-equivalent cost** for the tools you actually use to code:

| Tool | Plan shown in UI | Role in app |
|------|------------------|-------------|
| **Grok Build** | **Detected per user** (e.g. SuperGrok, X Premium+, unknown) | Live quota + sessions |
| **Codex CLI** | **Detected per user** (e.g. Plus, Pro, Team, unknown) | Live rate windows + sessions |
| **Claude Code** | **Detected per user** (e.g. Free, Pro, Max, unknown) | Live quota when logged in + sessions |

Plans are **not hard-coded** to one developer’s subscriptions. See [§4 Locked product decisions](#4-locked-product-decisions).

**UX reference:** `ai-usage-dashboard-prototype/index.html` (feature checklist and aesthetic — UI may evolve).

**Not a SaaS.** Local-first, metadata-only, no prompt storage.

---

## 2. Problem statement

Today you must open separate consoles (xAI / ChatGPT / Claude) or guess remaining limits while agents burn quota in the CLIs. There is **no single local pane** for:

- Remaining **subscription** pool % (not Platform API $ invoices alone)
- Burn rate and “days until empty”
- Sessions by **project**
- Fair comparison of “what this would cost on API rates”
- Alerts before you hit the wall mid-task

**Insight from research:** these tools already log you in locally. We **observe** their auth files and (where available) call the same usage surfaces they use — we do **not** re-login the user for every vendor in v1.

---

## 3. Goals and non-goals

### Goals (v1 / MVP-D)

1. Standalone Electron app on Windows (installable build).
2. Detect **connected** status for Grok Build and Codex from local CLI auth; Claude when credentials exist.
3. **Live remaining quota** when usage/billing APIs succeed; otherwise clear **estimate**.
4. Local **session** collection (project, model, tokens if available, duration) — **no prompt/response bodies**.
5. Overview metrics, charts, model mix, forecasts, CSV/JSON export.
6. In-app alerts + **Windows notifications**.
7. User-selectable **currency** (locale default).
8. Schema ready for future providers later without a rewrite.
9. Safe for two collaborators (typed IPC, small PRs, clear ownership).

### Non-goals (v1)

- Multi-machine sync (folder watch / relay) — design only
- Mobile / React Native
- Cloud backend or multi-tenant accounts
- Storing chat content
- Scraping web dashboards with headless browsers
- Third-party “Login with OpenAI/Anthropic/xAI” OAuth apps as the primary path
- Rust / Tauri
- Public distribution polish (auto-update, code signing) — optional later

---

## 4. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Providers | Grok Build, Claude Code, Codex now; pluggable IDs later |
| 2 | Priorities | (1) remaining quota % (2) API-equivalent cost (3) tokens/sessions · multi-machine later |
| 3 | **Plans** | **Per-user, not hard-coded.** Resolve in order: (a) live API / auth metadata → (b) user override in Settings → (c) `Unknown` / “not detected”. Never assume Free, Plus, or SuperGrok for every install. |
| 4 | Live quota | Best-effort **for all three** when account connected |
| 5 | Auth model | **First-party CLI sessions** (read local auth) — not custom OAuth as core |
| 6 | Currency | Locale default + user override (INR, USD, EUR, …) |
| 7 | Project name | git root basename → folder name → `unknown` · **no full paths** |
| 8 | Content storage | **Never** store prompts/responses |
| 9 | Alerts | Dashboard + Windows toast |
| 10 | MVP bar | **MVP-D** — prototype feature parity with real data |
| 11 | Stack | Electron + TypeScript + React + Vite + SQLite |
| 12 | UI | May evolve from prototype |
| 13 | Plan source label | UI may show how plan was chosen: `Detected` · `User set` · `Unknown` |

### 4.1 Plan resolution (all providers)

Plans belong to **the account on that machine**, not to this repo’s authors.

```text
1. DETECT   from provider API or local auth metadata
            e.g. Codex plan_type: "plus" | "pro" | …
                 Claude subscription fields when present
                 Grok product/billing hints when present
2. OVERRIDE if user set a plan in Settings (wins when user opts in)
3. FALLBACK "Unknown" — still show usage % / sessions when available
```

| Provider | Detection examples (when available) | User can override? |
|----------|-------------------------------------|--------------------|
| **Codex** | `plan_type` from `wham/usage` (e.g. `plus`, `pro`) | Yes |
| **Claude** | OAuth/credentials / usage payload subscription tier (Free, Pro, Max, …) | Yes |
| **Grok** | Billing/product context when exposed; else leave Unknown or user-set (SuperGrok, X Premium+, …) | Yes |

**Examples**

- Collaborator A: Codex → detected `plus`; Claude → detected `max`; Grok → user sets SuperGrok.  
- Collaborator B: Codex → detected `pro`; Claude → Free; Grok → Unknown until they set it.  
- Same app binary, **different cards** — correct.

**Settings UX (recommended)**

```text
Claude plan:  [ Auto-detect ▼ ]  or  Free | Pro | Max | Team | Custom…
              Currently: Max (detected)
Codex plan:   [ Auto-detect ▼ ]
              Currently: plus (detected)
Grok plan:    [ Auto-detect ▼ ]  or SuperGrok | X Premium+ | …
              Currently: Unknown — set manually if you want a label
```

Default mode: **Auto-detect**. Manual override is optional and sticky until cleared.

### Honesty rules (non-negotiable)

1. **AUTH LIVE** only when a connected source returned a real remaining/used figure.
2. Otherwise **LOCAL ESTIMATE** + source line.
3. Never invent exact remaining % as live.
4. **API-equivalent cost** is a comparison metric, not the subscription bill.
5. Charts: solid = observed · dashed = projection.
6. **Never hard-code another user’s plan** as the product default for all installs.

---

## 5. Research findings (auth + live usage)

### 5.0 Worked example — real demo run (2026-07-28)

The following is a **redacted summary** of actual runs of the project **demo files** on a developer Windows machine. Use it as the **reference mapping** for adapters and UI. Values change over time; shapes matter more than exact numbers.

**Reproduce:** run the demo files from the project root (see repository layout / README).

#### Scorecard from that run

| Provider | Connected | Live usage API | Plan (per-user) | Local sessions |
|----------|-----------|----------------|-----------------|----------------|
| **Grok** | Yes | Yes | Not in billing body → Unknown / user-set | Yes (88 docs, 2 active) |
| **Codex** | Yes | Yes | **Detected `plus`** | Auth + local DBs present |
| **Claude** | **No** (`~/.claude` missing) | — | — | — |

#### Grok — what the demo printed (interpreted)

**1) Local auth**

```text
path: %USERPROFILE%\.grok\auth.json
connected: True
email_masked: ku***@…
expires_at: 2026-07-28T21:23:36Z
auth_mode: oidc
user_id_present: True
team_id_present: True
```

**2) Local sessions**

```text
active_sessions count: 2
  - cwd=Dashboard  (project basename for UI)
session_docs columns: session_id, cwd, updated_at, title, content, …
session_docs count: 88
→ Product must SELECT metadata only — never store `content`
```

**3) Remote billing (success)**

```text
GET https://cli-chat-proxy.grok.com/v1/user
  status: 200
  → identity OK (do not persist raw email in exports)

GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
  status: 200
  config.currentPeriod.type  = USAGE_PERIOD_TYPE_WEEKLY
  config.currentPeriod.start = 2026-07-21T16:19:41Z
  config.currentPeriod.end   = 2026-07-28T16:19:41Z
  config.creditUsagePercent  = 33.0
  config.productUsage        = [
      { product: "GrokBuild", usagePercent: 18.0 },
      { product: "GrokChat",  usagePercent: 15.0 }
    ]
  onDemandUsed / prepaidBalance = 0

GET https://api.x.ai/v1/models
  status: 200
  → token valid for API; not used for subscription %

GET .../v1/users/{id}/billing
  status: 404
  → ignore this URL in production
```

**Dashboard mapping (Grok)**

| API / local field | App field | Example value |
|-------------------|-----------|---------------|
| `creditUsagePercent` | `used_pct` | `33` |
| `100 - used` | `remaining_pct` | `67` |
| `currentPeriod.type` | `window_label` | `Weekly` |
| `currentPeriod.end` | `reset_at` | period end ISO |
| `productUsage[]` | breakdown | Build 18%, Chat 15% |
| auth present | `auth_connected` | `true` |
| billing 200 | `confidence` | `live` |
| plan not in body | `plan` / `plan_source` | `null` / `unknown` (or user override) |

```json
{
  "provider": "grok",
  "plan": null,
  "plan_source": "unknown",
  "used_pct": 33,
  "remaining_pct": 67,
  "window": "weekly",
  "reset_at": "2026-07-28T16:19:41+00:00",
  "products": { "GrokBuild": 18, "GrokChat": 15 },
  "confidence": "live",
  "source": "cli-chat-proxy.grok.com/v1/billing",
  "auth_connected": true
}
```

**Quota card (how UI should look for this run)**

```text
┌─ Grok Build ─────────────────────────┐
│  AUTH LIVE                           │
│  67% remaining                       │
│  ████████░░░░░░░░  33% used          │
│  Weekly pool · resets at period end  │
│  Build 18% · Chat 15%                │
│  Plan: Unknown (set in Settings)     │
│  source: cli-chat-proxy + auth.json  │
└──────────────────────────────────────┘
```

#### Codex — what the demo printed (interpreted)

**1) Local auth**

```text
path: %USERPROFILE%\.codex\auth.json
exists: True
auth_mode: (chatgpt oauth-style)
OPENAI_API_KEY: null          ← subscription path, not API key
tokens.access_token: present
tokens.refresh_token: present
tokens.account_id: present
last_refresh: present
```

**2) Live usage (success)**

```text
GET https://chatgpt.com/backend-api/wham/usage
  status: 200
  plan_type: "plus"                          ← per-user plan detection
  rate_limit.allowed: true
  rate_limit.limit_reached: false
  rate_limit.primary_window.used_percent: 0
  rate_limit.primary_window.limit_window_seconds: 604800   ← 7 days
  rate_limit.primary_window.reset_after_seconds: 604800
  rate_limit.primary_window.reset_at: <unix>
  credits: { has_credits, balance, … }
  rate_limit_reset_credits: { available_count, … }

GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
  status: 200
  credits[]: reset credits with status "available", expires_at, …
```

**Dashboard mapping (Codex)**

| API field | App field | Example value |
|-----------|-----------|---------------|
| `plan_type` | `plan` | `"plus"` |
| (from API) | `plan_source` | `"api"` |
| `primary_window.used_percent` | `used_pct` | `0` |
| `100 - used` | `remaining_pct` | `100` |
| `limit_window_seconds` | window | `604800` → weekly |
| `limit_reached` | alert input | `false` |
| usage 200 | `confidence` | `live` |

```json
{
  "provider": "codex",
  "plan": "plus",
  "plan_source": "api",
  "used_pct": 0,
  "remaining_pct": 100,
  "window": "weekly",
  "limit_reached": false,
  "reset_credits_available": true,
  "confidence": "live",
  "source": "chatgpt.com/backend-api/wham/usage",
  "auth_connected": true
}
```

**Quota card (how UI should look for this run)**

```text
┌─ Codex CLI ──────────────────────────┐
│  AUTH LIVE · plan: plus (detected) │
│  100% remaining                      │
│  ░░░░░░░░░░░░░░░░  0% used           │
│  Weekly window (7 days)              │
│  Reset credits: available            │
│  source: wham/usage + auth.json      │
└──────────────────────────────────────┘
```

This is why plans must be **per-user**: this machine detected `plus`; another user may get `pro` from the same endpoint.

#### Claude — what the demo printed (not connected)

```text
=== CLAUDE ===
~/.claude exists: False
credential candidates found: (none)
No Claude Code credentials on this machine.
→ Install Claude Code + login, then re-run demo
```

**Quota card for this run**

```text
┌─ Claude Code ────────────────────────┐
│  Not connected                       │
│  No local credentials                │
│  CTA: install Claude Code and login  │
└──────────────────────────────────────┘
```

Same adapter code later; empty state is expected until login.

#### Combined dashboard snapshot (this run)

```text
┌─ Grok ─────────────┐ ┌─ Codex ────────────┐ ┌─ Claude ──────────┐
│ LIVE · 67% left    │ │ LIVE · 100% left   │ │ Not connected     │
│ Weekly · 33% used  │ │ Plan: plus (api)   │ │                    │
│ Build 18 Chat 15   │ │ Weekly · 0% used   │ │                    │
└────────────────────┘ └────────────────────┘ └────────────────────┘
```

**Lessons encoded in the product**

1. Two providers can be **live** while a third is **not connected** — UI must handle mixed states.  
2. Grok gave **product split** (Build vs Chat); Codex gave **plan_type** + optional **reset credits**.  
3. Fail soft: Grok user-scoped billing URL **404** — do not depend on it.  
4. Never log or export raw emails / tokens (Codex usage body includes email — strip in production).  
5. Token `expires_at` (Grok) means refresh/re-login paths are required.

---

### 5.1 Grok Build (validated on developer machine)

| Item | Detail |
|------|--------|
| Home | `%USERPROFILE%\.grok\` (override: `%GROK_HOME%`) |
| CLI | `%USERPROFILE%\.grok\bin\grok.exe` |
| Auth file | `auth.json` — OIDC session keyed by `https://auth.x.ai::…` |
| Auth fields | `key` (JWT), `refresh_token`, `expires_at`, `user_id`, `email`, `team_id`, `auth_mode=oidc` |
| Live usage | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with `Authorization: Bearer <key>` |
| Identity | `GET https://cli-chat-proxy.grok.com/v1/user` |
| Sessions | `active_sessions.json`, `sessions\session_search.sqlite` (`session_docs`: id, cwd, updated_at, title, **content** ← ignore content) |
| Example live payload | See **§5.0** (`creditUsagePercent` 33, weekly period, GrokBuild/GrokChat) |
| Demo | Project demo file (Grok) |

**Note:** CLI/proxy billing is powerful but **not a stable public OpenAPI** surface. Pin requests, tolerate schema drift, fall back to estimate.

### 5.2 Codex CLI (validated on developer machine)

| Item | Detail |
|------|--------|
| Home | `%USERPROFILE%\.codex\` (override: `%CODEX_HOME%`) |
| Auth file | `auth.json` |
| Auth fields | `auth_mode`, `tokens.access_token`, `tokens.refresh_token`, `tokens.account_id`, `last_refresh` |
| Live usage | `GET https://chatgpt.com/backend-api/wham/usage` with Bearer + optional `ChatGPT-Account-Id` |
| Reset credits | `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` |
| Local data | `sessions\`, `logs_2.sqlite`, `session_index.jsonl`, etc. |
| Example live payload | See **§5.0** (`plan_type: plus`, `used_percent: 0`, weekly window) |
| Demo | Project demo file (Codex / Claude) |

### 5.3 Claude Code (pattern confirmed; not present on all machines)

| Item | Detail |
|------|--------|
| Typical auth | `~/.claude/.credentials.json` or OS keychain |
| On research machine (demo run) | **No** `~/.claude` — see **§5.0** Claude card |
| Live usage | OAuth token → Anthropic/claude.ai usage endpoints when available; schema TBD after first login |
| Plan | **Per user** — detect from credentials/usage when possible; else Settings / Unknown |
| Action | User runs Claude Code login once → re-run the demo file |

### 5.4 What we will not use as primary

| Approach | Why not primary |
|----------|-----------------|
| Platform Admin Usage APIs only | Track **API $**, not Plus/Free/SuperGrok pools |
| Headless browser scrape | Fragile, ToS-risky |
| User pastes cookies/passwords | Unsafe |
| Unofficial OAuth client_id cloning without need | Unnecessary when CLI auth files work |

---

## 6. How live data works (with examples)

### 6.1 Mental model

```text
User already logged into Grok Build / Codex / Claude Code
              │
              ▼
     Local auth file on disk
              │
              ├──► App reads file (main process only)
              │         → Connected badge
              │
              ├──► App calls usage/billing HTTP with Bearer
              │         → used_pct, reset, plan  → AUTH LIVE
              │
              └──► App watches local sessions/logs
                        → project, models, session table
```

### 6.2 Example: Grok refresh cycle

```text
1. Read C:\Users\<you>\.grok\auth.json
2. Extract entry[0].key (JWT), expires_at
3. If expired → re-read file (CLI may have refreshed) or mark reconnect
4. GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
   Authorization: Bearer <key>
5. Map:
   used_pct      = config.creditUsagePercent
   remaining_pct = 100 - used_pct
   reset_at      = config.currentPeriod.end
   products      = config.productUsage[]
6. Upsert quota_snapshots row
7. Renderer shows card from IPC (no token)
```

### 6.3 Example: Codex refresh cycle

```text
1. Read %USERPROFILE%\.codex\auth.json
2. tokens.access_token + tokens.account_id
3. GET https://chatgpt.com/backend-api/wham/usage
   Authorization: Bearer <access_token>
   ChatGPT-Account-Id: <account_id>
4. Map:
   plan           = plan_type  // "plus"
   used_pct       = rate_limit.primary_window.used_percent
   window_seconds = rate_limit.primary_window.limit_window_seconds
   reset_at       = rate_limit.primary_window.reset_at
5. Optional: GET .../wham/rate-limit-reset-credits
```

### 6.4 Example: session project naming

| cwd | Stored project |
|-----|----------------|
| `C:\Projects\Grok Build\Dashboard` | `Dashboard` (or git root name if repo root differs) |
| `C:\Projects\streamfinder-next\src` | `streamfinder-next` if git root |
| unknown cwd | `unknown` |

Never store full absolute paths in exports by default.

### 6.5 Live vs estimate example

| Situation | Badge | remaining UI |
|-----------|--------|--------------|
| Billing API 200 with used_percent | AUTH LIVE | `67% remaining` |
| Auth valid, billing 401/500 | LOCAL ESTIMATE | burn-based estimate + note |
| No auth file | Not connected | CTA: open CLI and login |
| Claude Free, no usage endpoint | LOCAL ESTIMATE | sessions only until live works |

---

## 7. System architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                     │
│  Dashboard UI · settings · charts · exports                  │
└────────────────────────────▲─────────────────────────────────┘
                             │ typed IPC (contextBridge)
┌────────────────────────────┴─────────────────────────────────┐
│  Main process (Electron + Node TypeScript)                   │
│  · window, tray (optional), single instance                  │
│  · Windows Notification API                                  │
│  · SQLite (WAL)                                              │
│  · Provider registry + collectors + quota refresh            │
│  · Pricing → API-equivalent cost                             │
│  · Alert engine                                              │
└──────────┬──────────────────┬──────────────────┬─────────────┘
           │                  │                  │
    Grok auth/sessions   Codex auth/sessions  Claude auth/sessions
    + cli-chat-proxy     + chatgpt wham       + usage API when available
```

**App data directory (Windows):**

```text
%APPDATA%\ai-usage-dashboard\
  usage.db
  config.json
  logs\app.log          # diagnostics only — no tokens
```

**No required localhost browser server for the product UI** — IPC only. (Prototype was static HTML; production is Electron.)

---

## 8. Tech stack

| Layer | Choice | Notes |
|-------|--------|--------|
| Shell | Electron (latest stable) | Windows x64 first |
| Language | TypeScript (strict) | Shared types |
| UI | React 18+ + Vite | Port/evolve prototype |
| Styling | CSS (tokens from prototype) | No required CDN |
| Charts | SVG (prototype) or uPlot later | Offline |
| DB | better-sqlite3 + migrations | WAL mode |
| Validation | zod | IPC + config + API responses |
| Watchers | chokidar | Debounced |
| Packaging | electron-builder | NSIS `.exe` |
| Lint/format | ESLint + Prettier | |
| Unit tests | Vitest | Fixtures with redacted samples |
| Demos | Python scripts (research) | Optional; product is TS |

**Why Electron (not Tauri/RN):** collaborator-friendly TypeScript-only stack; Node is natural for FS, SQLite, HTTP, watchers; React web UI reuses prototype skills.

---

## 9. Repository structure

```text
Dashboard/
  PLAN.md                          ← this file
  README.md                        ← setup, vision, how to run
  demo files (research)            ← Grok / Codex / Claude live checks
  ai-usage-dashboard-prototype/    ← UX reference
    index.html
    README.md
  app/                             ← product (to be created in Phase 0)
    package.json
    electron.vite.config.ts
    src/
      main/
        index.ts
        ipc/
        db/
        collectors/
          base.ts
          grok.ts
          codex.ts
          claude.ts
          registry.ts
        quota/
        pricing/
        alerts/
        project/
        util/
          paths.ts
          redact.ts
      preload/
        index.ts
      renderer/
        ...
      shared/
        types.ts
        ipc.ts
        providers.ts
    resources/
    README.md
```

---

## 10. Data model

### 10.1 Provider IDs

```ts
type ProviderId = 'grok' | 'claude' | 'codex' // extensible string later

type Confidence = 'live' | 'estimate' | 'unknown'
```

### 10.2 Tables

**settings** (JSON or key/value)

- `display_currency`, `locale`
- `notify_enabled`
- `network_quota_refresh` (default true)
- `retention_days` (default 90)
- `plans`: per-provider `{ mode: 'auto' | 'manual', value?: string, detected?: string, source?: 'api' | 'auth' | 'user' | 'unknown' }`

**quota_snapshots**

| Column | Notes |
|--------|--------|
| id | PK |
| provider | ProviderId |
| captured_at | ISO |
| used_pct | 0–100 |
| remaining_pct | nullable |
| reset_at | nullable |
| window_label | e.g. weekly, 5h+weekly |
| plan_label | from API or settings |
| confidence | live \| estimate |
| source | short provenance |
| auth_connected | 0/1 |
| raw_summary_json | **redacted** summary only (no tokens) |

**sessions**

| Column | Notes |
|--------|--------|
| id | Stable event id |
| provider | |
| project | basename only |
| model | |
| tokens_in / tokens_out / tokens_total | |
| api_equiv_usd | from rate card at ingest |
| duration_ms | |
| status | complete \| cancelled \| error \| rate_limited \| unknown |
| started_at / ended_at | |
| source | adapter name |
| machine_id | hostname hash (future multi-machine) |
| created_at | |

**usage_daily** (optional rollup)

- day, provider, tokens_total, session_count, api_equiv_usd

**alerts**

- id, provider, level, title, body, rule_id, created_at, dismissed_at, notified_at

**schema_version** — migrations.

### 10.3 Adapter interface

```ts
interface ProviderAdapter {
  id: ProviderId
  isConnected(ctx: Context): Promise<boolean>
  refreshQuota(ctx: Context): Promise<QuotaSnapshot>
  collectSessions(ctx: Context): Promise<CollectResult>
}
```

Rules:

- Never persist prompt/response bodies.
- Redact secrets from logs.
- Prefer structured CLI metadata over scraping HTML.

---

## 11. Provider adapters

### 11.1 Grok (`collectors/grok.ts`)

| Concern | Implementation |
|---------|----------------|
| Paths | `~/.grok`, `GROK_HOME` |
| Connected | `auth.json` has OIDC entry with `key` |
| Quota | `cli-chat-proxy.grok.com/v1/billing?format=credits` |
| Sessions | `active_sessions.json`, `session_search.sqlite` — **select only non-content columns** |
| Plan | Detect when API exposes it; else user Settings / Unknown (no hard-coded SuperGrok) |

### 11.2 Codex (`collectors/codex.ts`)

| Concern | Implementation |
|---------|----------------|
| Paths | `~/.codex`, `CODEX_HOME` |
| Connected | `auth.json` → `tokens.access_token` |
| Quota | `chatgpt.com/backend-api/wham/usage` (+ reset-credits) |
| Sessions | local sessions/logs sqlite/jsonl (map carefully) |
| Plan | Prefer API `plan_type`; Settings override; never assume Plus |

### 11.3 Claude (`collectors/claude.ts`)

| Concern | Implementation |
|---------|----------------|
| Paths | `~/.claude/.credentials.json` (+ keychain later) |
| Connected | credentials file exists |
| Quota | OAuth usage endpoints after discovery; else estimate |
| Sessions | Claude Code project/session stores when found |
| Plan | Detect tier from auth/usage when possible; Settings override; **never assume Free** |

---

## 12. IPC contract

Expose via `preload` + `contextBridge` only (`contextIsolation: true`, `nodeIntegration: false`).

| Method | Purpose |
|--------|---------|
| `dashboard.getOverview` | tokens, cost, sessions, avg burn |
| `dashboard.getQuotas` | latest snapshot per provider |
| `dashboard.getDailyUsage` | chart series 7/30d |
| `dashboard.getBurn` | cumulative % + projection |
| `dashboard.getModelMix` | shares |
| `dashboard.getSessions` | filter + search |
| `dashboard.refreshQuotas` | force adapters |
| `dashboard.export` | csv \| json |
| `settings.get` / `settings.set` | currency, plans, notify |
| `alerts.list` / `alerts.dismiss` | |
| `events.onChanged` | push after ingest |

Validate all inputs with **zod**. Never send raw tokens over IPC.

---

## 13. UI / feature inventory

Map from prototype → product:

| Feature | v1 | Notes |
|---------|----|--------|
| Top bar: refresh, export CSV/JSON | Yes | |
| Provider tabs + date range | Yes | all / grok / claude / codex |
| Alerts stack | Yes | + OS notify |
| Overview metrics (tokens, API-equiv, sessions, avg quota) | Yes | |
| Quota cards Live/Estimate | Yes | |
| API-equivalent cost callout | Yes | user currency |
| Daily token chart | Yes | |
| Burn + projection chart | Yes | |
| Model mix | Yes | |
| Recent sessions table | Yes | search |
| Forecasts & recommendations | Yes | simple rules |
| Settings: currency, notify, **per-provider plan auto/manual** | Yes | Detect + override; never global Free/Plus/SuperGrok defaults |
| Multi-machine sync UI | Deferred | hide or “Coming soon” |
| Privacy: content off forever | Yes | hard-coded |
| Network quota toggle | Nice-to-have | default on |

---

## 14. Security and privacy

1. Tokens only in main process memory / read from CLI files — **not** in renderer, DB exports, or toast text.
2. SQLite stores **snapshots and metadata**, not OAuth secrets.
3. Session collectors skip `content` columns and prompt logs.
4. Project = basename only.
5. Redact JWT/API-key-shaped strings in `app.log`.
6. Electron: `contextIsolation`, no `nodeIntegration`, no remote module.
7. Optional later: encrypt config at rest with OS keytar if we ever store refresh copies (v1 prefers not to duplicate CLI secrets).

---

## 15. Alerts and notifications

| Rule id | Condition | Level |
|---------|-----------|--------|
| `high-burn` | used_pct ≥ 70 | warn |
| `critical-burn` | used_pct ≥ 90 | warn |
| `estimate-only` | connected but estimate for N days | info |
| `projection-exhaust` | projected 100% within 3 days | warn |
| `not-connected` | user had provider enabled, auth missing | info |

Delivery:

1. Row in `alerts`
2. Dashboard stack (dismissible)
3. Windows `Notification` if enabled and not yet notified for `(rule_id, provider, day)`

---

## 16. Pricing and currency

1. Versioned **rate card** (USD per 1M tokens per model family).
2. Compute `api_equiv_usd` at session ingest.
3. Display via `Intl.NumberFormat(locale, { style: 'currency', currency })`.
4. FX: configurable or simple static table for non-USD display; document approximate.
5. Settings: currency picker + “use system locale.”

**Example:** 1.84M tokens of Claude Opus-class → rate card → `$X` → format as `₹…` if currency INR.

---

## 17. Phased delivery

### Phase 0 — Scaffold (1–2 days)

- Create `app/` Electron + Vite + React + TS
- Main window + preload hello
- SQLite open + migrations stub
- App data dir helper
- electron-builder stub
- README scripts: `dev`, `build`, `dist`, `test`

**Exit:** both collabs run empty shell.

### Phase 1 — Domain + UI shell (2–4 days)

- Shared types + zod
- Full schema migrations
- Seed data path for UI without real network
- IPC overview/quotas/sessions
- Port dark UI tokens + quota cards skeleton
- Currency formatter

**Exit:** UI reads SQLite via IPC.

### Phase 2 — Collectors (4–7 days)

- Adapter interface + registry
- **Grok** auth + billing + sessions (priority #1)
- **Codex** auth + wham usage + sessions
- **Claude** auth discovery + best-effort usage
- Project resolver + redaction
- Poll interval 30–60s + Refresh button
- Fixtures + unit tests

**Exit:** real machines show live Grok/Codex cards.

### Phase 3 — Analytics parity (3–5 days)

- Daily chart, burn/projection, model mix
- Session search/export
- Forecasts/recommendations
- Pricing rollup

**Exit:** prototype feature parity minus sync.

### Phase 4 — Alerts + polish + package (2–4 days)

- Alert engine + Windows notifications
- Empty/error states
- Installer build smoke test
- Performance pass on large session lists

**Exit:** shareable Windows install.

Implementation update (2026-07-29): the app now includes provider-neutral detailed
token accounting for Grok/Codex/Claude, local filesystem push updates, provider-only
rescans, collector health, timezone-aware ranges, chart/model drill-down, bounded
session pagination/sorting, a sandboxed preload, trusted IPC senders, branded Windows
assets, and an optional generic HTTPS update feed. Claude remaining subscription quota
continues to use the honest estimate/unknown state unless Anthropic exposes a supported
authenticated quota source.

### Phase 5 — Future

- Multi-machine JSONL
- Tray + autostart
- More providers
- Auto-update

---

## 18. Collaboration model

### Role split (suggested)

| Stream | Focus | Paths |
|--------|--------|--------|
| **A — Platform** | Main, DB, IPC, collectors, alerts, packaging | `src/main/**`, `preload`, `shared` |
| **B — Product UI** | React pages, charts, settings, a11y | `src/renderer/**` |

Both own: this plan, PR review, provider discovery notes.

### Git

- `main` always runnable
- Branches: `feat/…`, `fix/…`, `chore/…`
- Small PRs (one adapter or one UI vertical)
- Freeze IPC types early so A/B parallelize

### Dev rhythm

1. Pair Phase 0.
2. After Phase 1, parallel adapters vs UI with seed data.
3. Weekly 30-min demo: live quota honesty edge cases.

### Definition of ready (task)

- Linked to phase checkbox
- Manual test steps
- Notes on secrets/paths

### Definition of done (PR)

- [ ] typecheck + lint
- [ ] no content storage
- [ ] live vs estimate correct
- [ ] manual test notes
- [ ] no secrets in logs/commits

---

## 19. Testing strategy

| Level | What |
|-------|------|
| Unit | project resolver, redact, pricing, projection math, alert rules, response mappers |
| Fixtures | redacted JSON from billing/usage APIs (committed without tokens) |
| Integration | temp SQLite + fake HTTP |
| Manual | run demos; refresh quotas; export; notification |
| Package | install on clean Windows profile |

**Regression:** if Grok/Codex response shape changes, mapper tests fail loudly → estimate fallback.

---

## 20. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLI billing/usage APIs change | Live cards break | Pin parsers; confidence=estimate; watch demos |
| Token expired | 401 | Re-read auth.json; prompt re-login |
| Claude free-tier / sparse metadata | Sparse live % | Sessions + estimate; honest badge; plan still per-user |
| better-sqlite3 native build | Onboarding friction | Document VS Build Tools; electron-rebuild |
| Scope creep (sync, mobile) | Delay | Phase 5 only |
| Accidental secret leak | Security | Redaction tests; code review checklist |
| Shared SuperGrok pool vs product split | Confusion | Show overall + GrokBuild/GrokChat breakdown |

---

## 21. Implementation recommendations

### 21.1 Build order (recommended)

1. **Grok adapter first** — already proven end-to-end on your machine.  
2. **Codex second** — same confidence.  
3. **Claude third** — after `claude auth login` on a dev machine.  
4. UI polish after at least one live provider feels real.

### 21.2 Polling

- Default **60s** quota poll when window focused; **5 min** when backgrounded (save API noise).  
- Manual **Refresh quotas** always available.  
- Session FS watch with **2s debounce**.

### 21.3 HTTP client

- Use undici/fetch with explicit timeouts (10–20s).  
- Treat non-2xx as soft failure (keep last good snapshot + timestamp).  
- User-Agent: `ai-usage-dashboard/<version>`.

### 21.4 Response mapping

- Put raw→snapshot mappers in pure functions (`mapGrokBilling`, `mapCodexUsage`) with golden fixtures.  
- Never pass full raw billing JSON to renderer if it contains email; strip PII.

### 21.5 Session privacy

```ts
// GOOD
SELECT session_id, cwd, updated_at, title FROM session_docs

// BAD
SELECT content FROM session_docs
```

### 21.6 Electron packaging

- Use `electron-vite` or equivalent dual-compile for main/preload/renderer.  
- Externalize `better-sqlite3`; run rebuild for Electron ABI.  
- Single instance lock so two collectors don’t fight.

### 21.7 Collaborator onboarding

1. Install Node 20+, Git, VS Build Tools (Windows).  
2. Login to Grok Build + Codex (and Claude if testing).  
3. Run the project **demo files** to verify live APIs.  
4. `cd app && npm i && npm run dev`.

### 21.8 Reference material in this repo

- Prototype HTML — layout and honesty labels.  
- Project demo files — executable proofs for Grok/Codex live usage.

### 21.9 Code quality defaults

- Strict TypeScript  
- No `any` on IPC boundaries  
- Prefer small pure modules over god-classes  
- Feature flags for flaky Claude live path  

---

## 22. Definition of done (MVP-D)

- [ ] Windows installable app launches  
- [ ] Grok card: connected + live weekly % when CLI logged in  
- [ ] Codex card: connected + live window % when CLI logged in  
- [ ] Claude card: connected when credentials exist; live or estimate honestly  
- [ ] Sessions table with project basenames (no content)  
- [ ] Overview metrics + charts + projections  
- [ ] API-equivalent cost in user currency  
- [ ] Export CSV/JSON  
- [ ] Alerts + Windows notifications  
- [ ] Settings: currency, notify  
- [ ] No secrets in renderer or exports  
- [ ] README allows a new collab to run in &lt; 30 minutes  

---

## 23. Future work

- Multi-machine append-only JSONL sync  
- System tray + autostart  
- Additional provider adapters  
- In-app device-code OAuth only if CLI files often missing  
- Auto-update + code signing  
- Optional Platform API Admin spend section (separate from subscription pools)  

---

## 24. Appendix: demos and references

### Demo files in this repo

Research **demo files** at the project root prove local auth + live usage (Grok, Codex; Claude when logged in). Run them with Python from the project root.

Interpreted output from a successful run (Grok live 33% used, Codex live `plan_type: plus` / 0% used, Claude not connected) is documented in **[§5.0 Worked example](#50-worked-example--real-demo-run-2026-07-28)**.

### Prototype

```text
ai-usage-dashboard-prototype/index.html
```

Open in a browser for UX reference (sample data only).

### Key endpoints (subject to change)

| Provider | Endpoint |
|----------|----------|
| Grok billing | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` |
| Grok user | `GET https://cli-chat-proxy.grok.com/v1/user` |
| Codex usage | `GET https://chatgpt.com/backend-api/wham/usage` |
| Codex reset credits | `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` |

### Key local paths (Windows)

| Provider | Path |
|----------|------|
| Grok | `%USERPROFILE%\.grok\auth.json` |
| Codex | `%USERPROFILE%\.codex\auth.json` |
| Claude | `%USERPROFILE%\.claude\.credentials.json` (when present) |

---

## Plan acceptance

| Person | Stream (A Platform / B UI / both) | Date | OK? |
|--------|-----------------------------------|------|-----|
| | | | |
| | | | |

---

*This plan supersedes earlier drafts. Implementation should follow phases above and keep honesty rules inviolable.*
