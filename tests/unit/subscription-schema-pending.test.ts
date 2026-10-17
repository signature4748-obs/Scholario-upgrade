/**
 * SUBSCRIPTION-SCHEMA PENDING — the honest-degradation core (unit).
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. isSubscriptionSchemaPendingError classifies EXACTLY the Prisma
 *      errors caused by the pending owner-gated migration
 *      20261013183000_subscription_entitlement_system:
 *        · P2021 (table does not exist) for its 6 new tables — bare AND
 *          schema-qualified meta.table;
 *        · P2022 (column does not exist) for its 6 new
 *          SchoolSubscription columns — also when surfaced through a
 *          relation select (modelName "School");
 *        · P2010 (raw query failed) whose underlying Postgres error names
 *          the pending platform_payment_receipt_seq sequence.
 *      Everything else — other tables, other columns, other P2010s,
 *      connectivity errors, plain Errors — returns FALSE (fail-closed
 *      the other way: a real error keeps its normal classification and
 *      is never masked as "schema pending").
 *
 *   2. classifyError converts a pending-shape Prisma error to the typed,
 *      safe SUBSCRIPTION_SYSTEM_PENDING envelope (503) instead of a raw
 *      DATABASE_FAILURE 500 — while non-pending Prisma errors keep the
 *      generic classification.
 */
import { describe, test, expect } from 'bun:test'

import {
  isSubscriptionSchemaPendingError,
  __resetSubscriptionSchemaProbeForTests,
} from '@/lib/platform/subscription-schema'
import { classifyError, STATUS_BY_CODE } from '@/lib/security/errors'

function prismaError(code: string, meta: Record<string, unknown>, message = 'db error') {
  return Object.assign(new Error(message), { code, meta })
}

describe('isSubscriptionSchemaPendingError', () => {
  test('P2021 on a pending-migration table (schema-qualified) → true', () => {
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'public.ActivationCode' })),
    ).toBe(true)
  })

  test('P2021 on a pending-migration table (bare name) → true', () => {
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'SubscriptionPlan' }))).toBe(true)
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'StudentEntitlement' }))).toBe(true)
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'SubscriptionOrder' }))).toBe(true)
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'ActivationCodeEvent' }))).toBe(true)
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'StudentSubscriptionPayment' })),
    ).toBe(true)
  })

  test('P2021 on a NON-pending table → false (never masked)', () => {
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'public.School' }))).toBe(false)
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', { table: 'User' }))).toBe(false)
    expect(isSubscriptionSchemaPendingError(prismaError('P2021', {}))).toBe(false)
  })

  test('P2022 on a pending SchoolSubscription column → true (incl. relation modelName)', () => {
    expect(
      isSubscriptionSchemaPendingError(
        prismaError('P2022', { modelName: 'School', column: 'SchoolSubscription.planCode' }),
      ),
    ).toBe(true)
    expect(
      isSubscriptionSchemaPendingError(
        prismaError('P2022', { modelName: 'SchoolSubscription', column: 'SchoolSubscription.billingModel' }),
      ),
    ).toBe(true)
    for (const col of [
      'SchoolSubscription.currencySnapshot',
      'SchoolSubscription.interval',
      'SchoolSubscription.planId',
      'SchoolSubscription.priceSnapshot',
    ]) {
      expect(isSubscriptionSchemaPendingError(prismaError('P2022', { column: col }))).toBe(true)
    }
  })

  test('P2022 with UNQUALIFIED column (INSERT/UPSERT/direct-select shape) → true for the two pending-column models', () => {
    // Verified live against the faithful pre-migration database: Prisma
    // reports the BARE column name when the failing operation targets the
    // model itself (INSERT column list / RETURNING, or a direct model
    // select), and the table-qualified form through relation selects.
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2022', { modelName: 'SchoolSubscription', column: 'billingModel' })),
    ).toBe(true)
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2022', { modelName: 'PlatformSetting', column: 'subscriptionConfig' })),
    ).toBe(true)
    // A same-named missing column on a DIFFERENT model stays unmasked.
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2022', { modelName: 'Timetable', column: 'interval' })),
    ).toBe(false)
  })

  test('P2022 on a NON-pending column → false', () => {
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2022', { column: 'School.name' })),
    ).toBe(false)
    expect(
      isSubscriptionSchemaPendingError(prismaError('P2022', { column: 'SchoolSubscription.status' })),
    ).toBe(false)
    expect(isSubscriptionSchemaPendingError(prismaError('P2022', {}))).toBe(false)
  })

  test('P2010 naming the pending receipt sequence → true', () => {
    expect(
      isSubscriptionSchemaPendingError(
        Object.assign(new Error('db query failed: relation "platform_payment_receipt_seq" does not exist'), {
          code: 'P2010',
        }),
      ),
    ).toBe(true)
  })

  test('P2010 for other reasons → false; non-Prisma shapes → false', () => {
    expect(
      isSubscriptionSchemaPendingError(Object.assign(new Error('db query failed: timeout'), { code: 'P2010' })),
    ).toBe(false)
    expect(isSubscriptionSchemaPendingError(new Error('P2021'))).toBe(false)
    expect(isSubscriptionSchemaPendingError(null)).toBe(false)
    expect(isSubscriptionSchemaPendingError(undefined)).toBe(false)
    // No meta = the table is unknowable → fail-closed false (a real error
    // keeps its normal classification instead of being masked as pending).
    expect(isSubscriptionSchemaPendingError({ code: 'P2021' })).toBe(false)
  })
})

describe('classifyError → SUBSCRIPTION_SYSTEM_PENDING envelope', () => {
  test('pending-shape P2022 becomes the typed 503 error', () => {
    const c = classifyError(
      prismaError('P2022', { modelName: 'School', column: 'SchoolSubscription.planCode' }),
      'req-test-1',
    )
    expect(c.code).toBe('SUBSCRIPTION_SYSTEM_PENDING')
    expect(c.status).toBe(503)
    expect(c.publicMessage).toContain('pending subscription-system migration')
    expect(c.internalDetail).toContain('P2022')
  })

  test('pending-shape P2021 becomes the typed 503 error', () => {
    const c = classifyError(prismaError('P2021', { table: 'public.ActivationCode' }), 'req-test-2')
    expect(c.code).toBe('SUBSCRIPTION_SYSTEM_PENDING')
    expect(c.status).toBe(503)
  })

  test('non-pending Prisma engine errors keep DATABASE_FAILURE (500)', () => {
    // P2022 = column does not exist (P2002 is the unique-conflict code):
    // a NON-subscription missing column keeps the generic engine class.
    const c = classifyError(prismaError('P2022', { column: 'School.name' }), 'req-test-3')
    expect(c.code).toBe('DATABASE_FAILURE')
    expect(c.status).toBe(500)
    const c2 = classifyError(prismaError('P2021', { table: 'public.School' }), 'req-test-4')
    expect(c2.code).toBe('DATABASE_FAILURE')
    expect(c2.status).toBe(500)
  })

  test('STATUS_BY_CODE registers the new code at 503', () => {
    expect(STATUS_BY_CODE['SUBSCRIPTION_SYSTEM_PENDING']).toBe(503)
  })
})

describe('subscriptionSchemaPending probe cache', () => {
  test('test hook resets the cache without error', () => {
    expect(() => __resetSubscriptionSchemaProbeForTests()).not.toThrow()
  })
})
