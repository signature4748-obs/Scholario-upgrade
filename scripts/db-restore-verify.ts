/**
 * scripts/db-restore-verify.ts — Phase 8A TESTED RESTORE (mission §30).
 *
 * THE RESTORE TEST (non-production environment = a throwaway schema
 * inside the integration database — public is never touched):
 *
 *   1. CREATE SCHEMA restore_verify_<ts>; SET search_path to it.
 *   2. Execute prisma/migrations/0_init/migration.sql — the table DDL uses
 *      unqualified quoted names, so every table/index lands in the SCRATCH
 *      schema, not public. (The one later-migrated app table,
 *      RateLimitBucket, gets its CREATE TABLE from
 *      00000000000003_rate_limit_backend so every backed-up table has a
 *      scratch target — that migration's RLS statement is skipped: this is
 *      a data test, not a policy test.)
 *   3. Load EVERY row from the backup JSONL into the scratch schema with
 *      batched parameterized multi-row INSERTs. Column lists are built
 *      from information_schema of the scratch schema; values are decoded
 *      per column type (boolean / numeric / date / timestamp JSON string
 *      handling). Tables are loaded in FK-parents-first order (derived
 *      from the scratch schema's own constraint graph).
 *   4. VERIFY: per-table row counts (backup vs restored), and the 3-way
 *      money parity on the restored Fee / Payment / FeeTransaction
 *      (Σ Payment(SUCCESS) == Σ FeeTransaction(SUCCESS) == Σ Fee.paid,
 *      exact NUMERIC ::text strings, also cross-checked against paise
 *      sums computed independently from the backup file).
 *   5. DROP the scratch schema (always — success or failure) and verify
 *      it is gone.
 *
 * Exit code is non-zero on ANY mismatch.
 *
 * RUN (from the repo root):
 *   unset DATABASE_URL && bun scripts/db-restore-verify.ts [backup.jsonl.gz]
 *   (no argument → the newest backups/scholario-*.jsonl.gz)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { assertNotProductionDatabase, connectOpsClient, fkOrderedTables, utcSlug } from './db-conn'

interface BackupRow {
  table: string
  row: Record<string, unknown>
}

interface ColumnMeta {
  column_name: string
  data_type: string
}

const failures: string[] = []

/**
 * Parse a NUMERIC string into integer paise. Plain-number math (NOT BigInt
 * literals — the Next build type-checker targets pre-ES2020 and rejects
 * `100n` literals even though the tsc lib allows them). Money here is
 * NUMERIC(<=14,2): 14 integer digits * 100 paise = 1.6e16 max, within
 * Number.MAX_SAFE_INTEGER for any real school ledger.
 */
function toPaise(value: string): number {
  const s = String(value).trim()
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const [intPart, fracPart = ''] = body.split('.')
  const paise = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2))
  return neg ? -paise : paise
}

/** Render integer paise as a NUMERIC(12,2)-style string. */
function fromPaise(p: number): string {
  const neg = p < 0
  const abs = neg ? -p : p
  const s = abs.toString().padStart(3, '0')
  const rendered = `${s.slice(0, -2)}.${s.slice(-2)}`
  return neg ? `-${rendered}` : rendered
}

/** JSON value → pg parameter, decoded per the scratch column type. */
function decodeValue(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null
  switch (dataType) {
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') return ['t', 'true', 'yes', '1'].includes(value.toLowerCase())
      return Boolean(value)
    case 'numeric':
      // never through float — keep the exact decimal text
      return typeof value === 'number' ? String(value) : String(value)
    case 'date':
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      if (typeof value === 'string') return value // raw PG text from the dump
      if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '')
      return new Date(value as number).toISOString()
    case 'integer':
    case 'smallint':
    case 'bigint':
      return typeof value === 'number' ? value : Number(value)
    case 'real':
    case 'double precision':
      return typeof value === 'number' ? value : Number(value)
    default:
      // text / varchar / anything else
      if (typeof value === 'object') return JSON.stringify(value)
      return value
  }
}

function resolveBackupPath(arg: string | undefined): string {
  if (arg) {
    const p = resolve(process.cwd(), arg)
    if (!existsSync(p)) throw new Error(`[restore-verify] backup file not found: ${arg}`)
    return p
  }
  const dir = resolve(process.cwd(), 'backups')
  const candidates = readdirSync(dir)
    .filter((f) => /^scholario-.*\.jsonl\.gz$/.test(f))
    .map((f) => ({ f, mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (!candidates.length) throw new Error('[restore-verify] no backups/scholario-*.jsonl.gz found — run scripts/db-backup.ts first')
  return resolve(dir, candidates[0].f)
}

/** argv: [backupFile?] [--into <schema>]?  (default target: throwaway scratch schema; `--into public` = disaster-restore mode into a FRESH, EMPTY public schema whose DDL came from prisma migrate deploy.) */
function parseArgs(argv: string[]): { backup?: string; into?: string } {
  const out: { backup?: string; into?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--into') {
      out.into = argv[i + 1]
      i++
    } else if (!argv[i].startsWith('--')) {
      out.backup = argv[i]
    }
  }
  return out
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  assertNotProductionDatabase()
  const args = parseArgs(process.argv.slice(2))
  const backupPath = resolveBackupPath(args.backup)
  const { client, query } = await connectOpsClient()

  // Default: TESTED-RESTORE mode — a throwaway scratch schema inside this
  // integration DB. `--into public`: disaster-restore mode (runbook) — the
  // target must be a FRESH database whose DDL came from `prisma migrate
  // deploy`; an emptiness interlock refuses to load over live data.
  const isPublicRestore = args.into === 'public'
  const target = isPublicRestore ? 'public' : `restore_verify_${utcSlug()}`
  let dropped = false

  try {
    // ── 1. read + parse the backup ───────────────────────────────────
    const jsonl = gunzipSync(readFileSync(backupPath)).toString('utf8')
    const rowsByTable = new Map<string, Record<string, unknown>[]>()
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line) as BackupRow
      const list = rowsByTable.get(rec.table) ?? []
      list.push(rec.row)
      rowsByTable.set(rec.table, list)
    }

    // Expected 3-way money parity, computed from the BACKUP FILE itself
    // (independent of the live DB — immune to post-backup drift).
    let feePaise = 0
    for (const r of rowsByTable.get('Fee') ?? []) feePaise += toPaise(String(r['paid'] ?? '0'))
    let payPaise = 0
    for (const r of rowsByTable.get('Payment') ?? []) {
      if (String(r['status']) === 'SUCCESS') payPaise += toPaise(String(r['amount'] ?? '0'))
    }
    let txnPaise = 0
    for (const r of rowsByTable.get('FeeTransaction') ?? []) {
      if (String(r['status']) === 'SUCCESS') txnPaise += toPaise(String(r['amount'] ?? '0'))
    }

    // ── 2. target schema + table DDL ─────────────────────────────
    if (isPublicRestore) {
      // Disaster-restore mode: DDL is owned by prisma migrate deploy — the
      // loader only verifies the shape, then an EMPTINESS interlock makes
      // double-restores impossible (primary keys would collide otherwise).
      for (const t of rowsByTable.keys()) {
        const { rows } = await query(`SELECT count(*)::int AS c FROM "public"."${t}"`)
        if (Number(rows[0]['c']) > 0) {
          throw new Error(
            `[restore-verify] --into public refused: table "${t}" already holds ${rows[0]['c']} row(s) — restore only into a FRESH database (see docs/BACKUP_RECOVERY.md runbook)`,
          )
        }
      }
    } else {
      // Self-heal first: sweep any ORPHANED scratch schema from a previous
      // crashed/killed run (current run's name is excluded).
      const { rows: orphans } = await query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'restore_verify_%' AND nspname <> $1`,
        [target],
      )
      for (const o of orphans) {
        const name = String(o.nspname)
        console.warn(`[restore-verify] sweeping orphaned scratch schema: ${name}`)
        await query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
      }
      await query(`CREATE SCHEMA "${target}"`)
      await query(`SET search_path TO "${target}"`)

      const initSql = readFileSync(resolve(process.cwd(), 'prisma/migrations/0_init/migration.sql'), 'utf8')
      await query(initSql) // unqualified quoted names → all objects land in the scratch schema

      // RateLimitBucket (later migration) — CREATE TABLE only, RLS skipped.
      const rateLimitSql = readFileSync(
        resolve(process.cwd(), 'prisma/migrations/00000000000003_rate_limit_backend/migration.sql'),
        'utf8',
      )
      const createTableStmt = rateLimitSql
        .split(';')
        .map((s) => s.trim())
        .find((s) => /^CREATE TABLE/im.test(s))
      if (createTableStmt) await query(`${createTableStmt};`)
    }

    // ── 3. load rows in FK-parents-first order ───────────────────────
    const { order, cyclic } = await fkOrderedTables(query, target)
    if (cyclic.length) {
      throw new Error(`[restore-verify] FK cycle in target schema (${cyclic.join(', ')}) — cannot order inserts`)
    }
    const scratchTables = new Set(order)
    const loadOrder = order.filter((t) => rowsByTable.has(t))
    for (const t of rowsByTable.keys()) {
      if (!scratchTables.has(t)) {
        throw new Error(`[restore-verify] backup table "${t}" has no DDL target in the target schema — schema drift`)
      }
    }

    // Column metadata from the TARGET schema's information_schema.
    const columnsByTable = new Map<string, ColumnMeta[]>()
    for (const t of loadOrder) {
      const { rows: colRows } = await query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [target, t],
      )
      const cols = colRows.map((r) => ({ column_name: String(r.column_name), data_type: String(r.data_type) }))
      columnsByTable.set(t, cols)
      for (const r of rowsByTable.get(t) ?? []) {
        for (const key of Object.keys(r)) {
          if (!cols.some((c) => c.column_name === key)) {
            throw new Error(`[restore-verify] table "${t}": backup column "${key}" missing from scratch DDL — schema drift`)
          }
        }
      }
    }

    const loadStarted = Date.now()
    let statements = 0
    try {
      await query('BEGIN')
      for (const table of loadOrder) {
        const cols = columnsByTable.get(table) as ColumnMeta[]
        const rows = rowsByTable.get(table) as Record<string, unknown>[]
        const colSql = cols.map((c) => `"${c.column_name}"`).join(', ')
        const perStatement = Math.max(1, Math.floor(2000 / Math.max(1, cols.length)))
        for (let i = 0; i < rows.length; i += perStatement) {
          const batch = rows.slice(i, i + perStatement)
          const params: unknown[] = []
          const tuples = batch
            .map((row) => {
              const start = params.length
              const decoded = cols.map((c) => decodeValue(row[c.column_name], c.data_type))
              params.push(...decoded)
              return `(${cols.map((_, j) => `$${start + j + 1}`).join(', ')})`
            })
            .join(', ')
          await query(
            `INSERT INTO "${target}"."${table}" (${colSql}) VALUES ${tuples}`,
            params,
          )
          statements++
        }
      }
      await query('COMMIT')
    } catch (e: unknown) {
      // ROLLBACK first so the ORIGINAL error (not the aborted-transaction
      // follow-up error) is what the run reports.
      await query('ROLLBACK').catch(() => {})
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`row load failed after ${statements} batched insert(s): ${msg}`)
    }
    const loadMs = Date.now() - loadStarted

    // ── 4. verify ────────────────────────────────────────────────────
    console.log('═'.repeat(78))
    console.log(`RESTORE VERIFY  backup=${backupPath}`)
    console.log(`target schema: ${target}${isPublicRestore ? '   (PUBLIC RESTORE — disaster runbook mode)' : ''}   (load: ${statements} batched inserts in ${(loadMs / 1000).toFixed(2)} s)`)
    console.log('═'.repeat(78))
    console.log(`${'TABLE'.padEnd(26)} ${'BACKUP'.padStart(8)} ${'RESTORED'.padStart(9)} ${'MATCH'.padStart(7)}`)
    console.log('─'.repeat(78))

    let totalBackup = 0
    let totalRestored = 0
    const verifyOrder = [...scratchTables].sort()
    for (const table of verifyOrder) {
      const backupCount = (rowsByTable.get(table) ?? []).length
      const { rows } = await query(`SELECT count(*)::int AS c FROM "${target}"."${table}"`)
      const restored = Number(rows[0]['c'])
      totalBackup += backupCount
      totalRestored += restored
      const match = backupCount === restored
      if (!match) failures.push(`${table}: backup ${backupCount} vs restored ${restored}`)
      console.log(
        `${table.padEnd(26)} ${String(backupCount).padStart(8)} ${String(restored).padStart(9)} ${(match ? 'OK' : 'FAIL').padStart(7)}`,
      )
    }
    console.log('─'.repeat(78))
    const totalsMatch = totalBackup === totalRestored
    if (!totalsMatch) failures.push(`TOTAL: backup ${totalBackup} vs restored ${totalRestored}`)
    console.log(
      `${'TOTAL'.padEnd(26)} ${String(totalBackup).padStart(8)} ${String(totalRestored).padStart(9)} ${(totalsMatch ? 'OK' : 'FAIL').padStart(7)}`,
    )

    // 3-way money parity on the RESTORED schema (exact NUMERIC ::text).
    const { rows: parityRows } = await query(
      `SELECT (SELECT COALESCE(SUM("amount"), 0) FROM "${target}"."Payment" WHERE "status" = 'SUCCESS')::text AS pay,
              (SELECT COALESCE(SUM("amount"), 0) FROM "${target}"."FeeTransaction" WHERE "status" = 'SUCCESS')::text AS txn,
              (SELECT COALESCE(SUM("paid"), 0) FROM "${target}"."Fee")::text AS fee`,
    )
    const pay = String(parityRows[0]['pay'])
    const txn = String(parityRows[0]['txn'])
    const fee = String(parityRows[0]['fee'])
    const restoredParityOk = toPaise(pay) === toPaise(txn) && toPaise(txn) === toPaise(fee)
    if (!restoredParityOk) failures.push(`restored 3-way parity: pay=${pay} txn=${txn} fee=${fee}`)

    // Cross-check against the backup-file paise sums (independent path).
    const vsBackupOk =
      toPaise(pay) === payPaise && toPaise(txn) === txnPaise && toPaise(fee) === feePaise
    if (!vsBackupOk) {
      failures.push(
        `restored parity vs backup-file sums: pay ${pay} vs ${fromPaise(payPaise)}, txn ${txn} vs ${fromPaise(txnPaise)}, fee ${fee} vs ${fromPaise(feePaise)}`,
      )
    }

    // Live public parity printed as REFERENCE in test mode (may drift
    // after the backup was taken — the backup file is the assertion
    // target, not public). In public-restore mode it IS the target parity.
    const { rows: liveRows } = await query(
      `SELECT (SELECT COALESCE(SUM("amount"), 0) FROM "public"."Payment" WHERE "status" = 'SUCCESS')::text AS pay,
              (SELECT COALESCE(SUM("amount"), 0) FROM "public"."FeeTransaction" WHERE "status" = 'SUCCESS')::text AS txn,
              (SELECT COALESCE(SUM("paid"), 0) FROM "public"."Fee")::text AS fee`,
    )

    console.log('─'.repeat(78))
    console.log('MONEY PARITY (3-way, NUMERIC-exact):')
    console.log(`  restored ${isPublicRestore ? 'public' : target}: pay=${pay}  txn=${txn}  fee=${fee}`)
    console.log(`  backup-file sums : pay=${fromPaise(payPaise)}  txn=${fromPaise(txnPaise)}  fee=${fromPaise(feePaise)}`)
    console.log(`  live public (ref): pay=${liveRows[0]['pay']}  txn=${liveRows[0]['txn']}  fee=${liveRows[0]['fee']}`)
    console.log(
      `  3-way equal (restored): ${restoredParityOk ? 'OK' : 'FAIL'}   restored==backup-file: ${vsBackupOk ? 'OK' : 'FAIL'}`,
    )
  } finally {
    // ── 5. ALWAYS drop the throwaway schema + verify zero residue ────
    // (public-restore mode keeps its target — the data IS the deliverable.)
    try {
      // Defensive ROLLBACK: if a failure left a transaction open, RESET /
      // DROP would otherwise be swallowed by 'transaction is aborted'.
      await query('ROLLBACK').catch(() => {})
      await query(`RESET search_path`)
      if (isPublicRestore) {
        dropped = true
      } else {
        await query(`DROP SCHEMA IF EXISTS "${target}" CASCADE`)
        const { rows } = await query(
          `SELECT count(*)::int AS c FROM pg_namespace WHERE nspname = $1`,
          [target],
        )
        dropped = Number(rows[0]['c']) === 0
        if (!dropped) failures.push(`scratch schema ${target} could not be dropped`)
      }
    } catch (cleanup: unknown) {
      console.error(
        '[restore-verify] cleanup error (scratch schema may remain):',
        cleanup instanceof Error ? cleanup.message : cleanup,
      )
    } finally {
      await client.end()
    }
  }

  const durationMs = Date.now() - startedAt
  console.log('─'.repeat(78))
  console.log(
    isPublicRestore
      ? `public restore: data kept in place   duration: ${(durationMs / 1000).toFixed(2)} s`
      : `scratch schema dropped: ${dropped ? 'OK' : 'FAIL'}   duration: ${(durationMs / 1000).toFixed(2)} s`,
  )
  if (failures.length) {
    console.error(`RESTORE VERIFY FAILED (${failures.length} mismatch(es)):`)
    for (const f of failures) console.error(`  · ${f}`)
    process.exit(1)
  }
  console.log(
    isPublicRestore
      ? 'PUBLIC RESTORE PASSED — every backed-up row loaded into public; parity exact.'
      : 'RESTORE VERIFY PASSED — every backed-up row round-tripped; parity exact; scratch schema dropped.',
  )
}

main().catch((e: unknown) => {
  console.error('[restore-verify] FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
