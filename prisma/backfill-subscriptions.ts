/**
 * backfill-subscriptions — SaaS-HARDENING one-time (idempotent) backfill.
 *
 * Creates a SchoolSubscription row for every school that has none.
 * Honest defaults: status ACTIVE, plan mirrors the School.plan column,
 * periodEnd null (no expiry recorded — the platform has never billed
 * these tenants; the first recorded payment or platform state change
 * becomes the audited truth from that point on).
 *
 * Run: DATABASE_URL=<pg> bun prisma/backfill-subscriptions.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const missing = await db.school.findMany({
    where: { subscription: null },
    select: { id: true, plan: true, createdAt: true },
  })
  if (missing.length === 0) {
    console.log('[backfill-subscriptions] nothing to do — every school already has a subscription row')
    return
  }
  for (const school of missing) {
    await db.schoolSubscription.create({
      data: {
        schoolId: school.id,
        status: 'ACTIVE',
        plan: school.plan,
        periodStart: school.createdAt,
        periodEnd: null, // honest: no expiry recorded yet
      },
    })
  }
  console.log(
    `[backfill-subscriptions] created ${missing.length} subscription row(s); ` +
      `status ACTIVE, periodEnd null (no billing history fabricated)`,
  )
}

main()
  .catch((e) => {
    console.error('[backfill-subscriptions] failed:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
