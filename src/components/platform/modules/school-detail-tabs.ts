// ============================================================
// school-detail-tabs — Phase 1 Super Admin Control Center IA
// ------------------------------------------------------------
// The school workspace (/platform/schools/[id]) presents THREE
// primary destinations: Overview · Setup · Manage (Phase 1 of the
// control-center transformation — docs/super-admin-transformation/
// PHASE-1-ARCHITECTURE.md).
//
//   Overview — read-only dashboard: status, setup completion,
//              profile, modules, activity, next actions.
//   Setup    — first-time configuration & identity governance:
//              readiness, metadata, modules & admissions,
//              identity requests, custom domains.
//   Manage   — ongoing operation & oversight: access & sign-in,
//              users, subscription & fee gateway, support & audit,
//              danger zone.
//
// Every historical deep link keeps working: LEGACY_TAB_REDIRECT maps
// ALL previous tab keys (the §7 operator-group keys AND the pre-§7
// 12-tab keys) onto { group, anchor }. PURE DATA MODULE — no React,
// no 'use client', unit-tested in
// tests/unit/school-control-center-tabs.test.ts.
// ============================================================

/** Canonical destination keys (the ?tab= values written to the URL). */
export const CONTROL_CENTER_GROUPS = ['overview', 'setup', 'manage'] as const

export type ControlCenterGroup = (typeof CONTROL_CENTER_GROUPS)[number]

/** Sub-section anchor ids inside a merged destination (§7: headings +
 * anchors — never tab-in-tab). The id doubles as the deep-link target
 * for legacy ?tab= values that pointed at the section. */
export const SUBSECTION_IDS = {
  setup: 'section-setup',
  // PHASE 2 — the guided wizard owns section-setup; the DB-computed
  // readiness list remains reachable one anchor below it.
  setupReadiness: 'section-setup-readiness',
  metadata: 'section-metadata',
  identity: 'section-identity',
  modules: 'section-modules',
  domains: 'section-domains',
  access: 'section-access',
  users: 'section-users',
  subscription: 'section-subscription',
  gateway: 'section-gateway',
  roleFeatures: 'section-role-features',
  support: 'section-support',
  audit: 'section-audit',
  danger: 'section-danger',
} as const

export interface TabTarget {
  group: string
  anchor?: string
}

// Every ?tab= key ever issued → its Phase 1 destination. Canonical
// keys ('overview', 'setup', 'manage') resolve to themselves WITHOUT
// an anchor — selecting a destination must land at the TOP of it.
// Legacy keys land on the exact sub-section that owns the capability
// today (deep links, shared URLs and the child modules' own
// cross-tab calls — school-subscription → 'gateway', school-setup →
// 'metadata' | 'users' | 'identity' | 'plan' | 'domains').
export const LEGACY_TAB_REDIRECT: Record<string, TabTarget> = {
  // ── Phase 1 canonical destinations ──
  overview: { group: 'overview' },
  setup: { group: 'setup' },
  manage: { group: 'manage' },
  // ── §7-era operator-group keys → their Phase 1 home ──
  configuration: { group: 'setup' },
  access: { group: 'manage', anchor: SUBSECTION_IDS.access },
  subscription: { group: 'manage', anchor: SUBSECTION_IDS.subscription },
  // 'support' anchored from Phase 1 on: it is no longer a destination
  // key, so the old §7 anchor-collision rule no longer applies — the
  // deep link lands on the Support & audit section inside Manage.
  support: { group: 'manage', anchor: SUBSECTION_IDS.support },
  advanced: { group: 'manage', anchor: SUBSECTION_IDS.danger },
  // ── pre-§7 12-tab keys → the sub-section that owns them ──
  metadata: { group: 'setup', anchor: SUBSECTION_IDS.metadata },
  identity: { group: 'setup', anchor: SUBSECTION_IDS.identity },
  plan: { group: 'setup', anchor: SUBSECTION_IDS.modules },
  modules: { group: 'setup', anchor: SUBSECTION_IDS.modules },
  domains: { group: 'setup', anchor: SUBSECTION_IDS.domains },
  users: { group: 'manage', anchor: SUBSECTION_IDS.users },
  gateway: { group: 'manage', anchor: SUBSECTION_IDS.gateway },
  'role-features': { group: 'manage', anchor: SUBSECTION_IDS.roleFeatures },
  audit: { group: 'manage', anchor: SUBSECTION_IDS.audit },
  danger: { group: 'manage', anchor: SUBSECTION_IDS.danger },
}

/** Resolve any ?tab= / onNavigateTab value — a Phase 1 destination
 * key, a §7 operator-group key, or a pre-§7 12-tab key. Unknown
 * values return null (callers fail safe to Overview, exactly as the
 * pre-§7 workspace did). */
export function resolveTabValue(raw: string | null | undefined): TabTarget | null {
  if (!raw) return null
  return LEGACY_TAB_REDIRECT[raw] ?? null
}

/** Destination visibility from platform permissions. Overview and
 * Setup are visible to anyone who can open the dossier (the server
 * re-authorizes every action inside); Manage appears when the viewer
 * holds at least one of the capabilities its sections require. */
export function availableControlCenterGroups(perms: {
  canManage: boolean
  canBill: boolean
  canSupport: boolean
  canAudit: boolean
}): string[] {
  const groups: string[] = ['overview', 'setup']
  if (perms.canBill || perms.canSupport || perms.canAudit || perms.canManage) {
    groups.push('manage')
  }
  return groups
}
