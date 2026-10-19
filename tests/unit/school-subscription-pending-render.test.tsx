/**
 * tests/unit/school-subscription-pending-render.test.tsx
 *
 * REGRESSION (P0, 2026-10-19): the school-detail workspace's Subscription
 * tab crashed the WHOLE console page ("This console page hit an
 * unexpected error" — the (console) error boundary) on every deployment
 * whose database has not yet applied the owner-gated subscription
 * migration 20261013183000_subscription_entitlement_system:
 *
 *   TypeError: Cannot read properties of null (reading 'replace')
 *       at SnapshotCard — registryRow.billingModel.replace(/_/g, ' ')
 *
 * ROOT CAUSE: the registry route's honest schema-pending degradation
 * serves the school's row from LEGACY columns only — billingModel,
 * currencySnapshot and paymentCount are NULL on the wire (with
 * subscriptionSchemaPending: true), but the shared RegistryRow type
 * claimed them non-null and the school Subscription tab rendered them
 * unguarded. (The Subscriptions PAGE already handled the exact same
 * pending shape; the school-detail tab did not.)
 *
 * FIX UNDER TEST: RegistryRow is nullable-truthful; the tab renders the
 * pending state honestly (unavailable fields as '—', the billing-model
 * badge only when actually known) instead of crashing.
 *
 * PROVENANCE OF THE FIXTURE: the pending row below is the verbatim wire
 * shape observed live against a faithful pre-migration database clone
 * (the two owner-gated migrations reverted on a LOCAL throwaway copy —
 * production was only ever read). The server-side degradation contract
 * itself is pinned by tests/unit/subscription-schema-pending.test.ts.
 *
 * METHOD: the crash was a RENDER-path crash, so react-dom/server
 * (renderToStaticMarkup) reproduces it exactly — no DOM environment
 * needed. The cards are exercised for the pending shape, the no-row
 * case and the fully-migrated shape (guards must never hide real data).
 */
import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SnapshotCard, PlanBillingCard } from '@/components/platform/modules/school-subscription'
import type { RegistryRow } from '@/components/platform/modules/subscription-shared'
import type { PlatformApiError } from '@/components/platform/platform-client'

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

/** No-op gate — the cards only invoke it from mutation handlers. */
const gate: GateFn = async <T,>(action: () => Promise<T>) => action()

const SCHOOL = {
  id: 'sch_test_pending_1',
  name: 'Green Valley Public School',
  slug: 'green-valley',
  code: 'GVPS',
  status: 'ACTIVE',
  isDemo: false,
}

/** Verbatim pending-shape registry row (observed on the pre-migration DB). */
const PENDING_ROW: RegistryRow = {
  subscriptionId: 'sub_test_pending_1',
  school: SCHOOL,
  billingModel: null,
  plan: 'STANDARD',
  planDef: null,
  planCode: null,
  interval: null,
  priceSnapshot: null,
  currencySnapshot: null,
  periodStart: '2026-10-19T01:48:07.545Z',
  periodEnd: null,
  graceDays: 14,
  overrideStatus: null,
  paymentCount: null,
  entitlement: { state: 'ACTIVE', businessAllowed: true, renewalRequired: false },
}

/** Fully-migrated row — the null-guards must not hide real values. */
const MIGRATED_ROW: RegistryRow = {
  ...PENDING_ROW,
  billingModel: 'SCHOOL_WIDE',
  planDef: { code: 'sch-standard', name: 'School Standard' },
  planCode: 'sch-standard',
  interval: 'ANNUAL',
  priceSnapshot: 12000,
  currencySnapshot: 'INR',
  periodEnd: '2027-10-19T00:00:00.000Z',
  paymentCount: 3,
}

const DATA = {
  school: { id: SCHOOL.id, name: SCHOOL.name, slug: SCHOOL.slug, status: 'ACTIVE' },
  subscription: {
    status: 'ACTIVE',
    plan: 'STANDARD',
    periodStart: '2026-10-19T01:48:07.545Z',
    periodEnd: null,
    graceDays: 14,
    overrideStatus: null,
    notes: null,
  },
  entitlement: {
    state: 'ACTIVE',
    businessAllowed: true,
    renewalRequired: false,
    message: null,
  },
  payments: [],
}

const reload = () => {}

describe('school Subscription tab · schema-pending render (the 2026-10-19 crash regression)', () => {
  test(
    'SnapshotCard renders the pending-shaped registry row WITHOUT throwing',
    () => {
      // Before the fix this exact call threw
      // "Cannot read properties of null (reading 'replace')" and took the
      // whole console page down with the error boundary.
      const html = renderToStaticMarkup(
        <SnapshotCard data={DATA} registryRow={PENDING_ROW} gate={gate} onReload={reload} />,
      )
      expect(html.length).toBeGreaterThan(0)
      // The real computed entitlement state still renders.
      expect(html).toContain('Subscription &amp; entitlement snapshot')
      // The billing-model badge must NOT be fabricated from null.
      expect(html).not.toContain('SCHOOL WIDE')
    },
  )

  test('SnapshotCard renders a NULL registry row (school without a registry row)', () => {
    const html = renderToStaticMarkup(
      <SnapshotCard data={DATA} registryRow={null} gate={gate} onReload={reload} />,
    )
    expect(html).toContain('Subscription &amp; entitlement snapshot')
    expect(html).not.toContain('SCHOOL WIDE')
  })

  test('SnapshotCard still renders the migrated badge when billingModel is REAL', () => {
    const html = renderToStaticMarkup(
      <SnapshotCard data={DATA} registryRow={MIGRATED_ROW} gate={gate} onReload={reload} />,
    )
    expect(html).toContain('SCHOOL WIDE')
    expect(html).toContain('School Standard')
  })

  test('PlanBillingCard renders the pending-shaped row with honest em-dashes', () => {
    const html = renderToStaticMarkup(
      <PlanBillingCard
        schoolId={SCHOOL.id}
        schoolName={SCHOOL.name}
        registryRow={PENDING_ROW}
        legacyPlan="STANDARD"
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('no registry plan applied yet')
    // Unavailable fields degrade to em-dashes — never fabricated values.
    expect(html).toContain('—')
    expect(html).not.toContain('school wide')
  })

  test('PlanBillingCard renders real registry values when migrated', () => {
    const html = renderToStaticMarkup(
      <PlanBillingCard
        schoolId={SCHOOL.id}
        schoolName={SCHOOL.name}
        registryRow={MIGRATED_ROW}
        legacyPlan="STANDARD"
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html).toContain('School Standard')
    expect(html).toContain('SCHOOL WIDE')
    expect(html).toContain('₹12,000')
    expect(html).toContain('annual')
  })

  test('PlanBillingCard renders a NULL registry row', () => {
    const html = renderToStaticMarkup(
      <PlanBillingCard
        schoolId={SCHOOL.id}
        schoolName={SCHOOL.name}
        registryRow={null}
        legacyPlan="STANDARD"
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html).toContain('Plan &amp; billing')
  })
})

// Type-level regression (compile-time, enforced by tsc in CI): the shared
// RegistryRow contract must accept the pending wire shape. This const is
// never read — it exists so a future narrowing back to non-nullable
// fields fails typecheck here.
const _typeContractAcceptsPendingShape: RegistryRow = PENDING_ROW
const _gateFnAcceptsPlatformApiErrorShape: PlatformApiError | null = null
void _typeContractAcceptsPendingShape
void _gateFnAcceptsPlatformApiErrorShape
