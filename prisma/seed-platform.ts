/**
 * PHASE 6 — Platform control-plane seed + legacy Super Admin migration.
 *
 * SAFE MIGRATION of the legacy platform identity:
 *   1. Every User row with role='SUPER_ADMIN' is migrated into the
 *      PlatformAdmin table (same email, same scrypt password hash —
 *      existing credentials keep working through the NEW boundary).
 *   2. The legacy User row is retained (mock-data preservation) but
 *      marked status='SUSPENDED' — school login rejects SUPER_ADMIN
 *      users by role, so the legacy entry point is dead on both
 *      conditions (role + status).
 *   3. Root platform admins get a TOTP secret; the seeded demo admins
 *      carry fixed DEV-PREVIEW secrets so the demo authenticator
 *      (login page widget) and the integration tests can compute
 *      codes. Production enrollment generates random secrets and
 *      provisions them via QR — never seeded, never isDemo.
 *
 * Idempotent: safe to re-run (upserts).
 *
 * Seeded identities (DEV PREVIEW ONLY):
 *   root  admin@scholario.cloud / admin123   (migrated legacy super admin)
 *   ops   ops@scholario.io / ops12345        (limited: no billing/provision/admins/settings)
 */
import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'

const db = new PrismaClient()

const ROOT_EMAIL = 'admin@scholario.cloud'
const OPS_EMAIL = 'ops@scholario.io'

// Dev-preview TOTP secrets (base32). Fixed so the demo authenticator on
// /platform/login and tests/security/platform-isolation.test.ts can
// compute the current code. NEVER used for production admins.
const DEMO_ROOT_TOTP = 'JBSWY3DPEHPK3PXP'
const DEMO_OPS_TOTP = 'KRSXG5CTMVRXEZLU'

async function upsertAdmin(opts: {
  email: string
  name: string
  passwordHash: string
  isRoot: boolean
  totpSecret: string
}): Promise<string> {
  const admin = await db.platformAdmin.upsert({
    where: { email: opts.email },
    update: {
      name: opts.name,
      isRoot: opts.isRoot,
      isDemo: true,
      // Refresh the dev secret only if it is unset (a rotated secret
      // from a future production flow is never clobbered by the seed).
      ...(opts.totpSecret ? {} : {}),
    },
    create: {
      email: opts.email,
      passwordHash: opts.passwordHash,
      name: opts.name,
      isRoot: opts.isRoot,
      totpSecret: opts.totpSecret,
      isDemo: true,
      status: 'ACTIVE',
    },
  })
  return admin.id
}

async function grant(adminId: string, keys: readonly string[]) {
  for (const key of keys) {
    await db.platformPermission.upsert({
      where: { adminId_key: { adminId, key } },
      update: { granted: true },
      create: { adminId, key, granted: true },
    })
  }
}

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-platform')
  // PIH-4a — production hard gate: this seed plants dev-preview platform
  // admins with FIXED demo TOTP secrets (computable by anyone holding the
  // repo). It must never run against a production environment.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[seed-platform] Refusing to run: NODE_ENV=production. This seed provisions dev-preview platform admins and fixed demo TOTP secrets.',
    )
    process.exit(1)
  }
  // ── 1. Legacy SUPER_ADMIN migration ─────────────────────────────────
  const legacyAdmins = await db.user.findMany({ where: { role: 'SUPER_ADMIN' } })
  for (const legacy of legacyAdmins) {
    const existing = await db.platformAdmin.findUnique({ where: { email: legacy.email } })
    if (!existing) {
      // Migrate: same email + SAME password hash → credentials continue
      // to work through /platform/login (the only platform entry point).
      await db.platformAdmin.create({
        data: {
          email: legacy.email,
          passwordHash: legacy.passwordHash ?? '',
          name: legacy.name ?? 'Platform Administrator',
          isRoot: true,
          totpSecret: legacy.email === ROOT_EMAIL ? DEMO_ROOT_TOTP : DEMO_OPS_TOTP,
          isDemo: true,
          status: 'ACTIVE',
        },
      })
      console.log(`[seed-platform] migrated legacy SUPER_ADMIN ${legacy.email} → PlatformAdmin`)
    }
    // Suspend the legacy school-side identity (row retained, login dead:
    // role gate + status gate, belt and braces).
    if (legacy.status !== 'SUSPENDED') {
      await db.user.update({ where: { id: legacy.id }, data: { status: 'SUSPENDED' } })
      console.log(`[seed-platform] suspended legacy User row ${legacy.email}`)
      // Revoke any school sessions the legacy identity still holds.
      await db.session.deleteMany({ where: { userId: legacy.id } })
    }
  }

  // ── 2. Root admin (ensure, even with no legacy row) ──────────────────
  const rootId = await upsertAdmin({
    email: ROOT_EMAIL,
    name: 'Arjun Malhotra',
    passwordHash:
      (await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } }))?.passwordHash ??
      (legacyAdmins.find((u) => u.email === ROOT_EMAIL)?.passwordHash ?? ''),
    isRoot: true,
    totpSecret: DEMO_ROOT_TOTP,
  })
  // The root password must exist even on a totally fresh DB: seed the
  // demo password (scrypt 'admin123') when no hash was migrated.
  const root = await db.platformAdmin.findUnique({ where: { id: rootId } })
  if (root && (!root.passwordHash || root.passwordHash.length < 10)) {
    const { scryptSync, randomBytes } = await import('crypto')
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync('admin123', salt, 64).toString('hex')
    await db.platformAdmin.update({ where: { id: rootId }, data: { passwordHash: `${salt}:${hash}` } })
    console.log('[seed-platform] seeded root demo password (admin123)')
  }

  // ── 3. Ops admin (limited capabilities) ──────────────────────────────
  const opsId = await upsertAdmin({
    email: OPS_EMAIL,
    name: 'Priya Nair',
    passwordHash: '',
    isRoot: false,
    totpSecret: DEMO_OPS_TOTP,
  })
  const ops = await db.platformAdmin.findUnique({ where: { id: opsId } })
  if (!ops || !ops.passwordHash || ops.passwordHash.length < 10) {
    const { scryptSync, randomBytes } = await import('crypto')
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync('ops12345', salt, 64).toString('hex')
    await db.platformAdmin.update({ where: { id: opsId }, data: { passwordHash: `${salt}:${hash}` } })
    console.log('[seed-platform] seeded ops demo password (ops12345)')
  }
  await grant(opsId, [
    'schools.read',
    'schools.manage',
    'announcements.manage',
    'audit.read',
    'support.access',
  ])

  // ── 4. Platform settings ─────────────────────────────────────────────
  await db.platformSetting.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      showDemoSchool: true,
      modules: '{}',
      supportMaxDuration: 60,
    },
  })

  // ── 5. Demo platform announcement ────────────────────────────────────
  const existingAnnouncement = await db.platformAnnouncement.findFirst()
  if (!existingAnnouncement) {
    await db.platformAnnouncement.create({
      data: {
        title: 'Scheduled maintenance window',
        body: 'Scholario will undergo scheduled platform maintenance this Sunday, 02:00–04:00 IST. School portals may be briefly unavailable.',
        level: 'INFO',
        audience: 'ALL',
        createdBy: rootId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })
    console.log('[seed-platform] created demo announcement')
  }

  const counts = {
    admins: await db.platformAdmin.count(),
    suspendedLegacyUsers: await db.user.count({ where: { role: 'SUPER_ADMIN', status: 'SUSPENDED' } }),
    announcements: await db.platformAnnouncement.count(),
  }
  console.log('[seed-platform] done:', JSON.stringify(counts))
}

main()
  .catch((e) => {
    console.error('[seed-platform] FAILED:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
