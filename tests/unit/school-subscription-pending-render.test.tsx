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
 * 2026-10-29 REDESIGN NOTE: the tab was rebuilt as the guided 4-step
 * workflow (SummaryHeader + PlanPricingPanel replace SnapshotCard /
 * PlanBillingCard). The regression class itself must stay pinned: the
 * pending wire shape renders honest em-dashes, never crashes, never
 * fabricates a billing model from null — and the fully-migrated shape
 * still renders every real value.
 *
 * PROVENANCE OF THE FIXTURE: the pending row below is the verbatim wire
 * shape observed live against a faithful pre-migration database clone
 * (the two owner-gated migrations reverted on a LOCAL throwaway copy —
 * production was only ever read). The server-side degradation contract
 * itself is pinned by tests/unit/subscription-schema-pending.test.ts.
 *
 * METHOD: the crash was a RENDER-path crash, so react-dom/server
 * (renderToStaticMarkup) reproduces it exactly — no DOM environment
 * needed. The panels are exercised for the pending shape, the no-row
 * case and the fully-migrated shape (guards must never hide real data).
 */
import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SummaryHeader, PlanPricingPanel, modelLabel } from '@/components/platform/modules/school-subscription'
import type { RegistryRow } from '@/components/platform/modules/subscription-shared'
import type { PlatformApiError } from '@/components/platform/platform-client'

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

/** No-op gate — the panels only invoke it from mutation handlers. */
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
const edit = () => {}

describe('school Subscription tab · schema-pending render (the 2026-10-19 crash regression)', () => {
  test(
    'SummaryHeader renders the pending-shaped registry row WITHOUT throwing',
    () => {
      // Before the original fix this exact surface threw
      // "Cannot read properties of null (reading 'replace')" and took the
      // whole console page down with the error boundary.
      const html = renderToStaticMarkup(
        <SummaryHeader data={DATA} registryRow={PENDING_ROW} onRecordPayment={edit} />,
      )
      expect(html.length).toBeGreaterThan(0)
      // The real computed entitlement state still renders.
      expect(html).toContain('Active')
      // The billing-model label must NOT be fabricated from null.
      expect(html).not.toContain('Fixed school fee')
      // The honest "no price" path renders.
      expect(html).toContain('no price agreed yet')
    },
  )

  test('SummaryHeader renders a NULL registry row (school without a registry row)', () => {
    const html = renderToStaticMarkup(
      <SummaryHeader data={DATA} registryRow={null} onRecordPayment={edit} />,
    )
    expect(html).toContain('Active')
    expect(html).not.toContain('Fixed school fee')
  })

  test('SummaryHeader still renders real values when migrated', () => {
    const html = renderToStaticMarkup(
      <SummaryHeader data={DATA} registryRow={MIGRATED_ROW} onRecordPayment={edit} />,
    )
    expect(html).toContain('Fixed school fee')
    expect(html).toContain('School Standard')
    expect(html).toContain('₹12,000')
  })

  test('PlanPricingPanel renders the pending-shaped row with honest em-dashes', () => {
    const html = renderToStaticMarkup(
      <PlanPricingPanel
        schoolId={SCHOOL.id}
        data={DATA}
        registryRow={PENDING_ROW}
        legacyPlan="STANDARD"
        onEditTerms={edit}
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('not linked yet')
    // The empty state with a direct next action renders.
    expect(html).toContain('No commercial terms recorded yet')
    // Unavailable fields degrade to em-dashes — never fabricated values.
    expect(html).toContain('—')
    expect(html).not.toContain('Fixed school fee')
    expect(html).not.toContain('Per student')
  })

  test('PlanPricingPanel renders real registry values when migrated', () => {
    const html = renderToStaticMarkup(
      <PlanPricingPanel
        schoolId={SCHOOL.id}
        data={DATA}
        registryRow={MIGRATED_ROW}
        legacyPlan="STANDARD"
        onEditTerms={edit}
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html).toContain('School Standard')
    expect(html).toContain('Fixed school fee')
    expect(html).toContain('₹12,000')
    expect(html).toContain('annual')
  })

  test('PlanPricingPanel renders the per-student calculation when migrated to PER_STUDENT', () => {
    const perStudentRow: RegistryRow = {
      ...MIGRATED_ROW,
      billingModel: 'PER_STUDENT',
      priceSnapshot: 300,
      licensedStudents: 350,
    }
    const html = renderToStaticMarkup(
      <PlanPricingPanel
        schoolId={SCHOOL.id}
        data={DATA}
        registryRow={perStudentRow}
        legacyPlan="STANDARD"
        onEditTerms={edit}
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html).toContain('Per student')
    expect(html).toContain('Annual amount calculation')
    // The spelled-out math: ₹300 × 350 licensed students = ₹1,05,000.
    expect(html).toContain('₹300')
    expect(html).toContain('350 licensed students')
    expect(html).toContain('₹1,05,000')
    expect(html).toContain('Licensed student limit')
  })

  test('PlanPricingPanel renders a NULL registry row', () => {
    const html = renderToStaticMarkup(
      <PlanPricingPanel
        schoolId={SCHOOL.id}
        data={DATA}
        registryRow={null}
        legacyPlan="STANDARD"
        onEditTerms={edit}
        gate={gate}
        onReload={reload}
      />,
    )
    expect(html).toContain('not linked yet')
    expect(html).toContain('No commercial terms recorded yet')
    expect(html).toContain('Set plan &amp; pricing')
  })

  test('modelLabel: null-safe plain-language mapping (unit contract)', () => {
    expect(modelLabel(null)).toBe('—')
    expect(modelLabel(undefined)).toBe('—')
    expect(modelLabel('SCHOOL_WIDE')).toBe('Fixed school fee')
    expect(modelLabel('PER_STUDENT')).toBe('Per student')
    expect(modelLabel('MIXED')).toBe('Mixed — school fee + per student')
    // Unknown future values pass through raw — never crash, never invented.
    expect(modelLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
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
