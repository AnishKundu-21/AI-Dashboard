# Analytics delivery roadmap

## First release

1. [x] Timezone-correct selected-period and previous-period comparison.
2. [x] Custom date ranges plus hourly, daily, weekly, and monthly usage series.
3. [ ] Local saved views, current-filter exports, and chart-image downloads.
4. Opt-in local attribution filters for repository basename, branch, and device
   label, with explicit coverage.
5. Context-window, cache, call/session, model-switching, pricing, and observed
   telemetry coverage.

## Deferred to multi-machine sync

- Shareable reports and report links.
- Cross-device report delivery and scheduled shared reporting.

Latency, time-to-first-token, retries, failures, cancellations, and rate-limit
metrics will appear only after a provider collector can observe them. Until then
the dashboard will say that they are not observed by that provider/version.
