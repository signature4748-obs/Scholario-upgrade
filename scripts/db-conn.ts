/**
 * scripts/db-conn.ts — shared DB bootstrap for the Phase 8A SRE ops
 * scripts (db-backup / db-restore-verify / db-perf-probe).
 *
 * RULES (mission §30 / §56 operational hygiene):
 *   · The connection string is read from the .env FILE at runtime — the
 *     shell may carry a stale injected DATABASE_URL, so process.env is
 *     NEVER trusted (a differing shell value is ignored with a note).
 *   · Credential values are never printed or logged.
 *   · Production identity is refused up front (DATABASE_ENV=production →
 *     refuse; same semantics as src/lib/env, kept local + file-based).
 *   · One pg Client per script process = ONE Supavisor session, so ops
 *     scripts stay inside the 15-session budget with headroom.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

export interface EnvFile {
  [key: string]: string
}

const ENV_PATH = resolve(process.cwd(), '.env')

/** Parse the repo .env (KEY=VALUE lines; quotes stripped; no interpolation). */
export function loadEnvFile(path: string = ENV_PATH): EnvFile {
  if (!existsSync(path)) {
    throw new Error(`[db-conn] ${path} not found — run ops scripts from the repo root`)
  }
  const out: EnvFile = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}

/** DATABASE_URL from the .env FILE (never from the shell environment). */
export function appDatabaseUrl(env: EnvFile = loadEnvFile()): string {
  const url = env['DATABASE_URL']
  if (!url) throw new Error('[db-conn] DATABASE_URL missing in .env')
  const injected = process.env.DATABASE_URL
  if (injected && injected !== url) {
    console.warn(
      '[db-conn] NOTE: the shell carries a different DATABASE_URL — IGNORED; the .env FILE is authoritative (value not printed).',
    )
  }
  return url
}

/** Refuse to run ops scripts against a declared-production database. */
export function assertNotProductionDatabase(env: EnvFile = loadEnvFile()): void {
  const declared = (env['DATABASE_ENV'] ?? '').trim().toLowerCase()
  if (declared === 'production') {
    throw new Error(
      '[db-conn] REFUSED: .env declares DATABASE_ENV=production — backup/restore/probe scripts never touch a production database.',
    )
  }
}

/** .env DATABASE_URL with a bounded connection_limit (Prisma datasource). */
export function prismaDatasourceUrl(connectionLimit = 2, env: EnvFile = loadEnvFile()): string {
  const url = appDatabaseUrl(env)
  return url.includes('connection_limit')
    ? url.replace(/connection_limit=\d+/, `connection_limit=${connectionLimit}`)
    : url + (url.includes('?') ? '&' : '?') + `connection_limit=${connectionLimit}`
}

/** Typed wrapper over the JS-inferred pg client (results are plain rows). */
export interface QResult {
  rows: Record<string, unknown>[]
  rowCount: number | null
}

/** Open the single ops-script connection (one Supavisor session). */
export async function connectOpsClient(env?: EnvFile): Promise<{ client: Client; query: (sql: string, params?: unknown[]) => Promise<QResult> }> {
  const url = appDatabaseUrl(env ?? loadEnvFile())
  const client = new Client({ connectionString: url })
  await client.connect()
  const query = (sql: string, params?: unknown[]): Promise<QResult> =>
    client.query(sql, params) as unknown as Promise<QResult>
  return { client, query }
}

/** UTC timestamp slug for schema / file names (20261001t203045). */
export function utcSlug(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `t${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  )
}

/**
 * FK-respecting table order for a schema (parents first) — Kahn's
 * algorithm with alphabetical tie-breaks, self-references ignored.
 * Returns { order, hasCycle } — a cycle leaves those tables out of order.
 */
export async function fkOrderedTables(
  query: (sql: string, params?: unknown[]) => Promise<QResult>,
  schema: string,
): Promise<{ order: string[]; cyclic: string[] }> {
  const { rows } = await query(
    `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = $1`,
    [schema],
  )
  const deps = new Map<string, Set<string>>()
  const tables = new Set<string>()
  for (const r of rows) {
    // regclass::text renders as schema-qualified when the schema is not
    // first in search_path, and QUOTES mixed-case identifiers — normalize
    // both away to the bare table name (e.g. scratch."ActivityLog" → ActivityLog).
    const bare = (v: unknown) => String(v).split('.').pop()?.replace(/"/g, '') ?? ''
    const tbl = bare(r.tbl)
    const ref = bare(r.ref)
    if (tbl === ref) continue // self-reference: row-level ordering, not table-level
    if (!deps.has(tbl)) deps.set(tbl, new Set())
    deps.get(tbl)?.add(ref)
  }
  const { rows: tableRows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [schema],
  )
  for (const r of tableRows) tables.add(String(r.table_name))
  const remaining = new Set(tables)
  const order: string[] = []
  while (remaining.size) {
    const ready = [...remaining]
      .filter((t) => ![...(deps.get(t) ?? [])].some((d) => remaining.has(d)))
      .sort()
    if (!ready.length) break // cycle
    for (const t of ready) {
      order.push(t)
      remaining.delete(t)
    }
  }
  return { order, cyclic: [...remaining].sort() }
}
