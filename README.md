# AI Usage Dashboard

**A local-first desktop dashboard for coding-agent usage and subscription allowances.** See token activity, model mix, session history, estimated API-equivalent cost, and available quota in one place.

Built with Electron, React, TypeScript, and SQLite. Windows is the primary development and packaging target.

## What it shows

- **Overview:** usage across providers, allowance cards, recent sessions, and cost by provider.
- **Analytics:** token classes, model calls, cache activity, provider and model comparisons, and trends over selectable time ranges.
- **Forecast:** burn and runway for supported weekly or monthly subscription windows. Forecasts are estimates based on observed usage.
- **Sessions:** searchable, sortable local session metadata with provider and model filters.
- **Exports:** CSV or JSON for the selected provider and time range.
- **Settings and diagnostics:** provider selection, currency and locale, price overrides, notifications, collector health, and manual rescans.

The dashboard starts with empty states when no supported tools have local data. It does not insert sample activity into the production database.

## Supported providers

| Provider | Local usage | Subscription allowance |
| --- | --- | --- |
| Grok Build | Local sessions | Available when its authenticated billing source responds |
| Codex CLI | Local sessions | Available through `codex app-server`, with a fallback for older CLIs |
| Claude Code | Local sessions | Available when authenticated usage data can be read |
| Cursor CLI | Local agent transcripts | Unavailable from the local transcript source |
| OpenCode | Local SQLite usage data | Not applicable to its per-model, bring-your-own-key billing |

Each provider is optional. Enable the tools you use during onboarding or in Settings. A missing login, unsupported allowance, failed refresh, and stale data are shown as distinct states; the app does not invent a remaining percentage.

## Get started

### Requirements

- Windows 10 or 11 for the documented desktop build and installer workflow.
- Node.js 20 or later and npm.
- Visual Studio Build Tools with the C++ workload if `better-sqlite3` needs to compile on Windows.
- At least one supported coding agent with local usage data. Sign in to the relevant CLI for live subscription allowance where supported.

From the repository root:

```powershell
cd app
npm ci
npm run dev
```

The app reads supported tools' existing local data; it does not require you to paste credentials into the dashboard. If a provider is unavailable, its view explains the connection or collection state.

To build a local Windows installer:

```powershell
cd app
npm run dist
```

The installer is written to `app/release/`. This command creates an unsigned local build. Production signing and an HTTPS update feed require separate release configuration; see [the app documentation](./app/README.md#release-configuration).

## How it works

```text
CLI files and local usage stores       Authenticated quota sources
               │                                  │
               └──────────┬───────────────────────┘
                          ▼
                Electron main process
             collectors · pricing · SQLite
                          │
                    validated IPC
                          ▼
                    React dashboard
```

Collectors normalize usage into per-call events so sessions that cross midnight or switch models can be counted on the correct day and against the correct model. The token model separates uncached input, cache reads, cache writes, and output; reasoning tokens are included within output rather than added twice.

API-equivalent cost uses per-model rates and marks unknown prices as **unpriced**. Currency conversion uses fetched reference rates and falls back to USD when no conversion rate is available. These cost figures are estimates of equivalent API usage, not necessarily charges on a subscription bill.

Application data lives in `%APPDATA%\ai-usage-dashboard\` on Windows, including `usage.db`, `config.json`, and `logs\app.log`.

## Privacy and data boundaries

- The app stores usage counts and session metadata, not prompts or responses.
- Credentials stay in the Electron main process. The renderer receives validated, sanitized data through the preload API.
- Project labels use directory basenames rather than full paths.
- Live quota checks, pricing updates, and currency rates use network sources when enabled. Provider quota transports can change independently of this project.

Review exported files before sharing them: exports contain usage and session metadata.

## Development

All application code and npm commands are under [`app/`](./app/). From that directory:

```powershell
npm test
npm run typecheck
npm run build
```

The Electron main process owns collection, SQLite, pricing, and IPC; the React renderer owns presentation and interaction. New providers are registered through a provider manifest and collector adapter. See [`app/README.md`](./app/README.md) for implementation details and [`HANDOVER.md`](./HANDOVER.md) for the current engineering state and collaboration notes.

## Project status

This is an actively developed desktop application. Local usage and quota availability depend on installed tools, account type, and provider interfaces. Windows packaging is configured; signed releases and automatic updates require external release infrastructure.

The package is currently marked `UNLICENSED`. No open-source license has been granted.
