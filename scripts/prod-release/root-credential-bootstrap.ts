/**
 * scripts/prod-release/root-credential-bootstrap.ts — the OWNER-AUTHORIZED
 * Super Admin credential bootstrap (P0-A).
 *
 * WHY THIS EXISTS: every in-app recovery path for the platform root
 * account dead-ends today — the emailed reset flow needs working email
 * delivery (Resend key currently invalid), and dual-control recovery
 * needs a SECOND admins.manage holder (there is exactly one ACTIVE
 * admin). This script is the controlled server-side bootstrap that
 * restores the owner's access WITHOUT any of those dependencies.
 *
 * SECURITY MODEL (mirrors docs/PRODUCTION_DB_MIGRATION.md):
 *   · CHANNEL: the Supabase Management API query endpoint — the SAME
 *     authoritative channel the migration pipeline uses. The
 *     independently configured secret is the owner-held
 *     SUPABASE_ACCESS_TOKEN (never in the repo, never printed, never
 *     logged). An unauthenticated visitor can NEVER reach this
 *     operation: it is not an HTTP endpoint of the application at all.
 *   · HASHING: the new password is hashed with the EXACT production
 *     implementation — src/lib/auth.ts hashPassword (scrypt,
 *     16-byte salt, 64-byte key, `salt:hash` hex) — imported directly,
 *     never re-implemented.
 *   · ONE-TIME CREDENTIAL: a crypto-random 12-character password
 *     (generateTempPassword — policy-valid by construction), delivered
 *     ONCE: written to a file OUTSIDE the repository (chmod 600) and
 *     printed once to the operator's terminal. The stored hash is
 *     never printed or logged anywhere.
 *   · SESSIONS: every live PlatformAdminSession of the target is
 *     revoked in the same transaction.
 *   · AUDIT: a PlatformAuditLog row (platform.root_credential.
 *     bootstrapped) records the operation — counts and flags only,
 *     never the password, never the hash.
 *   · CLASSIFICATION: --mark-production flips the seed-era isDemo
 *     marker to false on the target (a DELIBERATE, owner-approved
 *     production classification — the flag has no effect in
 *     production deployments, it only gates the dev-preview demo-code
 *     widget, so flipping it is a labelling correction, not a
 *     permission change).
 *
 * GUARDS (fail-closed):
 *   · --email is required and MUST resolve to an ACTIVE, isRoot=true
 *     PlatformAdmin (refuses non-root targets, suspended targets,
 *     unknown emails). The UPDATE re-verifies the guard inside the
 *     transaction (WHERE isRoot AND status='ACTIVE') and a rowcount≠1
 *     aborts the whole transaction.
 *   · the credential file refuses to be written inside the repo.
 *   · --dry-run performs the read-only guards and shows what WOULD
 *     happen, then exits without writing anything.
 *
 * Usage (owner's terminal, from the repository root):
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-release/root-credential-bootstrap.ts \
 *       --email admin@scholario.cloud [--mark-production] [--out /path/file.txt] [--dry-run]
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { hashPassword } from '../../src/lib/auth'
import { generateTempPassword } from '../../src/lib/account-provisioning'

const API_BASE = 'https://api.supabase.com'
const API_TIMEOUT_MS = 30_000
const SCRIPT_NAME = 'root-credential-bootstrap'

// ── CLI ───────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[${SCRIPT_NAME}] ${flag} requires a value`)
    process.exit(2)
  }
  return v
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    console.error(
      `[${SCRIPT_NAME}] environment variable ${name} is required (never logged).`,
    )
    process.exit(1)
  }
  return value.trim()
}

const TARGET_EMAIL = argValue('--email')
const MARK_PRODUCTION = process.argv.includes('--mark-production')
const DRY_RUN = process.argv.includes('--dry-run')
const OUT_OVERRIDE = argValue('--out')

if (!TARGET_EMAIL) {
  console.error(`[${SCRIPT_NAME}] --email <root admin email> is required`)
  process.exit(2)
}

// ── Management API channel (same transport as the migration pipeline) ────

async function mgmtQuery(query: string): Promise<unknown> {
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
      throw new Error(`Management API rejected the batch (HTTP ${res.status}): ${text.slice(0, 500)}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Management API returned a non-JSON body: ${text.slice(0, 200)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── SQL literal helpers (identical quoting rules to prod-migration/lib.ts) ─

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// ── Credential delivery (outside the repo, chmod 600) ─────────────────────

const PROJECT_ROOT = path.resolve(new URL('../..', import.meta.url).pathname)

function resolveOut(): string {
  if (OUT_OVERRIDE) return path.resolve(OUT_OVERRIDE)
  return path.join(homedir(), '.scholario-root-credential.txt')
}

function assertOutsideRepo(outPath: string): void {
  const dir = realpathSync(path.dirname(outPath))
  if (dir === PROJECT_ROOT || dir.startsWith(PROJECT_ROOT + path.sep)) {
    console.error(
      `[${SCRIPT_NAME}] REFUSING: the credential file must live OUTSIDE the repository (${outPath}).`,
    )
    process.exit(1)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

interface AdminRow {
  id: string
  email: string
  name: string
  status: string
  isRoot: boolean
  isDemo: boolean
  liveSessions: string | number | null
}

async function main(): Promise<void> {
  console.log(`[${SCRIPT_NAME}] ═══ ROOT CREDENTIAL BOOTSTRAP ═══`)
  console.log(`  mode        : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`  target      : ${TARGET_EMAIL}`)
  console.log(`  classification: ${MARK_PRODUCTION ? 'isDemo → false (deliberate production marking)' : 'unchanged'}`)

  // ── Read-only guard: the target must be THE active root admin ──────
  const targetEmail = TARGET_EMAIL as string
  const guardRows = (await mgmtQuery(
    `SELECT a."id", a."email", a."name", a."status", a."isRoot", a."isDemo",
            (SELECT count(*) FROM "PlatformAdminSession" s
              WHERE s."adminId" = a."id" AND s."revokedAt" IS NULL AND s."expiresAt" > now())
              AS "liveSessions"
       FROM "PlatformAdmin" a WHERE lower(a."email") = ${sqlLiteral(targetEmail.trim().toLowerCase())}`,
  )) as AdminRow[]

  if (guardRows.length === 0) {
    console.error(
      `[${SCRIPT_NAME}] REFUSING: no PlatformAdmin exists for ${TARGET_EMAIL}.`,
    )
    process.exit(1)
  }
  const admin = guardRows[0]
  if (!admin.isRoot) {
    console.error(
      `[${SCRIPT_NAME}] REFUSING: ${admin.email} is not a root admin (isRoot=false). This bootstrap only ever targets root accounts.`,
    )
    process.exit(1)
  }
  if (admin.status !== 'ACTIVE') {
    console.error(
      `[${SCRIPT_NAME}] REFUSING: ${admin.email} is ${admin.status} — reactivate the account first (this script never changes status).`,
    )
    process.exit(1)
  }

  console.log(`  admin       : ${admin.name} (${admin.id})`)
  console.log(`  isRoot      : true · status: ACTIVE · isDemo: ${admin.isDemo}`)
  console.log(`  live sessions to revoke: ${admin.liveSessions ?? 0}`)

  const oneTimePassword = generateTempPassword()
  const newHash = hashPassword(oneTimePassword) // the EXACT production scrypt implementation

  if (DRY_RUN) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete — nothing was written.`)
    console.log(`  would: replace passwordHash (scrypt), revoke ${admin.liveSessions ?? 0} live session(s),`)
    console.log(`         insert a platform.root_credential.bootstrapped audit row`)
    if (MARK_PRODUCTION) console.log(`  would: set isDemo=false (production classification)`)
    console.log(`  credential delivery: ${resolveOut()} (chmod 600) + one terminal print`)
    return
  }

  // ── ONE transaction: hash (+ optional classification) + session
  //    revocation + audit row. The UPDATE re-verifies the guard and a
  //    rowcount≠1 aborts everything (fail-closed under concurrency). ──
  const auditId = randomUUID()
  const metadata = JSON.stringify({
    via: 'root-credential-bootstrap',
    liveSessionsRevoked: Number(admin.liveSessions ?? 0),
    markProduction: MARK_PRODUCTION,
  })

  const statements: string[] = ['BEGIN;']
  statements.push(
    [
      `DO $$`,
      `DECLARE`,
      `  v_id text := ${sqlLiteral(admin.id)};`,
      `  v_hash text := ${sqlLiteral(newHash)};`,
      `  v_rows int;`,
      `BEGIN`,
      `  UPDATE ${sqlIdent('PlatformAdmin')}`,
      `     SET ${sqlIdent('passwordHash')} = v_hash${MARK_PRODUCTION ? `, ${sqlIdent('isDemo')} = false` : ''}`,
      `   WHERE ${sqlIdent('id')} = v_id AND ${sqlIdent('isRoot')} = true AND ${sqlIdent('status')} = 'ACTIVE';`,
      `  GET DIAGNOSTICS v_rows = ROW_COUNT;`,
      `  IF v_rows <> 1 THEN`,
      `    RAISE EXCEPTION 'guard failed: root admin row changed state mid-flight (rows=%)', v_rows;`,
      `  END IF;`,
      `  UPDATE ${sqlIdent('PlatformAdminSession')}`,
      `     SET ${sqlIdent('revokedAt')} = now()`,
      `   WHERE ${sqlIdent('adminId')} = v_id AND ${sqlIdent('revokedAt')} IS NULL;`,
      `  INSERT INTO ${sqlIdent('PlatformAuditLog')}`,
      `    (${sqlIdent('id')}, ${sqlIdent('adminId')}, ${sqlIdent('action')}, ${sqlIdent('targetType')},`,
      `     ${sqlIdent('targetId')}, ${sqlIdent('ip')}, ${sqlIdent('requestId')}, ${sqlIdent('reason')}, ${sqlIdent('metadata')})`,
      `  VALUES (${sqlLiteral(auditId)}, v_id, 'platform.root_credential.bootstrapped', 'ADMIN', v_id,`,
      `          ${sqlLiteral(SCRIPT_NAME)}, ${sqlLiteral(auditId)},`,
      `          ${sqlLiteral('owner-authorized root credential bootstrap (Management API channel); all live sessions revoked')},`,
      `          ${sqlLiteral(metadata)});`,
      `END $$;`,
    ].join('\n'),
  )
  statements.push('COMMIT;')

  await mgmtQuery(statements.join('\n'))

  // ── Post-write verification (read-only): audit row landed ──────────
  const verifyRows = (await mgmtQuery(
    `SELECT "action", "createdAt" FROM "PlatformAuditLog" WHERE "id" = ${sqlLiteral(auditId)}`,
  )) as Array<{ action: string }>
  if (verifyRows.length !== 1 || verifyRows[0].action !== 'platform.root_credential.bootstrapped') {
    console.error(
      `[${SCRIPT_NAME}] VERIFICATION FAILED: the audit row was not found after commit — investigate before retrying.`,
    )
    process.exit(1)
  }

  // ── One-time credential delivery ────────────────────────────────────
  const outPath = resolveOut()
  assertOutsideRepo(outPath)
  const outDir = path.dirname(outPath)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(
    outPath,
    [
      `SCHOLARIO root admin — one-time credential (generated ${new Date().toISOString()})`,
      ``,
      `Admin          : ${admin.name} <${admin.email}>`,
      `One-time password: ${oneTimePassword}`,
      ``,
      `HOW TO USE`,
      `1. Sign in at the platform console (see docs/OWNER_RECOVERY.md).`,
      `2. Immediately change this password: Settings → Account & sign-in →`,
      `   Change password (in-session; every other session is signed out).`,
      `3. DELETE THIS FILE once the password has been changed.`,
      ``,
      `This password was shown once. It is not stored anywhere else in`,
      `plaintext. The database holds only its scrypt hash.`,
      ``,
    ].join('\n'),
  )
  if (existsSync(outPath)) {
    chmodSync(outPath, 0o600)
  } else {
    // Defensive: writeFileSync with an unwritable path should have thrown.
    console.error(`[${SCRIPT_NAME}] REFUSING: credential file was not created (${outPath}).`)
    process.exit(1)
  }

  console.log(`[${SCRIPT_NAME}] ✔ bootstrap applied and verified (audit row ${auditId.slice(0, 8)}…).`)
  console.log(`  passwordHash: replaced (scrypt, exact production implementation — value never printed)`)
  console.log(`  sessions    : ${admin.liveSessions ?? 0} live session(s) revoked`)
  if (MARK_PRODUCTION) console.log(`  isDemo      : false (production classification)`)
  console.log(`  audit       : platform.root_credential.bootstrapped`)
  console.log(``)
  console.log(`┌──────────────────────────────────────────────────────────────┐`)
  console.log(`│ ONE-TIME PASSWORD (shown once — also written to the file below) │`)
  console.log(`│                                                              │`)
  console.log(`│   ${oneTimePassword}   │`)
  console.log(`│                                                              │`)
  console.log(`│ Sign in, then change it immediately: Settings → Account.     │`)
  console.log(`└──────────────────────────────────────────────────────────────┘`)
  console.log(`  file: ${outPath} (chmod 600) — delete it after changing the password.`)
}

main().catch((err) => {
  console.error(`[${SCRIPT_NAME}] FAILED: ${(err as Error).message}`)
  process.exit(1)
})
