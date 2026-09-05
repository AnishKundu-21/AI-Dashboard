# Analytics context

## Terms

- **Analytics window**: the inclusive calendar-date range selected by the user in
  the configured usage timezone. Preset windows end on the current local date.
- **Previous period**: the immediately preceding calendar-date range with the
  same number of dates as the analytics window. Lifetime has no previous period.
- **Observed metric**: a value the collector actually read from a provider or a
  local transcript. A missing value is not treated as zero.
- **Coverage**: the number or proportion of calls and sessions for which an
  observed metric is available. Coverage accompanies partial data; it does not
  infer the missing values.
- **Local attribution**: opt-in, device-local metadata limited to repository
  basenames, branch names, and a user-editable device label. It never includes
  full paths, remote URLs, usernames, prompts, or source content.

## Boundaries

The renderer requests a comparison snapshot; the main-process analytics query
owns the timezone boundaries and period-comparison arithmetic for that snapshot.
Custom-range charts, exports, and saved views will adopt the same period input
as they are delivered, rather than duplicating boundary calculations.
