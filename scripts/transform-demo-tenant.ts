/**
 * transform-demo-tenant — the PRODUCTION demo-tenant transform (final
 * acceptance): renames/rebuilds the production demo tenant as
 * HAWKINGS HIGH SCHOOL PRITHVIPUR while PRESERVING the tenant id.
 *
 * WHAT IT DOES (single command, explicit double opt-in):
 *
 *   1. Guard: refuses to run unless DATABASE_ENV=production AND
 *      SCHOLARIO_DEMO_TRANSFORM_CONSENT carries the exact literal
 *      (prisma/seed-guard.ts) — accidental runs stay impossible.
 *   2. Locates the demo tenant (isDemo=true — exactly one must exist).
 *   3. PRE-TRANSFORM: deletes the School row inside a transaction — the
 *      FK cascade graph wipes every dependent row (users, students,
 *      classes, marks, fees, ledger, sessions, …) — then recreates the
 *      row with the SAME id and the Hawkings identity. Tenant-id
 *      coherence: the FK-free platform references (PlatformAuditLog
 *      schoolId scope, the platform ledger) keep pointing at the same
 *      tenant; the demo school's own TenantDomain mappings are removed
 *      with the row (a rebranded school re-onboards its domains).
 *   4. Runs the canonical 12-step seed pipeline (prisma/seed-demo.ts)
 *      with the same consent env — seed.ts reuses the preserved school
 *      row (update-in-place branch) and plants the full Hawkings corpus.
 *   5. Regenerates the secure credential report (outside the repo) from
 *      the SAME env-driven values the seeds just planted.
 *
 * Run (production only):
 *   DATABASE_ENV=production \
 *   SCHOLARIO_DEMO_TRANSFORM_CONSENT=I-INTENTIONALLY-TRANSFORM-THE-PRODUCTION-DEMO-TENANT \
 *   DATABASE_URL=postgresql://... \
 *   SEED_DEMO_PASSWORD=... SEED_SHOWCASE_...=... SEED_PLATFORM_...=... \
 *   bun scripts/transform-demo-tenant.ts
 */
import { PrismaClient } from '@prisma/client'
import { spawn } from 'child_process'
import { DEMO_TRANSFORM_CONSENT_LITERAL } from '../prisma/seed-guard'
import {
  DEMO_SCHOOL_CODE,
  DEMO_SCHOOL_DOMAIN,
  DEMO_SCHOOL_NAME,
  DEMO_SCHOOL_SLUG,
} from '../prisma/seed-identity'

const db = new PrismaClient()

const PROJECT_ROOT = new URL('..', import.meta.url).pathname

function fail(msg: string): never {
  console.error(`[transform-demo-tenant] REFUSING: ${msg}`)
  process.exit(1)
}

async function main() {
  // ── 1. The double opt-in guard ────────────────────────────────────────
  const env = (process.env.DATABASE_ENV ?? '').trim()
  const consent = (process.env.SCHOLARIO_DEMO_TRANSFORM_CONSENT ?? '').trim()
  if (env !== 'production') {
    fail('DATABASE_ENV must be explicitly "production" for the demo-tenant transform.')
  }
  if (consent !== DEMO_TRANSFORM_CONSENT_LITERAL) {
    fail('SCHOLARIO_DEMO_TRANSFORM_CONSENT must carry the exact consent literal (see prisma/seed-guard.ts).')
  }

  // ── 2. Locate the demo tenant ─────────────────────────────────────────
  const demoSchools = await db.school.findMany({ where: { isDemo: true } })
  if (demoSchools.length !== 1) {
    fail(`expected exactly ONE isDemo school, found ${demoSchools.length} — refusing to guess.`)
  }
  const old = demoSchools[0]
  const beforeCounts = {
    users: await db.user.count({ where: { schoolId: old.id } }),
    students: await db.student.count({ where: { schoolId: old.id } }),
    classes: await db.class.count({ where: { schoolId: old.id } }),
  }
  console.log(`[transform] demo tenant located: ${old.name} (${old.slug}, id ${old.id.slice(0, 10)}…)`)
  console.log(`[transform] dependents to replace: ${JSON.stringify(beforeCounts)}`)

  // ── 3. Pre-transform: cascade-wipe + recreate the row (SAME id) ───────
  await db.$transaction(async (tx) => {
    // The cascade graph does the scoped wipe (users → sessions, classes →
    // marks, fees → ledger, tenant domains, …).
    await tx.school.delete({ where: { id: old.id } })
    // Recreate with the SAME id + the Hawkings identity (reset content —
    // the pipeline seeds re-plant everything).
    await tx.school.create({
      data: {
        id: old.id,
        name: DEMO_SCHOOL_NAME,
        slug: DEMO_SCHOOL_SLUG,
        code: DEMO_SCHOOL_CODE,
        domain: DEMO_SCHOOL_DOMAIN,
        address: 'Hawkings High School, Ward 3, Main Market Road, Prithvipur, Ghazipur, Uttar Pradesh — 233226, India',
        city: 'Prithvipur',
        phone: '+91 94152 22100',
        email: 'office@hawkingshigh.edu',
        themeColor: '#0f766e',
        accentColor: '#f59e0b',
        plan: 'ENTERPRISE',
        status: 'ACTIVE',
        academicYear: '2026-2027',
        board: 'CBSE',
        isDemo: true,
        featureFlags: '{}',
        settings: '{}',
        websiteContent: '{}',
        shortName: 'Hawkings High',
        tagline: 'Knowledge · Character · Service',
        affiliation: 'CBSE (Patna Region)',
        website: 'https://hawkingshigh.edu',
        principalName: 'Dr. (Smt.) Sunita Verma',
        established: '2004',
        createdAt: old.createdAt,
        updatedAt: new Date(),
      },
    })
  })
  console.log(`[transform] tenant id PRESERVED (${old.id.slice(0, 10)}…) — identity → ${DEMO_SCHOOL_NAME}`)

  // FK-free references stay coherent (the audit ledger):
  const auditRows = await db.platformAuditLog.count({ where: { schoolId: old.id } })
  console.log(`[transform] platform audit rows still referencing the preserved tenant id: ${auditRows}`)

  await db.$disconnect()

  // ── 4. Run the canonical pipeline with the same consent env ──────────
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bun', ['prisma/seed-demo.ts'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: 'inherit',
    })
    child.on('error', (e) => reject(new Error(`pipeline spawn failed: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`seed-demo exited ${code} — the transform is incomplete; re-run to restore canonical state.`))
    })
  })

  // ── 5. Secure credential report (outside the repo) ────────────────────
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bun', ['scripts/gen-credential-report.ts'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: 'inherit',
    })
    child.on('error', (e) => reject(new Error(`report spawn failed: ${e.message}`)))
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`report exited ${code}`))))
  })

  console.log('[transform] COMPLETE — production demo tenant is now Hawkings High School Prithvipur.')
}

main()
  .catch((e) => {
    console.error('[transform-demo-tenant] FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
