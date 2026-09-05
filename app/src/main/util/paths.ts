import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'

const APP_DIR_NAME = 'ai-usage-dashboard'

/** App data: %APPDATA%\ai-usage-dashboard\ on Windows */
export function getAppDataDir(): string {
  return join(app.getPath('appData'), APP_DIR_NAME)
}

export function getDbPath(): string {
  return join(getAppDataDir(), 'usage.db')
}

export function getConfigPath(): string {
  return join(getAppDataDir(), 'config.json')
}

export function getLogsDir(): string {
  return join(getAppDataDir(), 'logs')
}

export function getLogFilePath(): string {
  return join(getLogsDir(), 'app.log')
}

/** CLI home dirs — override via env when set */
export function getGrokHome(): string {
  return process.env.GROK_HOME || join(homedir(), '.grok')
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

export function getClaudeHome(): string {
  return process.env.CLAUDE_HOME || join(homedir(), '.claude')
}

/** OpenCode keeps its SQLite store under the XDG data dir on every platform. */
export function getOpenCodeHome(): string {
  return (
    process.env.OPENCODE_HOME ||
    join(homedir(), '.local', 'share', 'opencode')
  )
}
