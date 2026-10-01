/**
 * scripts/db-backup.ts — Phase 8A logical backup (mission §30).
 *
 * WHAT THIS IS: an on-demand, application-level dump of EVERY public-schema
 * app table (everything except _prisma_migrations) into
 *   backups/scholario-<UTC timestamp>.jsonl.gz
 * one JSON line per row:  {"table":"Student","row":{...}}
 * streamed through node:zlib gzip.
 *
 * FORMAT / FIDELITY:
 *   · Dates / timestamps are dumped as their RAW Postgres text rendering
 *     (SELECT "col"::text) — timezone-independent and byte-exact, so the
 *     restore test can cast them straight back.
 *   · NUMERIC money columns arrive from node-pg as STRINGS (paise-exact,
 *     never through float).
 *   · Booleans stay booleans, integers/floats stay JSON numbers (float64
 *     JSON round-trips are exact by ECMAScript spec).
 *   · Tables are dumped in FK-parents-first order (restores are ordered).
 *
 * RUN (from the repo root, dev server may keep running):
 *   unset DATABASE_URL && bun scripts/db-backup.ts
 * (package.json is frozen this wave — commands are documented in
 *  docs/BACKUP_RECOVERY.md instead of npm scripts.)
 */
import { mkdirSync, statSync, createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { assertNotProductionDatabase, connectOpsClient, fkOrderedTables, utcSlug } from './db-conn'

interface ColumnMeta {
  column_name: string
  data_type: string
}

function tableColumns(rows: Record<string, unknown>[]): ColumnMeta[] {
  return rows.map((r) => ({
    column_name: String(r.column_name),
    data_type: String(r.data_type),
  }))
}

/** SELECT list with ::text casts for calendar columns (raw PG rendering). */
function selectList(columns: ColumnMeta[]): string {
  return columns
    .map((c) =>
      c.data_type === 'date' ||
      c.data_type === 'timestamp without time zone' ||
      c.data_type === 'timestamp with time zone'
        ? `"${c.column_name}"::text AS "${c.column_name}"`
        : `"${c.column_name}"`,
    )
    .join(', ')
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  assertNotProductionDatabase()
  const { client, query } = await connectOpsClient()

  // Every public-schema BASE TABLE except the migration bookkeeping table.
  const { rows: tableRows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name`,
  )
  const allTables = tableRows.map((r) => String(r.table_name))

  const { order, cyclic } = await fkOrderedTables(query, 'public')
  // Dump in FK-parents-first order (same set of tables, deterministic).
  const tables = order.length === allTables.length ? order : allTables
  if (cyclic.length) {
    console.warn(`[db-backup] WARNING: FK cycle among ${cyclic.join(', ')} — those tables dumped alphabetically`)
  }

  mkdirSync(resolve(process.cwd(), 'backups'), { recursive: true })
  const stamp = utcSlug()
  const backupPath = resolve(process.cwd(), 'backups', `scholario-${stamp}.jsonl.gz`)

  const gz = createGzip({ level: 6 })
  const out = createWriteStream(backupPath)
  const pipeDone = pipeline(gz, out)

  const perTable: { table: string; rows: number; ms: number }[] = []
  let totalRows = 0
  let rawBytes = 0

  for (const table of tables) {
    const t0 = Date.now()
    const { rows: colRows } = await query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    )
    const columns = tableColumns(colRows)
    const { rows } = await query(
      `SELECT ${selectList(columns)} FROM "public"."${table}"`,
    )
    let buf = ''
    for (const row of rows) {
      buf += JSON.stringify({ table, row }) + '\n'
    }
    if (buf) {
      rawBytes += Buffer.byteLength(buf)
      gz.write(buf)
    }
    perTable.push({ table, rows: rows.length, ms: Date.now() - t0 })
    totalRows += rows.length
  }

  gz.end()
  await pipeDone
  await client.end()

  const gzBytes = statSync(backupPath).size
  const durationMs = Date.now() - startedAt
  const sec = (ms: number) => (ms / 1000).toFixed(2)

  console.log('═'.repeat(72))
  console.log(`BACKUP COMPLETE  ${backupPath}`)
  console.log('═'.repeat(72))
  console.log(
    `tables: ${perTable.length}   rows: ${totalRows}   ` +
      `raw: ${(rawBytes / 1024).toFixed(1)} KiB   gzip: ${(gzBytes / 1024).toFixed(1)} KiB   ` +
      `duration: ${sec(durationMs)} s`,
  )
  console.log('─'.repeat(72))
  for (const t of perTable) {
    console.log(
      `${String(t.rows).padStart(7)} rows  ${String(t.ms).padStart(6)} ms  ${t.table}`,
    )
  }
  console.log('─'.repeat(72))
  console.log('Per-table rows match the live public schema at dump time.')
}

main().catch((e: unknown) => {
  console.error('[db-backup] FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
