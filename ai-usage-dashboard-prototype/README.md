# Local AI Usage Dashboard prototype

A self-contained front-end prototype for a local/self-hosted dashboard covering **Grok Build**, **Claude Code**, and **Codex CLI**.

## Open it

Open `index.html` directly in a modern browser. No install, web server, CDN, remote font, or network connection is required for the prototype UI.

## Included in this revision

- Live/estimated remaining-quota cards with explicit source and confidence labels
- API-equivalent cost in INR for subscription-plan comparison
- Provider and date-range filters
- Offline SVG charts for daily usage and quota burn projections
- Generated alerts and provider recommendations
- Searchable recent-session table
- Working CSV and JSON export of the current view
- Multi-machine modes:
  - Local only
  - Append-only folder watch, one JSONL file per machine
  - Shared SQLite with a **single writer only**
  - Optional self-hosted LAN/VPN sync relay
- Metadata-first privacy controls
- Responsive layout

## Important prototype limitations

All usage, quota, prices, resets, projections, plans, and authentication states are illustrative sample data. A production collector must use only provider-supported local logs, structured CLI output, response metadata, or official APIs. It should never infer an exact remaining quota when the provider does not expose one.

## Corrections made after reviewing the supplied dashboard

- Removed Tailwind, Chart.js, annotation-plugin, and Google Fonts CDNs, so the dashboard is genuinely offline-capable.
- Fixed JSON export design so it does not reference an undefined variable.
- Added RFC-style CSV escaping and UTF-8 BOM for spreadsheet compatibility.
- Removed reliance on the browser-global `event` object.
- Replaced unsafe multi-writer shared-SQLite guidance with append-only per-machine logs or a single-writer relay.
- Replaced hard-coded UI-only filters with a consistent current-view model used by cards, charts, sessions, and exports.
- Added clear separation between official live quota, local estimates, and projections.

## Production architecture

```text
Grok / Claude / Codex CLI
          │
          ▼
Provider adapters + metadata-only collector
          │
          ├── local SQLite (WAL)
          ├── append-only JSONL machine streams
          └── optional authenticated sync relay
          │
          ▼
Local web dashboard on 127.0.0.1
```

For a true full-stack build, the next layer is a small local service (Fastify/FastAPI), SQLite schema and migrations, provider adapters, filesystem watchers, and an authenticated quota connector for each supported provider.
