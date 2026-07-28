# Local AI Usage Dashboard

**Standalone Electron app** that shows where your coding-agent allowance goes — and how much is left — for **Grok Build**, **Codex CLI**, and **Claude Code**.

Local-first · metadata-only · no prompt storage · Windows first

---

## Why this exists

There is no single place to see:

- **Remaining quota** for whichever Grok / ChatGPT / Claude plan **you** are on
- Which **projects** burned tokens
- Whether you are on pace to hit limits mid-week
- Rough **API-equivalent cost** of the same work

This project builds that pane as a **desktop app** that reuses the logins you already have in the CLIs. **Plans are detected per user** (or set in Settings)—not hard-coded to one developer’s Free/Plus/SuperGrok mix.

---

## Status

| Area | Status |
|------|--------|
| Product plan | **Complete** — see [`PLAN.md`](./PLAN.md) |
| UX prototype | **Done** — `ai-usage-dashboard-prototype/` |
| Live data research | **Validated** for Grok + Codex; Claude when CLI logged in |
| Worked example | [Real demo run (Grok 33% / Codex plus 0% / Claude n/a)](#worked-example--real-demo-run-2026-07-28) |
| Research demos | Demo files at project root |
| Electron app (`app/`) | **Not started** (Phase 0) |

Read **[`PLAN.md`](./PLAN.md)** for full architecture, phases, IPC, schema, risks, and collaboration rules.

---

## What you get (product)

### Providers (v1)

| Provider | Plan shown | Live quota source (when connected) |
|----------|------------|-------------------------------------|
| **Grok Build** | **Per user** (detect + optional Settings) | Local `~/.grok/auth.json` → xAI CLI billing API |
| **Codex CLI** | **Per user** (e.g. API `plan_type`: plus/pro/…) | Local `~/.codex/auth.json` → ChatGPT `wham/usage` API |
| **Claude Code** | **Per user** (Free / Pro / Max / … — never assumed) | Local Claude credentials → usage API when available |

**Plan resolution:** auto-detect from API/auth → optional user override in Settings → otherwise `Unknown`. See [`PLAN.md` §4](./PLAN.md#4-locked-product-decisions).

### Features (MVP-D)

- Remaining quota cards with **AUTH LIVE** vs **LOCAL ESTIMATE**
- Overview: tokens, API-equivalent cost, sessions, average burn
- Daily usage + burn/projection charts
- Model mix + searchable recent sessions
- Forecasts / simple recommendations
- CSV / JSON export
- In-app alerts + **Windows notifications**
- Currency from locale or user choice (INR, USD, EUR, …)
- Privacy: **never** stores prompts or responses

### Explicitly later

- Multi-machine sync
- Mobile app
- Auto-update / code signing polish
- Extra providers beyond the three above

---

## How it works (simple)

```text
You already logged into Grok Build / Codex / Claude Code
                    │
                    ▼
         Auth files on your PC
         (e.g. .grok\auth.json)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  Read "connected?"      Call usage/billing API
        │                       │
        └───────────┬───────────┘
                    ▼
         Dashboard quota card
         + local session list
```

---

## Worked example — real demo run (2026-07-28)

These numbers came from running the project **demo files** on a Windows machine that already had **Grok Build** and **Codex** logged in (Claude Code was not installed). Full engineering mapping: [`PLAN.md` §5.0](./PLAN.md#50-worked-example--real-demo-run-2026-07-28).

### Scorecard

| Provider | Connected | Live API | Plan (this user) | Sessions |
|----------|-----------|----------|------------------|----------|
| **Grok** | Yes | Billing **200** | Not in body → Unknown / Settings | 88 indexed, 2 active |
| **Codex** | Yes | Usage **200** | **`plus` (detected)** | Auth present |
| **Claude** | No | — | — | No `~/.claude` |

### Grok — from the demo file

**What happened**

1. Read `%USERPROFILE%\.grok\auth.json` → `connected: True`, `auth_mode: oidc`.  
2. Listed local sessions (`cwd=Dashboard`, `session_docs` count 88 — **ignore `content` column**).  
3. Called live APIs with the CLI Bearer token:

| Request | Status | Meaning |
|---------|--------|---------|
| `GET …/cli-chat-proxy.grok.com/v1/user` | 200 | Identity OK |
| `GET …/cli-chat-proxy.grok.com/v1/billing?format=credits` | **200** | **Subscription usage** |
| `GET https://api.x.ai/v1/models` | 200 | Token works; not for pool % |
| `GET …/v1/users/{id}/billing` | 404 | Do not use |

**Billing fields used by the app**

```text
creditUsagePercent:              33.0     →  used 33% · remaining ~67%
currentPeriod.type:              WEEKLY
currentPeriod.start → end:       2026-07-21 → 2026-07-28
productUsage.GrokBuild:          18%
productUsage.GrokChat:           15%
onDemandUsed / prepaidBalance:   0
```

**How the quota card should look**

```text
┌─ Grok Build ─────────────────────────┐
│  AUTH LIVE                           │
│  67% remaining                       │
│  ████████░░░░░░░░  33% used          │
│  Weekly · Build 18% · Chat 15%       │
│  Plan: Unknown (optional Settings)   │
└──────────────────────────────────────┘
```

### Codex — from the demo file

**What happened**

1. Read `%USERPROFILE%\.codex\auth.json` → `tokens.access_token` + `account_id` (no API key; ChatGPT login path).  
2. Called:

| Request | Status | Meaning |
|---------|--------|---------|
| `GET …/chatgpt.com/backend-api/wham/usage` | **200** | Plan + rate window |
| `GET …/wham/rate-limit-reset-credits` | 200 | Optional reset credits |

**Usage fields used by the app**

```text
plan_type:                                      "plus"   → plan detected for THIS user
rate_limit.primary_window.used_percent:         0        → 100% remaining
rate_limit.primary_window.limit_window_seconds: 604800   → 7-day (weekly) window
rate_limit.limit_reached:                       false
rate_limit_reset_credits:                       available
```

**How the quota card should look**

```text
┌─ Codex CLI ──────────────────────────┐
│  AUTH LIVE · plan: plus (detected)   │
│  100% remaining                      │
│  ░░░░░░░░░░░░░░░░  0% used           │
│  Weekly window · reset credits OK    │
└──────────────────────────────────────┘
```

Another machine may show `plan_type: "pro"` — that is expected (per-user plans).

### Claude — same demo script

```text
~/.claude exists: False
→ Not connected until Claude Code is installed and logged in
```

```text
┌─ Claude Code ────────────────────────┐
│  Not connected                       │
│  Install CLI + login, then refresh   │
└──────────────────────────────────────┘
```

### All three together (this run)

```text
┌─ Grok ─────────────┐ ┌─ Codex ────────────┐ ┌─ Claude ──────────┐
│ LIVE · 67% left    │ │ LIVE · 100% left   │ │ Not connected     │
│ Weekly · 33% used  │ │ Plan: plus         │ │                    │
│ Build 18 · Chat 15 │ │ Weekly · 0% used   │ │                    │
└────────────────────┘ └────────────────────┘ └────────────────────┘
```

### What this proves for the product

1. **Grok + Codex live quota work** without Platform Admin API keys.  
2. **Plans are per-user** (Codex returned `plus` for this account).  
3. UI must support **mixed state** (two live, one disconnected).  
4. Production code must **strip emails/tokens** from logs (usage JSON can include email).  
5. Re-run the demo files anytime to refresh sample numbers after quota burn.

---

## Honesty labels (important)

| Badge | Meaning |
|--------|---------|
| **AUTH LIVE** | Connected account + real remaining/used from a usage API |
| **LOCAL ESTIMATE** | We have sessions/burn but no official remaining figure |
| **Not connected** | No local CLI auth found — open the tool and sign in |

The app must **never** show a made-up percentage as “live.”

---

## Repository layout

```text
Dashboard/
├── README.md                          ← you are here
├── PLAN.md                            ← full plan (architecture, phases, IPC, …)
├── demo files                         ← research: live auth + usage checks
├── ai-usage-dashboard-prototype/      ← UI/UX reference (sample data)
│   ├── index.html
│   └── README.md
└── app/                               ← Electron product (create in Phase 0)
```

---

## Prerequisites

### For research demos (today)

- Windows 10/11  
- Python 3.10+  
- Logged into tools you care about:
  - **Grok Build** (creates `~/.grok/auth.json`)
  - **Codex CLI** (creates `~/.codex/auth.json`)
  - **Claude Code** (optional; creates `~/.claude\…` after login)

### For the Electron app (Phase 0+)

- **Node.js 20+**  
- **npm** (or pnpm if the team standardizes later)  
- **Git**  
- Windows: **Visual Studio Build Tools** (for `better-sqlite3` native module)  
- Same CLI logins as above for live data  

---

## Quick start — research demos

These scripts prove live data without the full app. They **redact** tokens in output; still treat your machine as trusted.

```powershell
cd "C:\Projects\Grok Build\Dashboard"
# Run the project demo files with Python (see files at repo root)
```

### What success looks like

See the [worked example](#worked-example--real-demo-run-2026-07-28) for a full annotated run. Short form:

**Grok**

```text
connected: True
GET .../billing?format=credits  → 200
example: creditUsagePercent 33 · GrokBuild 18 · GrokChat 15 · weekly period
```

**Codex**

```text
access_token_present: True
GET .../wham/usage  → 200
example: plan_type "plus" · used_percent 0 · limit_window_seconds 604800
```

**Claude** (if not installed)

```text
~/.claude exists: False
→ install Claude Code and login, then re-run the demo file
```

---

## Quick start — UX prototype

No install required:

1. Open `ai-usage-dashboard-prototype/index.html` in a modern browser.  
2. Explore cards, charts, filters, export (all **sample** data).  

This is the **feature checklist** for MVP-D, not production data.

---

## Quick start — Electron app (after Phase 0)

When `app/` exists (see plan):

```powershell
cd app
npm install
npm run dev      # Electron + Vite HMR
npm run build
npm run dist     # Windows installer
npm test
```

Details and scripts will live in `app/README.md` once scaffolded.

---

## Architecture (one picture)

```text
┌─────────────────────────────────────┐
│  React UI (renderer)                │
│  quotas · charts · sessions · settings
└─────────────────▲───────────────────┘
                  │ secure IPC
┌─────────────────┴───────────────────┐
│  Electron main (TypeScript)         │
│  SQLite · collectors · alerts       │
│  tokens never leave this process    │
└─────────┬───────────┬───────────────┘
          │           │
   ~/.grok      ~/.codex     ~/.claude
   + billing    + wham/usage + usage API
```

Data directory (planned):

```text
%APPDATA%\ai-usage-dashboard\
  usage.db
  config.json
  logs\app.log
```

---

## Collaboration

Two-person friendly split (see PLAN for full rules):

| Stream | Owns |
|--------|------|
| **A — Platform** | Electron main, SQLite, collectors, IPC, packaging |
| **B — Product UI** | React dashboard, charts, settings, exports |

### Workflow

1. Agree on [`PLAN.md`](./PLAN.md) (acceptance table at bottom).  
2. Pair on **Phase 0** scaffold.  
3. Freeze IPC types early → parallel work.  
4. Small PRs; `main` always runnable.  
5. Prefer **Grok → Codex → Claude** for adapter implementation order.

### Communication tips

- Demo live cards weekly with real CLIs.  
- If a usage API breaks, ship **estimate** + fix mapper — don’t block the whole app.  
- Never commit `auth.json`, tokens, or unredacted API dumps.

---

## Implementation phases (summary)

| Phase | Goal |
|-------|------|
| **0** | Electron + React + SQLite shell |
| **1** | Schema, IPC, UI shell (seed data OK) |
| **2** | Real collectors: Grok, Codex, Claude |
| **3** | Charts, projections, export, pricing |
| **4** | Alerts, Windows toasts, installer |
| **5+** | Multi-machine, tray, more providers |

Full checklists: [`PLAN.md` §17](./PLAN.md#17-phased-delivery).

---

## Security & privacy (read this)

- **Do not** store prompts or agent transcripts.  
- **Do not** put OAuth tokens in the UI, exports, or git.  
- Tokens stay in the **main process**; renderer gets **snapshots** only.  
- Prefer project **folder names**, not full absolute paths.  
- Usage/billing endpoints used by CLIs are **best-effort** and can change — treat as integration risk, not a public stable SDK.

---

## Recommendations for implementers

1. **Start with Grok** — end-to-end live path already proven (demo file).  
2. **Then Codex** — same confidence (demo file).  
3. **Claude after login** on at least one machine.  
4. Pure functions for API → snapshot mappers + **fixture tests**.  
5. Poll quotas every **30–60s** (slower when minimized).  
6. On API failure: keep last good snapshot + show “stale” time.  
7. Hard-code content storage **off** — no settings toggle that enables prompt retention in v1.  
8. Use **zod** on all IPC and external JSON.  
9. Document VS Build Tools for Windows natives.  
10. Keep the prototype open beside the UI work as a checklist, not a pixel lock.

More detail: [`PLAN.md` §21 Implementation recommendations](./PLAN.md#21-implementation-recommendations).

---

## Tech stack (planned)

| Piece | Choice |
|-------|--------|
| Desktop | Electron |
| Language | TypeScript |
| UI | React + Vite |
| DB | SQLite (`better-sqlite3`) |
| Package | electron-builder (Windows NSIS) |

**Not using for v1:** Tauri/Rust, React Native, required browser-only localhost UI as the product.

---

## FAQ

### Do I need API keys from OpenAI / Anthropic / xAI consoles?

**Not for subscription quota.** The app uses **CLI logins** you already have. Optional later: separate section for Platform API admin spend (different product).

### Is the billing/usage HTTP official forever?

Grok CLI proxy and ChatGPT `wham` surfaces work today and match how other local tools integrate, but they can change. The plan requires **estimate fallback** and mapper tests.

### Can my collaborator develop without SuperGrok?

Yes for UI (seed data). For live Grok cards they need a working Grok Build login on their account (whatever tier they have). Codex/Claude plans come from **their** account (`plan_type` / detected tier), not from this repo’s defaults.

### Where is the full design?

**[`PLAN.md`](./PLAN.md)** — complete plan: data model, IPC, phases, risks, acceptance table.

---

## Contributing (internal)

1. Read `PLAN.md` + this README.  
2. Run demos for providers you own.  
3. Work on a feature branch from `main`.  
4. Keep PRs small; include manual test notes.  
5. No secrets in commits.

---

## License

TBD (set when you open or share the project).

---

## Document map

| Doc | Purpose |
|-----|---------|
| [README.md](./README.md) | Overview, setup, demos, collab intro |
| [PLAN.md](./PLAN.md) | Full product + engineering plan |
| [ai-usage-dashboard-prototype/README.md](./ai-usage-dashboard-prototype/README.md) | Prototype notes |
| Demo files (project root) | Executable research proofs |

---

*Built for local developer workflows. Private by default.*
