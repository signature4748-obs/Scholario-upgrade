/**
 * env-resolution — the postgres-db service's DATABASE_URL candidate
 * resolution, extracted for unit testing.
 *
 * 2026-10-16 (post-reset hardening): the service previously read ONLY
 * /home/z/my-project/.env — which the sandbox boot script clobbers with the
 * SQLite template on every container reset, killing the service at boot
 * ("FATAL: .env DATABASE_URL is not a postgresql:// URL"). Resolution now
 * prefers the OWNING WORKTREE's .env (the same single source of truth the
 * dev app uses) and falls back to the main project root.
 */
import { readFileSync } from 'fs'

/** Return the first postgresql:// DATABASE_URL found among the candidate
 *  .env paths (in order), or null when none qualifies. Values with quotes
 *  are tolerated; sqlite/file URLs are skipped (the documented boot-clobber
 *  shape). Never throws — missing/unreadable candidates are skipped. */
export function firstPostgresUrlFrom(paths: string[]): string | null {
  for (const p of paths) {
    try {
      const m = readFileSync(p, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)
      const v = m?.[1]?.replace(/^["']|["']$/g, '')
      if (v && v.startsWith('postgresql://')) return v
    } catch {
      /* try the next candidate */
    }
  }
  return null
}
