/**
 * gen-credential-report — the SECURE credential delivery mechanism
 * (final-acceptance Phase 11).
 *
 * Generates the demo-account credential report OUTSIDE the Git repository
 * (default /home/z/.sec/scholario-demo-credentials.md). The values are the
 * env-driven seed credentials (prisma/seed-credentials.ts — the same
 * source the seeds planted, so the report can never drift from the DB).
 *
 * SAFETY CONTRACT:
 *   · The report file is written OUTSIDE the repo — the script REFUSES any
 *     output path inside the project directory.
 *   · Credentials are NEVER printed to stdout (the run log stays clean).
 *   · The generated file gets chmod 600.
 *   · The repository itself never receives a credential value (this script
 *     is the ONLY writer, and it writes outside the tree).
 *
 * Usage:
 *   bun scripts/gen-credential-report.ts [--out /path/file.md]
 *   (env: SEED_* vars as documented in .env.example; REPORT_OUT override)
 */
import { db } from '../src/lib/db'
import { existsSync, mkdirSync, statSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import path from 'path'
import {
  SEED_DEMO_PASSWORD,
  SEED_PLATFORM_ROOT_PASSWORD,
  SEED_PLATFORM_OPS_PASSWORD,
  SEED_SHOWCASE_PRINCIPAL_PASSWORD,
  SEED_SHOWCASE_STUDENT_PASSWORD,
  SEED_SHOWCASE_TEACHER_PASSWORD,
  SEED_TENANT_FIXTURE_PASSWORD,
} from '../prisma/seed-credentials'
import { DEMO_STUDENT_POSITION } from '../prisma/seed-identity'
import { buildStudentRoster } from '../prisma/hawkings-corpus'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_OUT = '/home/z/.sec/scholario-demo-credentials.md'

function resolveOut(): string {
  const args = process.argv.slice(2)
  const flagIdx = args.indexOf('--out')
  if (flagIdx >= 0 && args[flagIdx + 1]) return path.resolve(args[flagIdx + 1])
  if (process.env.REPORT_OUT) return path.resolve(process.env.REPORT_OUT)
  return DEFAULT_OUT
}

function assertOutsideRepo(outPath: string): void {
  const resolved = realpathSync(path.dirname(outPath))
  if (resolved === PROJECT_ROOT || resolved.startsWith(PROJECT_ROOT + path.sep)) {
    console.error('[gen-credential-report] REFUSING: the credential report must live OUTSIDE the repository.')
    process.exit(1)
  }
}

async function main() {
  const outPath = resolveOut()
  assertOutsideRepo(outPath)

  const school = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!school) throw new Error('hawkings-prithvipur not found — run the seed pipeline first')

  const users = await db.user.findMany({
    where: { status: 'ACTIVE', schoolId: school.id },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
    select: { email: true, name: true, role: true, subscriptionStatus: true, student: { select: { classId: true, rollNo: true } } },
  })
  const classes = await db.class.findMany({ where: { schoolId: school.id }, select: { id: true, name: true } })
  const classNameById = new Map(classes.map((c) => [c.id, c.name]))

  const platformAdmins = await db.platformAdmin.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { email: 'asc' },
    select: { email: true, name: true, isRoot: true, isDemo: true },
  })

  // Credential family resolution — the SAME env-driven rules the seeds
  // planted (prisma/seed-credentials.ts + prisma/seed.ts):
  const featured = buildStudentRoster().find(
    (s) => s.level === DEMO_STUDENT_POSITION.level && s.idx === DEMO_STUDENT_POSITION.idx,
  )
  const featuredEmail = featured?.studentEmail ?? 'aman.sah@hawkingshigh.edu'
  const passwordFor = (email: string, role: string): string => {
    if (role === 'PRINCIPAL' && email === 'principal@hawkingshigh.edu') return SEED_SHOWCASE_PRINCIPAL_PASSWORD
    if (role === 'TEACHER' && email === 'teacher1@hawkingshigh.edu') return SEED_SHOWCASE_TEACHER_PASSWORD
    if (role === 'STUDENT' && email === featuredEmail) return SEED_SHOWCASE_STUDENT_PASSWORD
    return SEED_DEMO_PASSWORD
  }

  const counts = {
    principal: users.filter((u) => u.role === 'PRINCIPAL').length,
    management: users.filter((u) => u.role === 'MANAGEMENT').length,
    teacher: users.filter((u) => u.role === 'TEACHER').length,
    student: users.filter((u) => u.role === 'STUDENT').length,
    parent: users.filter((u) => u.role === 'PARENT').length,
    locked: users.filter((u) => u.subscriptionStatus === 'LOCKED').length,
    platform: platformAdmins.length,
  }

  const lines: string[] = []
  lines.push('# SCHOLARIO — DEMO ACCOUNT CREDENTIALS (SECURE ARTIFACT)')
  lines.push('')
  lines.push('**Generated:** ' + new Date().toISOString())
  lines.push('**Tenant:** ' + school.name + ' (slug `' + school.slug + '`, isDemo)')
  lines.push('')
  lines.push('> This file is generated OUTSIDE the Git repository by `scripts/gen-credential-report.ts`.')
  lines.push('> It is the ONLY place demo credentials are delivered. Never commit, copy, or screenshot it.')
  lines.push('> Values come from the env-driven seed mechanism (`prisma/seed-credentials.ts`) — rotate by')
  lines.push('> setting `SEED_*` variables and re-seeding.')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Metric | Count |')
  lines.push('| --- | --- |')
  lines.push(`| Total active school accounts | ${users.length} |`)
  lines.push(`| Principals | ${counts.principal} |`)
  lines.push(`| Management (office) | ${counts.management} |`)
  lines.push(`| Teachers | ${counts.teacher} |`)
  lines.push(`| Students | ${counts.student} |`)
  lines.push(`| Parents | ${counts.parent} |`)
  lines.push(`| Subscription-LOCKED accounts | ${counts.locked} |`)
  lines.push(`| Platform admins | ${counts.platform} |`)
  lines.push('')
  lines.push('## Key accounts (distinct password families)')
  lines.push('')
  lines.push('| Account | Email | Password |')
  lines.push('| --- | --- | --- |')
  lines.push(`| Principal (featured) | principal@hawkingshigh.edu | \`${SEED_SHOWCASE_PRINCIPAL_PASSWORD}\` |`)
  lines.push(`| Teacher (featured) | teacher1@hawkingshigh.edu | \`${SEED_SHOWCASE_TEACHER_PASSWORD}\` |`)
  lines.push(`| Student (featured, 7-A) | ${featuredEmail} | \`${SEED_SHOWCASE_STUDENT_PASSWORD}\` |`)
  lines.push(`| Every other school account | (tables below) | \`${SEED_DEMO_PASSWORD}\` |`)
  lines.push(`| Tenant-isolation fixtures | tenant.*@hawkings.test | \`${SEED_TENANT_FIXTURE_PASSWORD}\` |`)
  lines.push('')

  for (const role of ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'STUDENT', 'PARENT']) {
    const rows = users.filter((u) => u.role === role)
    if (rows.length === 0) continue
    lines.push(`## ${role} (${rows.length})`)
    lines.push('')
    if (role === 'STUDENT') {
      lines.push('| Name | Email | Class | Roll | Password | Locked |')
      lines.push('| --- | --- | --- | --- | --- | --- |')
      for (const u of rows) {
        const cls = u.student?.classId ? classNameById.get(u.student.classId) ?? '—' : '—'
        lines.push(
          `| ${u.name ?? ''} | ${u.email} | ${cls} | ${u.student?.rollNo ?? '—'} | \`${passwordFor(u.email, u.role)}\` | ${u.subscriptionStatus === 'LOCKED' ? '**YES**' : '—'} |`,
        )
      }
    } else {
      lines.push('| Name | Email | Password | Locked |')
      lines.push('| --- | --- | --- | --- |')
      for (const u of rows) {
        lines.push(
          `| ${u.name ?? ''} | ${u.email} | \`${passwordFor(u.email, u.role)}\` | ${u.subscriptionStatus === 'LOCKED' ? '**YES**' : '—'} |`,
        )
      }
    }
    lines.push('')
  }

  lines.push('## Platform control plane (/platform)')
  lines.push('')
  lines.push('| Name | Email | Password | Role |')
  lines.push('| --- | --- | --- | --- |')
  for (const a of platformAdmins) {
    const pw = a.isRoot ? SEED_PLATFORM_ROOT_PASSWORD : SEED_PLATFORM_OPS_PASSWORD
    lines.push(`| ${a.name ?? ''} | ${a.email} | \`${pw}\` | ${a.isRoot ? 'root (all permissions)' : 'ops (limited)'} |`)
  }
  lines.push('')
  lines.push('MFA: platform logins require a TOTP code. The seeded demo admins carry the env-driven dev')
  lines.push('secrets (`SEED_PLATFORM_ROOT_TOTP` / `SEED_PLATFORM_OPS_TOTP`, defaults documented in')
  lines.push('prisma/seed-credentials.ts). Compute the current code with any authenticator using that secret.')
  lines.push('')
  lines.push('## Subscription-locked accounts (Phase 10)')
  lines.push('')
  const locked = users.filter((u) => u.subscriptionStatus === 'LOCKED')
  lines.push(`These ${locked.length} accounts authenticate normally and can read their profile (name, guardian,`)
  lines.push('contact, enrollment) — every module API rejects them with SUBSCRIPTION_REQUIRED:')
  lines.push('')
  for (const u of locked) {
    lines.push(`- ${u.name ?? ''} \`${u.email}\` (${u.role}${u.student?.classId ? ', ' + (classNameById.get(u.student.classId) ?? '') : ''})`)
  }
  lines.push('')

  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(outPath, 0o600)
  const size = existsSync(outPath) ? statSync(outPath).size : 0
  console.log(`[gen-credential-report] ${users.length} school accounts + ${platformAdmins.length} platform admins → ${outPath} (${size} bytes, chmod 600)`)
  console.log('[gen-credential-report] credential values are in the FILE ONLY — never printed here.')
}

main()
  .catch((e) => {
    console.error('[gen-credential-report] FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
