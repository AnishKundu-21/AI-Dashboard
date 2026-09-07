# Dashboard workspace overhaul

## Delivered

- Graphite and daylight themes, shared spacing/surface tokens, compact density,
  redesigned navigation, and a keyboard command palette (`Ctrl/Cmd K`).
- Overview allowance strip with live/stale/unavailable labels, per-provider
  detail dialogs, metrics, a primary usage chart, token composition, model and
  project rankings, daily activity, and a five-session preview.
- Usage charts support trend, stacked bars, percentage shares, data tables,
  expansion, legend filtering, keyboard exploration, and session drill-down.
- Horizontal provider/model comparison bars replace category-to-category lines.
- Session detail drawers preserve context, show accounting fields and distinguish
  API-equivalent estimates from provider-reported charges.
- Provider/preset date filters and appearance persist locally. Custom date ranges
  carry through navigation and drill-downs. Exports retain date/day/model/search
  scope. Failed refreshes preserve the last loaded dashboard with an error notice.
- Finite CSS/SVG motion, reduced-motion support, bucket-snapped tooltip updates,
  bounded preview rows, and no added dependencies.

Collectors, authentication, storage schema, and pricing logic were not modified
by this overhaul. Existing uncommitted collector/query/time changes were preserved.

## Data and interaction details

Allowance reset windows are independent of analytics dates. Project rankings are
explicitly scoped to the loaded sessions, not presented as complete project totals.
Activity shows up to 366 calendar days between collected dates, with distinct
disabled cells for missing data. Reasoning remains a subset of output; the visual
token split no longer double-counts it. Chart control points stay within each
segment's observed vertical extent.

The review identified and corrected custom-date drill-down scope, stacked-bar
hit testing, and missing calendar-date gaps. Standards review rechecked all three.

## Validation

The existing 236-test suite, TypeScript checks, and Electron production build
passed. An existing server-render test emits the pre-existing `useLayoutEffect`
warning; there were no test failures.

`app/scripts/ui-smoke.cjs` is an opt-in browser acceptance harness against the
production renderer with synthetic IPC data. It does not read credentials or
open the usage database. It exercises all six views, chart modes and expansion,
allowance dialogs, quick actions, session drawers, custom-range drill-downs,
export scope, persistent density, reduced motion, error preservation, empty
states, light/dark themes, and widths of 1440, 960, 620, and 390 CSS pixels.

Run after `npm run build` from `app/`, with Playwright available in Node's module
resolution or `PLAYWRIGHT_MODULE` set to its installed package directory:

```powershell
node scripts/ui-smoke.cjs after
```

Uses installed Microsoft Edge in headless mode. Screenshots and reports are saved
under ignored `app/out/ui-qa/`. The real Electron app was also relaunched and its
Overview, Analytics, and session detail drawer checked with actual local data;
no renderer errors were observed.

## Performance scope

The benchmark uses the same synthetic dataset and browser on this machine. A
reconstructed pre-overhaul renderer had a 137 ms median over five warm loads;
the final overhaul had a 168 ms median (31 ms additional, including the new
charts and session preview). Settled one-second renderer task duration was
0.63 ms before and 0.72 ms after. JS heap grew from approximately 3.5 MB to
5.0 MB with the richer Overview. These are local renderer measurements,
not a guarantee for every machine or a measurement of collector startup.

The final benchmark output is in `app/out/ui-qa/bench-after-report.json`. The
collector processes are unchanged, and there are no continuous decorative
animations. Tables retain bounded loading; large histories retain existing
aggregation. No chart or animation framework was added.
