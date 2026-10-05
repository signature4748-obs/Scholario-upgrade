/**
 * scripts/prod-migration/lib.ts — shared machinery for the AUTHORITATIVE
 * production database migration pipeline (docs/PRODUCTION_DB_MIGRATION.md).
 *
 * CHANNEL: the Supabase Management API query endpoint is the only channel
 * that touches production. Rationale (see docs/PRODUCTION_DB_MIGRATION.md
 * §"Why the Management API channel"):
 *   · the Supavisor pooler DB password is owner-held (deliberately rotated
 *     to the API boundary during the final forensic acceptance — the value
 *     is NOT in any repo, token or script);
 *   · the endpoint executes as the `postgres` role — the role that OWNS the
 *     application schema and holds BYPASSRLS (verified: rolbypassrls=t), so
 *     migrations run with exactly the privileges `prisma migrate deploy`
 *     would have;
 *   · multi-statement batches and explicit BEGIN…COMMIT transaction control
 *     both work through this endpoint (verified against production).
 *
 * SAFETY RULES enforced by everything in this directory:
 *   · SUPABASE_ACCESS_TOKEN is never printed, logged, or written to disk.
 *   · Every write runs inside ONE explicit transaction that also inserts the
 *     `_prisma_migrations` row — a failed migration leaves NO partial schema
 *     state and NO history row (fail-loud, never "half applied").
 *   · History rows are written with the TRUE Prisma checksum: sha256 of the
 *     migration.sql file (verified 13/13 against a local database migrated
 *     by `prisma migrate deploy` itself). `prisma migrate deploy` /
 *     `prisma migrate status` therefore treat this pipeline's output as
 *     their own — zero drift, no "repair" markers, idempotent re-runs.
 *   · Seeds are never executed. Production data is never modified except by
 *     version-controlled migration files.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_BASE = 'https://api.supabase.com'
const API_TIMEOUT_MS = 90_000
const API_RETRIES = 3

/** A migration as it exists in THIS checkout (the release source of truth). */
export interface RepoMigration {
  name: string
  path: string
  /** sha256 of migration.sql — byte-identical to what Prisma records. */
  checksum: string
  sql: string
}

/** A `_prisma_migrations` row as it exists in production. */
export interface AppliedMigration {
  migration_name: string
  checksum: string | null
  finished: boolean
  rolled_back: boolean
  applied_steps_count: number
}

export interface UserState {
  total: number
  byRole: Record<string, number>
  schoolPlane: number
  /** Only meaningful when the flag columns exist. */
  principals: number
  principalsFlagged: number | null
  schoolPlaneNeverSetOwnPassword: number | null
  schoolPlaneNeverSetAndFlagged: number | null
  /** Rows violating the migration invariant (must be 0 after apply). */
  schoolPlaneInvariantViolations: number | null
}

export interface AdminState {
  total: number
  active: number
  suspended: number
  /** null while the googleSub column does not exist yet (pre-migration). */
  googleLinked: number | null
  /** Admins with a non-empty passwordHash — counts only, values never read. */
  withPassword: number
}

export interface Snapshot {
  capturedAt: string
  gitSha: string | null
  tableCounts: Record<string, number>
  userState: UserState
  /** PlatformAdmin credential-plane state (ACCOUNT-RECOVERY era; counts only). */
  adminState?: AdminState
  appliedMigrations: Array<{ name: string; checksum: string | null; finished: boolean }>
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[prod-migration] environment variable ${name} is required (never logged).`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Execute one SQL batch against production via the Management API.
 * Transport failures (5xx / network) are retried with backoff; ANY SQL
 * error fails immediately — a migration error must never be retried or
 * swallowed.
 */
export async function mgmtQuery(query: string, attempt = 1): Promise<unknown> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const ref = requireEnv('SUPABASE_PROJECT_REF')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const isServerError = res.status >= 500
      if (isServerError && attempt < API_RETRIES) {
        console.warn(`[prod-migration] Management API HTTP ${res.status} — retrying (${attempt}/${API_RETRIES - 1})…`)
        await sleep(1500 * attempt)
        return mgmtQuery(query, attempt + 1)
      }
      throw new Error(`Management API rejected the batch (HTTP ${res.status}): ${clip(text, 500)}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Management API returned a non-JSON body: ${clip(text, 200)}`)
    }
  } catch (err) {
    const retriable =
      err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError') // timeout / network-level fetch failure
    if (retriable && attempt < API_RETRIES) {
      console.warn(`[prod-migration] transport hiccup (${(err as Error).name}) — retrying (${attempt}/${API_RETRIES - 1})…`)
      await sleep(1500 * attempt)
      return mgmtQuery(query, attempt + 1)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** sha256 of a file's bytes — identical to Prisma's migration checksum. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Migrations in this checkout, in Prisma's apply order (name sort). */
export function listRepoMigrations(
  migrationsDir = resolve(process.cwd(), 'prisma/migrations'),
): RepoMigration[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`[prod-migration] ${migrationsDir} not found — run from the repository root.`)
  }
  return readdirSync(migrationsDir)
    .filter((entry) => existsSync(resolve(migrationsDir, entry, 'migration.sql')))
    .sort()
    .map((name) => {
      const path = resolve(migrationsDir, name, 'migration.sql')
      return { name, path, checksum: sha256File(path), sql: readFileSync(path, 'utf8') }
    })
}

/** Read the production `_prisma_migrations` state. */
export async function fetchAppliedMigrations(): Promise<AppliedMigration[]> {
  const rows = (await mgmtQuery(
    `SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back, applied_steps_count FROM _prisma_migrations ORDER BY migration_name`,
  )) as Array<Record<string, unknown>>
  if (!Array.isArray(rows)) {
    throw new Error('[prod-migration] unexpected _prisma_migrations response shape')
  }
  return rows.map((r) => ({
    migration_name: String(r.migration_name),
    checksum: r.checksum == null ? null : String(r.checksum),
    finished: Boolean(r.finished),
    rolled_back: Boolean(r.rolled_back),
    applied_steps_count: Number(r.applied_steps_count ?? 0),
  }))
}

export interface HistoryGate {
  repo: RepoMigration[]
  applied: AppliedMigration[]
  /** repo migrations with no production row, in apply order. */
  pending: RepoMigration[]
  /** production rows that do not exist in this checkout → STOP condition. */
  unknown: AppliedMigration[]
  /** unfinished / rolled-back production rows → STOP condition. */
  failed: AppliedMigration[]
  /** ALL checksum divergences between production rows and repo files. */
  checksumDivergences: Array<{ name: string; db: string | null; repo: string }>
  /** The one documented, repairable divergence (see apply.ts step 0). */
  repairableDivergence: { name: string; db: string | null; repo: string } | null
  /** applied rows that appear AFTER a pending one (history not a prefix). */
  outOfOrder: string[]
  problems: string[]
}

/** The migration whose history row was hand-recorded during the SaaS-hardening handoff. */
export const DOCUMENTED_DIVERGENCE_MIGRATION = '20261004090000_saas_hardening_entitlement'

/**
 * The history gate: production migration history must MATCH the
 * repository — applied = a prefix of the repo chain, nothing unknown,
 * nothing failed, checksums identical to the repo files. ONE divergence is
 * known and documented (the saas-hardening manual-apply placeholder
 * checksum, worklog SAAS-HARD-PROD): it is surfaced as `repairableDivergence`
 * (warned by preflight, transactionally repaired by apply.ts) and does NOT
 * fail the gate — every other divergence does.
 */
export async function migrationHistoryGate(): Promise<HistoryGate> {
  const repo = listRepoMigrations()
  const applied = await fetchAppliedMigrations()
  const repoNames = new Set(repo.map((m) => m.name))
  const appliedNames = new Set(applied.map((m) => m.migration_name))

  const unknown = applied.filter((m) => !repoNames.has(m.migration_name))
  const failed = applied.filter((m) => !m.finished || m.rolled_back)
  const pending = repo.filter((m) => !appliedNames.has(m.name))
  const pendingNames = new Set(pending.map((m) => m.name))
  const outOfOrder = applied
    .map((m) => m.migration_name)
    .filter((name) => repoNames.has(name))
    .filter((name) => repo.some((m) => m.name < name && pendingNames.has(m.name)))
  const byName = new Map(applied.map((m) => [m.migration_name, m]))
  const checksumDivergences = repo
    .filter((m) => byName.has(m.name))
    .filter((m) => byName.get(m.name)!.checksum !== m.checksum)
    .map((m) => ({ name: m.name, db: byName.get(m.name)!.checksum, repo: m.checksum }))
  const repairableDivergence =
    checksumDivergences.find((d) => d.name === DOCUMENTED_DIVERGENCE_MIGRATION) ?? null
  const unknownDivergences = checksumDivergences.filter(
    (d) => d.name !== DOCUMENTED_DIVERGENCE_MIGRATION,
  )

  const problems: string[] = []
  if (unknown.length) {
    problems.push(
      `production contains migrations that do not exist in this checkout (STOP — never force-reset): ${unknown.map((m) => m.migration_name).join(', ')}`,
    )
  }
  if (failed.length) {
    problems.push(
      `production contains unfinished/rolled-back migrations (STOP): ${failed.map((m) => m.migration_name).join(', ')}`,
    )
  }
  if (outOfOrder.length) {
    problems.push(`production history is not a prefix of the repository chain (gaps): ${outOfOrder.join(', ')}`)
  }
  if (unknownDivergences.length) {
    problems.push(
      `UNKNOWN checksum divergences (production row ≠ repository file — STOP): ${unknownDivergences.map((d) => d.name).join(', ')}`,
    )
  }

  return { repo, applied, pending, unknown, failed, checksumDivergences, repairableDivergence, outOfOrder, problems }
}

/** Escape a value for a single-quoted SQL literal. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Row counts for EVERY public base table (the strongest drift detector). */
export async function tableCounts(): Promise<Record<string, number>> {
  const tables = (await mgmtQuery(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )) as Array<{ table_name: string }>
  if (!Array.isArray(tables) || !tables.length) {
    throw new Error('[prod-migration] no public tables found — refusing to count (unexpected).')
  }
  const selects = tables.map(
    (t) => `SELECT ${sqlLiteral(t.table_name)} AS tbl, count(*)::int AS n FROM "${t.table_name}"`,
  )
  // One batched statement; identifiers are Prisma-generated CamelCase names
  // (they cannot contain embedded double quotes).
  const rows = (await mgmtQuery(selects.join(' UNION ALL '))) as Array<{ tbl: string; n: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.tbl] = Number(r.n)
  return out
}

/** All public-schema index names (presence computed locally, exact-match). */
export async function allIndexNames(): Promise<Set<string>> {
  const rows = (await mgmtQuery(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  )) as Array<{ indexname: string }>
  return new Set(rows.map((r) => r.indexname))
}

/** Columns of a public table (shape metadata only — never values). */
export async function tableColumns(
  table: string,
  names?: readonly string[],
): Promise<Array<{ column_name: string; data_type: string; is_nullable: string }>> {
  const filter = names?.length
    ? `AND column_name IN (${names.map((n) => sqlLiteral(n)).join(', ')})`
    : ''
  const rows = (await mgmtQuery(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${sqlLiteral(table)} ${filter} ORDER BY ordinal_position`,
  )) as Array<{ column_name: string; data_type: string; is_nullable: string }>
  return rows
}

/** indexname → indexdef for the given tables (UNIQUE-ness assertion surface). */
export async function indexDefinitions(
  tables: readonly string[],
): Promise<Map<string, string>> {
  const rows = (await mgmtQuery(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${tables.map((t) => sqlLiteral(t)).join(', ')})`,
  )) as Array<{ indexname: string; indexdef: string }>
  return new Map(rows.map((r) => [r.indexname, r.indexdef]))
}

/** The credential-neutralization columns on "User". */
export async function userCredentialColumns(): Promise<
  Array<{ column_name: string; data_type: string; is_nullable: string }>
> {
  return tableColumns('User', ['mustChangePassword', 'passwordChangedAt'])
}

/** User/credential state (flag fields only when the columns exist). */
export async function userState(columnsPresent: boolean): Promise<UserState> {
  const roles = (await mgmtQuery(
    `SELECT role::text AS role, count(*)::int AS n FROM "User" GROUP BY role ORDER BY role`,
  )) as Array<{ role: string; n: number }>
  const byRole: Record<string, number> = {}
  let total = 0
  for (const r of roles) {
    byRole[r.role] = Number(r.n)
    total += Number(r.n)
  }
  const schoolPlaneRow = (await mgmtQuery(
    `SELECT count(*)::int AS n FROM "User" WHERE "schoolId" IS NOT NULL AND role <> 'SUPER_ADMIN'`,
  )) as Array<{ n: number }>
  const state: UserState = {
    total,
    byRole,
    schoolPlane: Number(schoolPlaneRow[0]?.n ?? 0),
    principals: byRole['PRINCIPAL'] ?? 0,
    principalsFlagged: null,
    schoolPlaneNeverSetOwnPassword: null,
    schoolPlaneNeverSetAndFlagged: null,
    schoolPlaneInvariantViolations: null,
  }
  if (columnsPresent) {
    const flagged = (await mgmtQuery(
      `SELECT count(*)::int AS n FROM "User" WHERE role = 'PRINCIPAL' AND "mustChangePassword" = true`,
    )) as Array<{ n: number }>
    state.principalsFlagged = Number(flagged[0]?.n ?? 0)
    const neverSet = (await mgmtQuery(
      `SELECT count(*)::int AS n FROM "User" WHERE "schoolId" IS NOT NULL AND role <> 'SUPER_ADMIN' AND "passwordChangedAt" IS NULL`,
    )) as Array<{ n: number }>
    state.schoolPlaneNeverSetOwnPassword = Number(neverSet[0]?.n ?? 0)
    const neverSetFlagged = (await mgmtQuery(
      `SELECT count(*)::int AS n FROM "User" WHERE "schoolId" IS NOT NULL AND role <> 'SUPER_ADMIN' AND "passwordChangedAt" IS NULL AND "mustChangePassword" = true`,
    )) as Array<{ n: number }>
    state.schoolPlaneNeverSetAndFlagged = Number(neverSetFlagged[0]?.n ?? 0)
    const violations = (await mgmtQuery(
      `SELECT count(*)::int AS n FROM "User" WHERE "schoolId" IS NOT NULL AND role <> 'SUPER_ADMIN' AND "passwordChangedAt" IS NULL AND "mustChangePassword" <> true`,
    )) as Array<{ n: number }>
    state.schoolPlaneInvariantViolations = Number(violations[0]?.n ?? 0)
  }
  return state
}

/** PlatformAdmin credential-plane state — counts only (hash VALUES are
 *  never read, printed or compared; this is the "passwords were never
 *  altered" verification surface). */
export async function adminState(): Promise<AdminState> {
  const hasGoogle = (await mgmtQuery(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PlatformAdmin' AND column_name = 'googleSub'`,
  )) as Array<{ n: number }>
  const googleExpr = Number(hasGoogle[0]?.n ?? 0) > 0 ? `"googleSub" IS NOT NULL` : 'FALSE'
  const rows = (await mgmtQuery(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
            count(*) FILTER (WHERE ${googleExpr})::int AS google_linked,
            count(*) FILTER (WHERE "passwordHash" IS NOT NULL AND "passwordHash" <> '')::int AS with_password
     FROM "PlatformAdmin"`,
  )) as Array<{ total: number; active: number; suspended: number; google_linked: number; with_password: number }>
  const r = rows[0]
  // googleLinked is null while the googleSub column does not exist yet —
  // the snapshot honestly records "column not present (pre-migration)".
  const googleLinked = Number(hasGoogle[0]?.n ?? 0) > 0 ? Number(r?.google_linked ?? 0) : null
  return {
    total: Number(r?.total ?? 0),
    active: Number(r?.active ?? 0),
    suspended: Number(r?.suspended ?? 0),
    googleLinked,
    withPassword: Number(r?.with_password ?? 0),
  }
}

/** Production readiness probe (no credentials involved). */
export async function productionHealth(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const body = await res.text()
    const ok = res.status === 200 && body.includes('"database":"ok"')
    return { ok, status: res.status, body: clip(body, 300) }
  } catch (err) {
    return { ok: false, status: 0, body: `probe failed: ${(err as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** HEAD commit of this checkout (provenance logging only). */
export function gitSha(): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 })
    return r.status === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

/**
 * Build the transactional batch for one migration: the file's SQL PLUS the
 * `_prisma_migrations` row, atomically. The row uses the TRUE Prisma
 * checksum and Prisma's exact row shape (uuid id, NULL logs /
 * rolled_back_at, applied_steps_count 1) so prisma migrate deploy/status
 * treat it as their own.
 */
export function buildMigrationTransaction(migration: RepoMigration): string {
  const id = randomUUID()
  return [
    'BEGIN;',
    migration.sql.trim(),
    `INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")`,
    `  VALUES (${sqlLiteral(id)}, ${sqlLiteral(migration.checksum)}, clock_timestamp(), ${sqlLiteral(migration.name)}, NULL, NULL, clock_timestamp(), 1);`,
    'COMMIT;',
  ].join('\n')
}

// ─── The exact object expectations per migration (single source: the
// migration SQL files themselves) ─────────────────────────────────────────

export const TRGM_INDEXES: readonly string[] = [
  'User_name_trgm',
  'Student_admissionNo_trgm',
  'Teacher_employeeId_trgm',
  'Fee_title_trgm',
  'Notification_title_trgm',
  'Notification_message_trgm',
  'Message_subject_trgm',
  'Message_body_trgm',
  'StudyMaterial_title_trgm',
  'StudyMaterial_description_trgm',
  'FlashcardDeck_name_trgm',
  'StudyGroup_name_trgm',
  'Class_name_trgm',
  'Timetable_teacherName_trgm',
  'School_name_trgm',
  'School_slug_trgm',
  'School_code_trgm',
  'School_domain_trgm',
  'PlatformAuditLog_action_trgm',
  'PlatformAuditLog_reason_trgm',
  'ParentMessage_body_trgm',
  'GrowthEvent_reason_trgm',
  'TeacherFollowUp_reason_trgm',
  'GrowthRule_label_trgm',
]

export const SCHOOLID_INDEXES: readonly string[] = [
  'Assignment_schoolId_idx',
  'Driver_schoolId_idx',
  'ExamPaper_schoolId_idx',
  'HomeworkAuditLog_schoolId_idx',
  'HomeworkSubmission_schoolId_idx',
  'HomeworkSurvey_schoolId_idx',
  'ParentGrievance_schoolId_idx',
  'QuestionBank_schoolId_idx',
  'Route_schoolId_idx',
  'SchoolEvent_schoolId_idx',
  'Vehicle_schoolId_idx',
]

export const SAAS_HARDENING_TABLES: readonly string[] = [
  'SchoolSubscription',
  'PlatformPayment',
  'WebsiteNotice',
  'WebsiteAdmission',
  'WebsiteSocialLink',
  'WebsiteMedia',
  'SchoolProfileChangeRequest',
  'SchoolPaymentGateway',
]

// ─── ACCOUNT-RECOVERY (20261005060000) — the exact object set ──────────────
// Single source: prisma/migrations/20261005060000_platform_account_recovery/migration.sql

export const ACCOUNT_RECOVERY_MIGRATION = '20261005060000_platform_account_recovery'

export const ACCOUNT_RECOVERY_INDEXES: readonly string[] = [
  'PlatformAdmin_googleSub_key',
  'PlatformPasswordReset_tokenHash_key',
  'PlatformPasswordReset_adminId_idx',
  'PlatformPasswordReset_expiresAt_idx',
  'PlatformRecoveryTicket_targetAdminId_idx',
  'PlatformRecoveryTicket_expiresAt_idx',
]

export const ACCOUNT_RECOVERY_TABLES: readonly string[] = ['PlatformPasswordReset', 'PlatformRecoveryTicket']

/**
 * Object expectations per migration: while the migration is PENDING the
 * objects must NOT exist (protects against schema drift / half-applied
 * state under a different migration state); once APPLIED they must exist.
 */
export interface MigrationExpectation {
  columns?: readonly string[]
  indexes?: readonly string[]
  tables?: readonly string[]
  /** table-scoped column expectations (ACCOUNT-RECOVERY era). */
  tableColumns?: Readonly<Record<string, readonly string[]>>
}

export const MIGRATION_EXPECTATIONS: Record<string, MigrationExpectation> = {
  '20261004150000_credential_neutralization': {
    columns: ['mustChangePassword', 'passwordChangedAt'],
  },
  '20261004153000_restore_trgm_search_indexes': { indexes: TRGM_INDEXES },
  '20261004154000_schoolid_indexes_tenant_tables': { indexes: SCHOOLID_INDEXES },
  [ACCOUNT_RECOVERY_MIGRATION]: {
    tableColumns: { PlatformAdmin: ['googleSub', 'googleEmail', 'googleLinkedAt'] },
    indexes: ACCOUNT_RECOVERY_INDEXES,
    tables: ACCOUNT_RECOVERY_TABLES,
  },
}

export interface ExpectationResult {
  pendingViolations: string[]
  appliedViolations: string[]
}

/**
 * Evaluate object expectations for every mapped migration:
 * pending → objects must be absent; applied → objects must be present.
 */
export async function evaluateExpectations(gate: HistoryGate): Promise<ExpectationResult> {
  const [indexes, columns, tables] = await Promise.all([
    allIndexNames(),
    userCredentialColumns(),
    tableCounts(),
  ])
  const columnNames = new Set(columns.map((c) => c.column_name))
  const tableNames = new Set(Object.keys(tables))
  // Table-scoped column expectations: collect the distinct tables across ALL
  // mapped expectations and probe each ONCE (an absent column is simply not
  // returned by information_schema — that IS the absence signal).
  const scopedTables = new Set<string>()
  for (const migration of gate.repo) {
    for (const table of Object.keys(MIGRATION_EXPECTATIONS[migration.name]?.tableColumns ?? {})) {
      scopedTables.add(table)
    }
  }
  const scopedColumnNames = new Map<string, Set<string>>()
  await Promise.all(
    [...scopedTables].map(async (table) => {
      scopedColumnNames.set(table, new Set((await tableColumns(table)).map((c) => c.column_name)))
    }),
  )
  const pendingViolations: string[] = []
  const appliedViolations: string[] = []
  for (const migration of gate.repo) {
    const expectation = MIGRATION_EXPECTATIONS[migration.name]
    if (!expectation) continue
    const isPending = gate.pending.some((p) => p.name === migration.name)
    const target = isPending ? pendingViolations : appliedViolations
    const bucket = (kind: string, names: readonly string[], present: (n: string) => boolean) => {
      for (const name of names) {
        const exists = present(name)
        if (isPending && exists) {
          target.push(`${migration.name}: ${kind} ${name} already exists while migration is PENDING (schema drift — STOP)`)
        }
        if (!isPending && !exists) {
          target.push(`${migration.name}: ${kind} ${name} missing although migration is APPLIED`)
        }
      }
    }
    bucket('column', expectation.columns ?? [], (n) => columnNames.has(n))
    bucket('index', expectation.indexes ?? [], (n) => indexes.has(n))
    bucket('table', expectation.tables ?? [], (n) => tableNames.has(n))
    for (const [table, cols] of Object.entries(expectation.tableColumns ?? {})) {
      const present = scopedColumnNames.get(table) ?? new Set<string>()
      for (const column of cols) {
        const exists = present.has(column)
        if (isPending && exists) {
          target.push(`${migration.name}: column ${table}.${column} already exists while migration is PENDING (schema drift — STOP)`)
        }
        if (!isPending && !exists) {
          target.push(`${migration.name}: column ${table}.${column} missing although migration is APPLIED`)
        }
      }
    }
  }
  return { pendingViolations, appliedViolations }
}

/** Migrations that must be pure additive DDL — no data statement ever runs.
 *  Guards the account-safety rule: existing PlatformAdmin rows (including
 *  password hashes) are never altered during deployment. */
export const ADDITIVE_ONLY_MIGRATIONS: ReadonlySet<string> = new Set([ACCOUNT_RECOVERY_MIGRATION])

/** Assert a registered ADDITIVE-ONLY migration contains only allowed
 *  statement shapes (comments stripped first). Throws with the offending
 *  statement otherwise. */
export function assertAdditiveOnly(migration: RepoMigration): void {
  const stripped = migration.sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const allowed = [
    /^ALTER\s+TABLE\s+"?[\w$]+"?\s+ADD\s+(COLUMN|CONSTRAINT)\b/i,
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+/i,
    /^CREATE\s+TABLE\s+/i,
  ]
  for (const s of statements) {
    if (allowed.some((re) => re.test(s))) continue
    throw new Error(
      `[prod-migration] ${migration.name} is registered ADDITIVE-ONLY but contains a non-additive statement: ${s.slice(0, 100)}…`,
    )
  }
}

/** Parse a comma-separated CLI value. */
export function parseCsv(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Fail-loud summary printer shared by all three stages. */
export function exitWithProblems(stage: string, problems: string[]): never {
  console.error(`\n[prod-migration:${stage}] ✖ FAILED — ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  ✖ ${p}`)
  process.exit(1)
}
