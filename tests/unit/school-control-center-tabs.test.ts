/**
 * PHASE 1 — SUPER ADMIN CONTROL CENTER — unit tests for the school
 * workspace's destination resolution (Overview | Setup | Manage).
 *
 * The workspace at /platform/schools/[id] is a single ?tab=-driven
 * surface. Phase 1 regroups its six §7 operator groups into THREE
 * primary destinations while preserving EVERY historical deep link:
 * the §7 group keys AND the pre-§7 12-tab keys must all resolve onto
 * the new destinations, landing on the exact sub-section that owns
 * the capability today. Cross-module callers depend on this
 * (subscriptions.tsx / reports.tsx push '?tab=subscription';
 * school-subscription navigates to 'gateway'; school-setup navigates
 * to 'metadata' | 'users' | 'identity' | 'plan' | 'domains';
 * NextActionsCard navigates to 'advanced' | 'access' | 'setup').
 *
 * The module under test is pure data/logic — no React, no DOM.
 */
import { describe, test, expect } from 'bun:test'

import {
  CONTROL_CENTER_GROUPS,
  SUBSECTION_IDS,
  LEGACY_TAB_REDIRECT,
  resolveTabValue,
  availableControlCenterGroups,
} from '../../src/components/platform/modules/school-detail-tabs'

describe('Phase 1 control-center destinations', () => {
  test('exposes exactly the three primary destinations in order', () => {
    expect(CONTROL_CENTER_GROUPS).toEqual(['overview', 'setup', 'manage'])
  })

  test('every canonical destination key resolves to itself WITHOUT an anchor', () => {
    for (const group of CONTROL_CENTER_GROUPS) {
      const resolved = resolveTabValue(group)
      expect(resolved).not.toBeNull()
      expect(resolved!.group).toBe(group)
      // Selecting a destination must land at its TOP — an anchor here
      // would re-introduce the §7 anchor-collision scroll trap.
      expect(resolved!.anchor).toBeUndefined()
    }
  })

  test('every redirect target group is a canonical destination', () => {
    for (const [key, target] of Object.entries(LEGACY_TAB_REDIRECT)) {
      expect(
        (CONTROL_CENTER_GROUPS as readonly string[]).includes(target.group),
        `legacy key "${key}" resolves to unknown group "${target.group}"`,
      ).toBe(true)
    }
  })

  test('every redirect anchor is a real sub-section id', () => {
    const anchors = new Set(Object.values(SUBSECTION_IDS))
    for (const [key, target] of Object.entries(LEGACY_TAB_REDIRECT)) {
      if (target.anchor !== undefined) {
        expect(
          anchors.has(target.anchor),
          `legacy key "${key}" anchors to unknown id "${target.anchor}"`,
        ).toBe(true)
      }
    }
  })

  test('§7 operator-group keys map onto their Phase 1 destination', () => {
    expect(resolveTabValue('configuration')).toEqual({ group: 'setup' })
    expect(resolveTabValue('access')).toEqual({
      group: 'manage',
      anchor: 'section-access',
    })
    expect(resolveTabValue('subscription')).toEqual({
      group: 'manage',
      anchor: 'section-subscription',
    })
    expect(resolveTabValue('support')).toEqual({
      group: 'manage',
      anchor: 'section-support',
    })
    expect(resolveTabValue('advanced')).toEqual({
      group: 'manage',
      anchor: 'section-danger',
    })
  })

  test('pre-§7 12-tab keys land on the owning sub-section', () => {
    expect(resolveTabValue('metadata')).toEqual({
      group: 'setup',
      anchor: 'section-metadata',
    })
    expect(resolveTabValue('identity')).toEqual({
      group: 'setup',
      anchor: 'section-identity',
    })
    expect(resolveTabValue('plan')).toEqual({
      group: 'setup',
      anchor: 'section-modules',
    })
    expect(resolveTabValue('domains')).toEqual({
      group: 'setup',
      anchor: 'section-domains',
    })
    expect(resolveTabValue('users')).toEqual({
      group: 'manage',
      anchor: 'section-users',
    })
    expect(resolveTabValue('gateway')).toEqual({
      group: 'manage',
      anchor: 'section-gateway',
    })
    expect(resolveTabValue('audit')).toEqual({
      group: 'manage',
      anchor: 'section-audit',
    })
    expect(resolveTabValue('danger')).toEqual({
      group: 'manage',
      anchor: 'section-danger',
    })
  })

  test('cross-module callers keep resolving (regression pins)', () => {
    // subscriptions.tsx / reports.tsx deep-link the school dossier:
    // router.push(`/platform/schools/${id}?tab=subscription`)
    expect(resolveTabValue('subscription')?.group).toBe('manage')
    // school-subscription.tsx → onNavigateTab('gateway')
    expect(resolveTabValue('gateway')).toEqual({
      group: 'manage',
      anchor: 'section-gateway',
    })
    // school-setup.tsx → onNavigateTab('metadata' | 'users' | 'identity' | 'plan' | 'domains')
    for (const key of ['metadata', 'users', 'identity', 'plan', 'domains']) {
      expect(resolveTabValue(key), `school-setup deep-link "${key}"`).not.toBeNull()
    }
    // NextActionsCard → onNavigate('advanced' | 'access' | 'setup')
    expect(resolveTabValue('advanced')?.group).toBe('manage')
    expect(resolveTabValue('access')?.group).toBe('manage')
    expect(resolveTabValue('setup')?.group).toBe('setup')
  })

  test('unknown / empty values fail safe to null (Overview fallback)', () => {
    expect(resolveTabValue(null)).toBeNull()
    expect(resolveTabValue(undefined)).toBeNull()
    expect(resolveTabValue('')).toBeNull()
    expect(resolveTabValue('nonexistent')).toBeNull()
    expect(resolveTabValue('Overview')).toBeNull() // case-sensitive keys
  })
})

describe('Phase 1 destination visibility', () => {
  test('Overview and Setup are always available', () => {
    const groups = availableControlCenterGroups({
      canManage: false,
      canBill: false,
      canSupport: false,
      canAudit: false,
    })
    expect(groups).toEqual(['overview', 'setup'])
  })

  test('Manage appears when ANY of its section capabilities is held', () => {
    const base = { canManage: false, canBill: false, canSupport: false, canAudit: false }
    expect(availableControlCenterGroups({ ...base, canBill: true })).toContain('manage')
    expect(availableControlCenterGroups({ ...base, canSupport: true })).toContain('manage')
    expect(availableControlCenterGroups({ ...base, canAudit: true })).toContain('manage')
    expect(availableControlCenterGroups({ ...base, canManage: true })).toContain('manage')
  })

  test('a full-permission root admin sees all three destinations', () => {
    const groups = availableControlCenterGroups({
      canManage: true,
      canBill: true,
      canSupport: true,
      canAudit: true,
    })
    expect(groups).toEqual(['overview', 'setup', 'manage'])
  })
})
