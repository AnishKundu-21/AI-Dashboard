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
```

**Note:** `better-sqlite3` is rebuilt for the **Electron** ABI (`rebuild:native`), not for system Node. That is expected.

## Current phase

**Phase 3:** analytics parity (prototype features minus multi-machine sync).

- Live collectors (Grok / Codex / Claude discovery) from Phase 2
- Overview with cost-by-provider + avg daily tokens
- Daily chart legends · burn history from snapshots + 3-day projection
- Model mix donut · session search · richer CSV/JSON export (save dialog)
- Forecasts with days-to-empty + recommendations
- Settings: currency (FX), locale, notify, network quota, per-provider plan auto/manual
- Pricing rate card `2026-07-v1`
- Empty databases stay empty: production never inserts sample sessions or fake live quota
- Real-time CLI filesystem watchers push local changes in under a second; remote quota falls back to 15-second focused polling

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
- No prompt/response storage
- Project names are basenames only
