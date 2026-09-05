/** SQL migrations applied in order. Keep additive. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  used_pct REAL,
  remaining_pct REAL,
  reset_at TEXT,
  window_label TEXT,
  plan_label TEXT,
  plan_source TEXT,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  auth_connected INTEGER NOT NULL DEFAULT 0,
  raw_summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_quota_provider_captured
  ON quota_snapshots(provider, captured_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  project TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in REAL,
  tokens_out REAL,
  tokens_total REAL,
  api_equiv_usd REAL,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown',
  started_at TEXT,
  ended_at TEXT,
  source TEXT NOT NULL,
  machine_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started
  ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider
  ON sessions(provider);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_total REAL NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  api_equiv_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  provider TEXT,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dismissed_at TEXT,
  notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_created
  ON alerts(created_at DESC);
`
  },
  {
    version: 2,
    sql: `
ALTER TABLE quota_snapshots ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quota_snapshots ADD COLUMN live_captured_at TEXT;

-- Phase 1 sample rows must never survive into a real user database.
UPDATE settings
SET value = json_set(
  value,
  '$.plans.codex',
  json('{"mode":"auto","source":"unknown"}')
)
WHERE key = 'app'
  AND json_valid(value)
  AND EXISTS (
    SELECT 1 FROM alerts
    WHERE id = 'alert-seed-1' OR rule_id = 'seed-notice'
  )
  AND json_extract(value, '$.plans.codex.detected') = 'plus';

DELETE FROM sessions
WHERE source = 'seed' OR machine_id = 'seed-local';

DELETE FROM quota_snapshots
WHERE source LIKE 'seed%';

DELETE FROM alerts
WHERE id = 'alert-seed-1' OR rule_id = 'seed-notice';

DELETE FROM usage_daily;
INSERT INTO usage_daily (day, provider, tokens_total, session_count, api_equiv_usd)
SELECT
  substr(COALESCE(started_at, created_at), 1, 10),
  provider,
  COALESCE(SUM(tokens_total), 0),
  COUNT(*),
  COALESCE(SUM(api_equiv_usd), 0)
FROM sessions
WHERE COALESCE(started_at, created_at) IS NOT NULL
GROUP BY substr(COALESCE(started_at, created_at), 1, 10), provider;
`
  },
  {
    version: 3,
    sql: `
ALTER TABLE sessions ADD COLUMN tokens_cached REAL;
ALTER TABLE sessions ADD COLUMN tokens_reasoning REAL;
ALTER TABLE sessions ADD COLUMN model_calls INTEGER;
ALTER TABLE sessions ADD COLUMN provider_cost_usd REAL;
ALTER TABLE sessions ADD COLUMN api_duration_ms INTEGER;
`
  },
  {
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS collector_health (
  provider TEXT PRIMARY KEY,
  watcher_status TEXT NOT NULL DEFAULT 'polling',
  last_scan_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  sessions_seen INTEGER NOT NULL DEFAULT 0,
  last_duration_ms INTEGER
);
`
  },
  {
    version: 5,
    sql: `
DELETE FROM sessions
WHERE provider = 'grok' AND tokens_total IS NULL;

UPDATE sessions
SET model = 'Unknown'
WHERE provider = 'codex' AND lower(model) = 'codex-auto-review';

DELETE FROM usage_daily;
INSERT INTO usage_daily (day, provider, tokens_total, session_count, api_equiv_usd)
SELECT
  substr(COALESCE(started_at, created_at), 1, 10), provider,
  COALESCE(SUM(tokens_total), 0), COUNT(*), COALESCE(SUM(api_equiv_usd), 0)
FROM sessions
WHERE COALESCE(started_at, created_at) IS NOT NULL
GROUP BY substr(COALESCE(started_at, created_at), 1, 10), provider;
`
  },
  {
    version: 6,
    sql: `
ALTER TABLE sessions ADD COLUMN cache_savings_usd REAL;
ALTER TABLE sessions ADD COLUMN unpriced INTEGER NOT NULL DEFAULT 0;

-- Every stored token and cost figure predates the canonical token model and
-- the per-class rate table, and is wrong in ways that cannot be corrected in
-- place: Claude totals excluded cached tokens while Codex totals included
-- them, repeated per-content-block records were counted more than once, forked
-- Codex rollouts double counted their parent, and every cost came from a
-- single blended rate applied to the wrong token base.
--
-- Rows are cleared so the next scan rebuilds them from the transcripts, which
-- are the source of truth. Sessions whose transcripts have since been deleted
-- are lost with them; keeping known-wrong numbers would corrupt every
-- aggregate they appear in, which is worse than a shorter history.
DELETE FROM sessions;
DELETE FROM usage_daily;
`
  }
]
