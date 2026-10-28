/**
 * Platform audit-trail presentation vocabulary (2026-10-28 Support &
 * audit redesign).
 *
 * Shared by the school workspace's audit history (support-audit.tsx),
 * the console audit viewer (audit.tsx) and the API route's category
 * filter — ONE authoritative classification, never per-surface copies.
 *
 * Everything here derives from REAL data (the dot-namespaced action
 * string, the metadata JSON the audit funnel wrote) — no fabricated
 * outcomes, no invented labels.
 */

// ── Categories ─────────────────────────────────────────────────────────────

export const AUDIT_CATEGORIES = [
  'support_access',
  'auth_security',
  'school_config',
  'subscription',
  'admin_actions',
] as const

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

/**
 * Action-prefix sets per category (matched server-side as `startsWith`,
 * case-sensitive — the vocabulary is written lower-snake by the audit
 * funnel). Every known `platform.*` action maps to exactly one bucket;
 * unmapped actions fall into `admin_actions` when rendered, and an
 * UNFILTERED query when used as a filter (the API never hides rows).
 */
const CATEGORY_PREFIXES: Record<AuditCategory, readonly string[]> = {
  support_access: [
    'platform.support_session.',
    'platform.school_session.',
  ],
  auth_security: [
    'platform.login.',
    'platform.logout',
    'platform.session.revoked',
    'platform.step_up.',
    'platform.password',
    'platform.password_reset.',
    'platform.account_email.',
    'platform.recovery.',
    'platform.supabase_',
  ],
  school_config: ['platform.school.'],
  subscription: ['platform.billing.'],
  admin_actions: [
    'platform.admin.',
    'platform.settings.',
    'platform.announcement.',
    'platform.ops.',
  ],
}

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  support_access: 'Support access',
  auth_security: 'Auth & session security',
  school_config: 'School configuration',
  subscription: 'Subscription & billing',
  admin_actions: 'Administrative actions',
}

/** The category a single action belongs to (unmapped → admin_actions). */
export function auditCategoryOf(action: string): AuditCategory {
  for (const cat of AUDIT_CATEGORIES) {
    if (CATEGORY_PREFIXES[cat].some((p) => action.startsWith(p))) return cat
  }
  return 'admin_actions'
}

/** Prisma `OR` conditions for one category (server-side filter). */
export function auditCategoryOr(
  cat: AuditCategory,
): Array<{ action: { startsWith: string } }> {
  return CATEGORY_PREFIXES[cat].map((p) => ({ action: { startsWith: p } }))
}

// ── Outcome (derived, honest) ──────────────────────────────────────────────

/**
 * Failure classification derived from the action vocabulary itself — the
 * funnel writes explicit failure markers (`.failed`, `.locked`,
 * `.refused`, `failure`). No outcome is ever inferred from absence of
 * data.
 */
const FAILURE_MARKER = /[._](failed|locked|refused)([._]|$)|failure/

export function auditActionFailed(action: string): boolean {
  return FAILURE_MARKER.test(action)
}

// ── Human-readable summaries ───────────────────────────────────────────────

/** Known actions → concise operator sentences (fallback: generic form). */
const ACTION_SUMMARIES: Record<string, string> = {
  'platform.login.success': 'Platform sign-in succeeded',
  'platform.login.failed': 'Platform sign-in failed',
  'platform.login.locked': 'Platform sign-in locked out',
  'platform.logout': 'Admin signed out',
  'platform.logout_all': 'All admin sessions signed out',
  'platform.session.revoked': 'Admin session revoked',
  'platform.step_up.granted': 'Step-up verification granted',
  'platform.step_up.failed': 'Step-up verification failed',
  'platform.support_session.created': 'Support session opened',
  'platform.support_session.revoked': 'Support session ended',
  'platform.support_session.expired': 'Support session expired',
  'platform.school_session.revoked': 'School-user session force-signed-out',
  'platform.school.provisioned': 'School provisioned',
  'platform.school.provision_replayed': 'School provisioning replayed',
  'platform.school.activated': 'School activated',
  'platform.school.suspended': 'School suspended',
  'platform.school.reactivated': 'School reactivated',
  'platform.school.updated': 'School configuration updated',
  'platform.school.deleted': 'School deleted',
  'platform.school.credentials_reset': 'School credentials reset',
  'platform.school.credential_reissued': 'School credential reissued',
  'platform.school.student_access_paused': 'Student access paused',
  'platform.school.student_access_resumed': 'Student access resumed',
  'platform.school.domain_added': 'Custom domain added',
  'platform.school.domain_removed': 'Custom domain removed',
  'platform.school.domain_verified': 'Custom domain verified',
  'platform.school.domain_check_failed': 'Custom domain check failed',
  'platform.school.identity_request_rejected': 'Identity change request rejected',
  'platform.school.identity_changed': 'School identity changed',
  'platform.school.admissions_issuance_updated': 'Admissions issuance updated',
  'platform.billing.subscription_override': 'Subscription overridden',
  'platform.billing.payment_recorded': 'Payment recorded',
  'platform.billing.student_payment_recorded': 'Student payment recorded',
  'platform.billing.student_entitlement_assigned': 'Student entitlement assigned',
  'platform.billing.code_revoked': 'Activation code revoked',
  'platform.billing.code_reissued': 'Activation code reissued',
  'platform.billing.config_updated': 'Billing configuration updated',
  'platform.billing.plan_created': 'Subscription plan created',
  'platform.billing.plan_updated': 'Subscription plan updated',
  'platform.billing.plan_archived': 'Subscription plan archived',
  'platform.admin.created': 'Platform admin created',
  'platform.admin.permission_changed': 'Admin permissions changed',
  'platform.admin.suspended': 'Platform admin suspended',
  'platform.admin.reactivated': 'Platform admin reactivated',
  'platform.admin.password_reset_initiated': 'Admin password reset initiated',
  'platform.admin.google_linked': 'Google account linked',
  'platform.admin.google_unlinked': 'Google account unlinked',
  'platform.admin.google_link_failed': 'Google account link failed',
  'platform.password.changed': 'Password changed',
  'platform.password.change_failed': 'Password change failed',
  'platform.password_reset.requested': 'Password reset requested',
  'platform.password_reset.failed': 'Password reset failed',
  'platform.password_reset.completed': 'Password reset completed',
  'platform.account_email.changed': 'Account email changed',
  'platform.recovery.initiated': 'Account recovery initiated',
  'platform.recovery.refused': 'Account recovery refused',
  'platform.recovery.executed': 'Account recovery executed',
  'platform.settings.updated': 'Platform settings updated',
  'platform.announcement.published': 'Announcement published',
  'platform.announcement.updated': 'Announcement updated',
  'platform.announcement.deleted': 'Announcement deleted',
  'platform.ops.alert.opened': 'Operations alert opened',
  'platform.ops.alert.reopened': 'Operations alert reopened',
  'platform.ops.alert.auto_resolved': 'Operations alert auto-resolved',
  'platform.ops.alert.acknowledged': 'Operations alert acknowledged',
  'platform.ops.alert.resolved': 'Operations alert resolved',
  'platform.ops.alert.settings_updated': 'Alert settings updated',
  'platform.ops.error.acknowledged': 'Error fingerprint acknowledged',
  'platform.ops.error.resolved': 'Error fingerprint resolved',
  'platform.ops.sync.triggered': 'Usage sync triggered',
  'platform.ops.health_checks.run': 'Health checks run',
  'platform.ops.retention.run': 'Retention sweep run',
  'platform.ops.email_webhook.repaired': 'Email webhook repaired',
  'platform.supabase_exchange.success': 'Supabase token exchanged',
  'platform.supabase_exchange.failed': 'Supabase token exchange failed',
  'platform.supabase_exchange.locked': 'Supabase token exchange locked',
  'platform.supabase_link.success': 'Supabase account linked',
  'platform.supabase_link.failed': 'Supabase account link failed',
}

/**
 * Concise human-readable summary for one action. Unknown actions get a
 * cleaned generic form (strip the `platform.` namespace, split dots,
 * capitalize) — never a blank or a raw dump.
 */
export function auditActionSummary(action: string): string {
  const known = ACTION_SUMMARIES[action]
  if (known) return known
  const tail = action.startsWith('platform.') ? action.slice('platform.'.length) : action
  const words = tail.split(/[._]/).filter(Boolean)
  if (words.length === 0) return action
  const first = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1)
  return [first, ...words.slice(1)].join(' ')
}

// ── Metadata field labels ──────────────────────────────────────────────────

/**
 * Known metadata keys → operator-facing labels (covers the keys the
 * audit funnel actually writes). Unknown keys fall back to a humanized
 * camelCase/snake_case form — numeric array keys and implementation
 * artifacts are never rendered as-is.
 */
const META_FIELD_LABELS: Record<string, string> = {
  durationMinutes: 'Duration (minutes)',
  schoolName: 'School',
  adminName: 'Administrator',
  adminEmail: 'Administrator email',
  reason: 'Reason',
  userRole: 'User role',
  studentCount: 'Students',
  teacherCount: 'Teachers',
  userCount: 'Users',
  classCount: 'Classes',
  featureFlags: 'Feature flags',
  changes: 'Changed fields',
  before: 'Previous value',
  after: 'New value',
  planName: 'Plan',
  codePrefix: 'Code prefix',
  seatLimit: 'Seat limit',
  amount: 'Amount',
  method: 'Method',
  transactionId: 'Gateway reference',
  hostname: 'Hostname',
  targetEmail: 'Target email',
  targetName: 'Target name',
  sessionsRevoked: 'Sessions revoked',
  counts: 'Counts',
  ip: 'IP address',
  userAgent: 'Device',
  fields: 'Fields',
  keys: 'Keys',
  attempts: 'Attempts',
  window: 'Window',
  enabled: 'Enabled',
  disabled: 'Disabled',
}

/** Humanize one metadata key (known label, else camelCase → words). */
export function auditMetaLabel(key: string): string {
  const known = META_FIELD_LABELS[key]
  if (known) return known
  if (/^[0-9]+$/.test(key)) return '' // numeric array index — implementation artifact
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Render one metadata value as readable text. */
export function auditMetaValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)'
    return value.map((v) => auditMetaValue(v)).join(', ')
  }
  if (typeof value === 'object') {
    // Nested object (counts, diffs): render "label: value" pairs.
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined,
    )
    if (entries.length === 0) return '(empty)'
    return entries.map(([k, v]) => `${auditMetaLabel(k) || k}: ${auditMetaValue(v)}`).join('; ')
  }
  return String(value)
}

/**
 * Parse the audit row's metadata JSON string into entries the UI can
 * render with labels. Corrupt blobs yield [] (never a raw dump, never
 * numeric-index chips like `0={`).
 */
export function auditMetaEntries(
  raw: string | Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string; value: string }> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      obj = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (obj === null || obj === undefined) return []
  if (typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => auditMetaLabel(k) !== '' && v !== null && v !== undefined)
    .map(([k, v]) => ({ key: k, label: auditMetaLabel(k), value: auditMetaValue(v) }))
}
