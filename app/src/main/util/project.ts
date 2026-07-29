import { basename } from 'path'

/**
 * Resolve a display project name from a cwd.
 * Prefer git root basename when available later; for now use folder name.
 * Never return full absolute paths.
 */
export function projectNameFromCwd(cwd: string | null | undefined): string {
  if (!cwd || !cwd.trim()) return 'unknown'
  const cleaned = cwd.replace(/[/\\]+$/, '')
  const name = basename(cleaned)
  return name || 'unknown'
}
