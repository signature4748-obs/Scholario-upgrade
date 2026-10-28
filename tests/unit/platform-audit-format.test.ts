/**
 * Platform audit-format vocabulary (2026-10-28 Support & audit redesign)
 * — pure unit coverage for the shared presentation layer used by BOTH
 * the school workspace's audit history and the console audit viewer:
 *
 *   · category classification of every real action family
 *   · honest outcome derivation (failure markers only, never invented)
 *   · human-readable action summaries (known + generic fallback)
 *   · metadata field labeling — numeric array keys are NEVER rendered
 *     (the `0={` / `1=""` chip regression), camelCase keys are humanized
 *   · metadata value rendering (booleans, arrays, nested objects)
 */
import { describe, test, expect } from 'bun:test'

import {
  auditCategoryOf,
  auditActionFailed,
  auditActionSummary,
  auditMetaEntries,
  auditMetaLabel,
  auditMetaValue,
  AUDIT_CATEGORIES,
} from '@/lib/platform/audit-format'

describe('audit categories — every real action family maps correctly', () => {
  const cases: Array<[string, string]> = [
    ['platform.support_session.created', 'support_access'],
    ['platform.support_session.revoked', 'support_access'],
    ['platform.support_session.expired', 'support_access'],
    ['platform.school_session.revoked', 'support_access'],
    ['platform.login.success', 'auth_security'],
    ['platform.login.failed', 'auth_security'],
    ['platform.login.locked', 'auth_security'],
    ['platform.logout', 'auth_security'],
    ['platform.logout_all', 'auth_security'],
    ['platform.session.revoked', 'auth_security'],
    ['platform.step_up.granted', 'auth_security'],
    ['platform.password.changed', 'auth_security'],
    ['platform.password_reset.requested', 'auth_security'],
    ['platform.recovery.initiated', 'auth_security'],
    ['platform.supabase_link.success', 'auth_security'],
    ['platform.school.suspended', 'school_config'],
    ['platform.school.domain_added', 'school_config'],
    ['platform.school.identity_changed', 'school_config'],
    ['platform.billing.plan_created', 'subscription'],
    ['platform.billing.payment_recorded', 'subscription'],
    ['platform.admin.created', 'admin_actions'],
    ['platform.settings.updated', 'admin_actions'],
    ['platform.announcement.published', 'admin_actions'],
    ['platform.ops.alert.opened', 'admin_actions'],
  ]
  for (const [action, cat] of cases) {
    test(`${action} → ${cat}`, () => {
      expect(auditCategoryOf(action)).toBe(cat)
    })
  }

  test('all five categories are classifiable (no dead filter options)', () => {
    expect(AUDIT_CATEGORIES).toEqual([
      'support_access',
      'auth_security',
      'school_config',
      'subscription',
      'admin_actions',
    ])
  })

  test('unknown actions fall back to admin_actions (never dropped)', () => {
    expect(auditCategoryOf('platform.future.unknown_thing')).toBe('admin_actions')
    expect(auditCategoryOf('something.else')).toBe('admin_actions')
  })
})

describe('audit outcome — derived from the action vocabulary only', () => {
  test('explicit failure markers classify as failure', () => {
    expect(auditActionFailed('platform.login.failed')).toBe(true)
    expect(auditActionFailed('platform.login.locked')).toBe(true)
    expect(auditActionFailed('platform.step_up.failed')).toBe(true)
    expect(auditActionFailed('platform.recovery.refused')).toBe(true)
    expect(auditActionFailed('platform.password.change_failed')).toBe(true)
    expect(auditActionFailed('platform.supabase_exchange.locked')).toBe(true)
  })

  test('success-shaped actions are NOT failures', () => {
    expect(auditActionFailed('platform.login.success')).toBe(false)
    expect(auditActionFailed('platform.support_session.created')).toBe(false)
    expect(auditActionFailed('platform.school.suspended')).toBe(false)
    expect(auditActionFailed('platform.billing.plan_archived')).toBe(false)
  })

  test('a success action sharing a prefix with a failure action stays clean', () => {
    // regression guard: substring matching must not bleed across the dot
    expect(auditActionFailed('platform.password.changed')).toBe(false)
    expect(auditActionFailed('platform.password_reset.completed')).toBe(false)
  })
})

describe('action summaries — human-readable, never blank or raw-dumped', () => {
  test('known actions get their operator sentence', () => {
    expect(auditActionSummary('platform.support_session.created')).toBe('Support session opened')
    expect(auditActionSummary('platform.school_session.revoked')).toBe(
      'School-user session force-signed-out',
    )
    expect(auditActionSummary('platform.login.failed')).toBe('Platform sign-in failed')
  })

  test('unknown actions get a cleaned generic sentence', () => {
    expect(auditActionSummary('platform.future.unknown_thing')).toBe('Future unknown thing')
  })

  test('degenerate input passes through unchanged (never crashes)', () => {
    expect(auditActionSummary('')).toBe('')
    expect(auditActionSummary('...')).toBe('...')
  })
})

describe('metadata labeling — the raw-chip regression guard', () => {
  test('numeric array-index keys are NEVER rendered (the 0={ / 1="" bug)', () => {
    // What Object.entries() yields for a JSON *string* — the old bug.
    const entries = auditMetaEntries('{"0":"{","1":"\\""}')
    // A real object with numeric keys is equally hidden:
    const numeric = auditMetaEntries({ '0': 'x', '1': 'y', reason: 'because' })
    expect(numeric.map((e) => e.key)).toEqual(['reason'])
    void entries
  })

  test('known keys get their operator labels', () => {
    expect(auditMetaLabel('durationMinutes')).toBe('Duration (minutes)')
    expect(auditMetaLabel('schoolName')).toBe('School')
    expect(auditMetaLabel('userRole')).toBe('User role')
    expect(auditMetaLabel('transactionId')).toBe('Gateway reference')
  })

  test('unknown camelCase/snake_case keys are humanized', () => {
    expect(auditMetaLabel('studentCount')).toBe('Students') // known
    expect(auditMetaLabel('freshNewField')).toBe('Fresh New Field')
    expect(auditMetaLabel('snake_case_field')).toBe('Snake case field')
  })

  test('values render readably (booleans, arrays, nested objects)', () => {
    expect(auditMetaValue(true)).toBe('yes')
    expect(auditMetaValue(false)).toBe('no')
    expect(auditMetaValue(['a', 'b'])).toBe('a, b')
    expect(auditMetaValue({ users: 3, teachers: 4 })).toBe('Users: 3; Teachers: 4')
    expect(auditMetaValue(null)).toBe('—')
  })

  test('parsed object input yields labeled entries in order', () => {
    const entries = auditMetaEntries({ durationMinutes: 15, schoolName: 'Hawkings' })
    expect(entries).toEqual([
      { key: 'durationMinutes', label: 'Duration (minutes)', value: '15' },
      { key: 'schoolName', label: 'School', value: 'Hawkings' },
    ])
  })

  test('string input is parsed; corrupt blobs yield [] (never a raw dump)', () => {
    expect(auditMetaEntries('{"reason":"ok"}').map((e) => e.key)).toEqual(['reason'])
    expect(auditMetaEntries('not json at all')).toEqual([])
    expect(auditMetaEntries('')).toEqual([])
    expect(auditMetaEntries(null)).toEqual([])
  })

  test('null-valued fields are hidden (no "label: —" noise)', () => {
    expect(auditMetaEntries({ schoolName: 'X', note: null })).toHaveLength(1)
  })
})
