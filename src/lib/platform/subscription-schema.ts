/**
 * subscription-schema — honest degradation for the pending subscription
 * & entitlement migration (additive, self-healing).
 *
 * SITUATION (verified read-only against production, 2026-10-15): the
 * control-plane code may run AHEAD of the production database. Migration
 * `20261013183000_subscription_entitlement_system` (owner-gated, applied
 * locally + CI, NOT yet applied in production) adds:
 *   · SchoolSubscription columns: billingModel, currencySnapshot,
 *     interval, planCode, planId, priceSnapshot
 *   · Tables: SubscriptionPlan, SubscriptionOrder, StudentEntitlement,
 *     StudentSubscriptionPayment, ActivationCode, ActivationCodeEvent
 *   · Sequence: platform_payment_receipt_seq
 *
 * A deploy that queries those columns/tables against a pre-migration
 * database gets Prisma P2021/P2022 and 500s — which is exactly the
 * reported "Internal server error" on /platform/schools, the broken
 * school-plane sign-in, and every subscription surface.
 *
 * This module makes the READ paths degrade HONESTLY (real data for
 * everything the legacy schema can serve, `subscriptionSchemaPending:
 * true` in the response so the UI can say WHY the rest is unavailable)
 * and gives the central error classifier a typed, safe error
 * (SUBSCRIPTION_SYSTEM_PENDING, 503) for anything not individually
 * hardened. NOTHING is faked: no invented plans, counts or states — the
 * flag is the truth, the omitted fields are null, and the owner's
 * migration restores full functionality without a redeploy (the probe
 * below re-checks on a short TTL).
 */

// Tables created ONLY by the pending migrations. P2021 meta carries them
// schema-qualified (e.g. "public.ActivationCode").
const PENDING_MIGRATION_TABLES = new Set([
  'SubscriptionPlan',
  'SubscriptionOrder',
  'StudentEntitlement',
  'StudentSubscriptionPayment',
  'ActivationCode',
  'ActivationCodeEvent',
  // STAFF ENTITLEMENTS + BATCH CODES (2026-10-30).
  'StaffEntitlement',
  'StaffSubscriptionPayment',
])

// Columns created ONLY by the pending migration, per table. P2022 meta
// carries them table-qualified when surfaced through a relation select
// (modelName "School", column "SchoolSubscription.planCode") but BARE
// when the failing operation targets the model itself (findMany select
// on SchoolSubscription, or an INSERT/UPSERT whose generated column
// list / RETURNING references the missing column — verified shapes:
// {modelName:"SchoolSubscription", column:"billingModel"}).
const PENDING_MIGRATION_COLUMNS = new Set([
  'SchoolSubscription.billingModel',
  'SchoolSubscription.currencySnapshot',
  'SchoolSubscription.interval',
  'SchoolSubscription.planCode',
  'SchoolSubscription.planId',
  'SchoolSubscription.priceSnapshot',
  // STAFF ENTITLEMENTS (2026-10-30) — the staff-licensing policy column.
  'SchoolSubscription.staffCoverage',
  // PlatformSetting.subscriptionConfig is added by the SAME pending
  // migration (the commercial-model config storage).
  'PlatformSetting.subscriptionConfig',
])
// Bare column names for the two models above (used when meta.column is
// unqualified — INSERT/UPSERT/direct-select failure shapes).
const PENDING_BARE_COLUMNS_BY_MODEL: Record<string, Set<string>> = {
  SchoolSubscription: new Set([
    'billingModel',
    'currencySnapshot',
    'interval',
    'planCode',
    'planId',
    'priceSnapshot',
    'staffCoverage',
  ]),
  PlatformSetting: new Set(['subscriptionConfig']),
}

function bareTableName(table: string | undefined): string {
  if (!table) return ''
  return table.startsWith('public.') ? table.slice('public.'.length) : table
}

/**
 * Is this thrown error a Prisma P2021/P2022 caused by the pending
 * subscription migration? Used both by the hardened GET routes (to pick
 * the legacy query shape) and by classifyPrisma (to convert the raw 500
 * into the honest SUBSCRIPTION_SYSTEM_PENDING envelope).
 *
 * Fail-closed the other way: anything NOT clearly a
 * pending-migration-missing-object error returns false and keeps its
 * normal classification (a connectivity error is NOT "schema pending").
 */
export function isSubscriptionSchemaPendingError(e: unknown): boolean {
  const err = e as {
    code?: string
    message?: string
    meta?: { table?: string; column?: string }
  }
  if (!err || typeof err.code !== 'string') return false
  if (err.code === 'P2021') {
    return PENDING_MIGRATION_TABLES.has(bareTableName(err.meta?.table))
  }
  if (err.code === 'P2022') {
    const column = err.meta?.column ?? ''
    if (PENDING_MIGRATION_COLUMNS.has(column)) return true
    // Unqualified shape: only the missing column's NAME — trust it only
    // when the failing model is one of the two known pending-column
    // tables (a different model missing a same-named column keeps its
    // normal classification; never masked as "schema pending").
    if (column && !column.includes('.')) {
      const model = (err.meta as { modelName?: string } | undefined)?.modelName ?? ''
      return PENDING_BARE_COLUMNS_BY_MODEL[model]?.has(column) ?? false
    }
    return false
  }
  // Raw-query failures (P2010) whose underlying Postgres error points at a
  // pending-migration object — the receipt sequences are created by the
  // same migrations (payment application paths fail on them before any
  // typed check).
  if (err.code === 'P2010' && typeof err.message === 'string') {
    return (
      err.message.includes('platform_payment_receipt_seq') ||
      err.message.includes('staff_payment_receipt_seq')
    )
  }
  return false
}

/**
 * Cached probe: is the deployed database missing the subscription-system
 * objects? One `SELECT "planCode" FROM "SchoolSubscription" LIMIT 1`
 * (missing table → P2021, missing column → P2022, healthy → rows).
 * TTL so the owner applying the migration restores full functionality
 * WITHOUT a redeploy/restart. Probe errors that are NOT
 * pending-migration-shaped (connectivity…) are reported as
 * NOT pending — the real error then surfaces through its normal
 * classification instead of being masked.
 */
let probeCache: { pending: boolean; at: number } | null = null
const PROBE_TTL_MS = 60_000

export async function subscriptionSchemaPending(): Promise<boolean> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return probeCache.pending
  }
  let pending = false
  try {
    const { db } = await import('@/lib/db')
    await db.schoolSubscription.findMany({ select: { planCode: true }, take: 1 })
  } catch (e) {
    pending = isSubscriptionSchemaPendingError(e)
  }
  probeCache = { pending, at: Date.now() }
  return pending
}

/** Test hook: drop the probe cache (bun test resets module state). */
export function __resetSubscriptionSchemaProbeForTests(): void {
  probeCache = null
}

// ── Shared query shapes ────────────────────────────────────────────────

/**
 * The SchoolSubscription fields that exist in BOTH the pre-migration and
 * post-migration schema — the entitlement evaluator's complete input set
 * (status/plan/periodEnd/graceDays/overrideStatus) plus periodStart and
 * notes for display. Selecting exactly these works everywhere.
 */
export const SUBSCRIPTION_LEGACY_SELECT = {
  status: true,
  plan: true,
  periodStart: true,
  periodEnd: true,
  graceDays: true,
  overrideStatus: true,
  notes: true,
} as const

/** Legacy fields + billingModel (the per-student gate input) +
 *  staffCoverage (the per-seat staff gate input, 2026-10-30). */
export const SUBSCRIPTION_SESSION_SELECT = {
  ...SUBSCRIPTION_LEGACY_SELECT,
  billingModel: true,
  staffCoverage: true,
} as const

/** Legacy fields + the directory chip columns. */
export const SUBSCRIPTION_DIRECTORY_SELECT = {
  ...SUBSCRIPTION_LEGACY_SELECT,
  planCode: true,
  billingModel: true,
} as const

/**
 * Load a school's subscription snapshot through the pending-migration
 * safe path. Try the richer select first (post-migration databases);
 * on a pending-shape P2021/P2022 retry with the legacy select and report
 * `schemaPending` so callers can flag their response honestly.
 */
export async function loadSchoolSubscriptionSnapshot(
  schoolId: string,
): Promise<{ snapshot: Record<string, unknown> | null; schemaPending: boolean }> {
  const { db } = await import('@/lib/db')
  try {
    const snapshot = await db.schoolSubscription.findUnique({
      where: { schoolId },
      select: { ...SUBSCRIPTION_SESSION_SELECT },
    })
    return { snapshot, schemaPending: false }
  } catch (e) {
    if (!isSubscriptionSchemaPendingError(e)) throw e
    const snapshot = await db.schoolSubscription.findUnique({
      where: { schoolId },
      select: { ...SUBSCRIPTION_LEGACY_SELECT },
    })
    return { snapshot, schemaPending: true }
  }
}
