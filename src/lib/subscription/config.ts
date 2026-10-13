/**
 * subscription/config — the platform-owner commercial-model configuration.
 *
 * Single source of truth: `PlatformSetting.subscriptionConfig` (JSON column,
 * id 'global'). Readable by any platform admin (config visibility), mutated
 * ONLY through the billing.manage-gated settings route which validates via
 * THIS module. Never client-writable; never containing secrets.
 *
 * Structure (all fields optional with safe defaults — a missing/partial
 * config must never break evaluation):
 *   {
 *     "models": { "school": {"enabled": true},
 *                 "student": {"enabled": true},
 *                 "manual": {"enabled": true} },
 *     "defaultBillingModel": "SCHOOL_WIDE",   // applied to new schools
 *     "student": { "defaultClaimWindowDays": 30, "defaultValidityMonths": 12 },
 *     "school":  { "defaultGraceDays": 14 }
 *   }
 */
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'

export const BILLING_MODELS = ['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'] as const
export type BillingModel = (typeof BILLING_MODELS)[number]

export interface SubscriptionConfig {
  models: { school: { enabled: boolean }; student: { enabled: boolean }; manual: { enabled: boolean } }
  defaultBillingModel: BillingModel
  student: { defaultClaimWindowDays: number; defaultValidityMonths: number }
  school: { defaultGraceDays: number }
}

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  models: { school: { enabled: true }, student: { enabled: true }, manual: { enabled: true } },
  defaultBillingModel: 'SCHOOL_WIDE',
  student: { defaultClaimWindowDays: 30, defaultValidityMonths: 12 },
  school: { defaultGraceDays: 14 },
}

/** Parse + sanitize the stored JSON. Invalid values fall back to the
 *  documented defaults (evaluation must never throw on bad config). */
export function parseSubscriptionConfig(raw: string | null | undefined): SubscriptionConfig {
  if (!raw) return { ...DEFAULT_SUBSCRIPTION_CONFIG }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_SUBSCRIPTION_CONFIG }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SUBSCRIPTION_CONFIG }
  const p = parsed as Record<string, unknown>
  const cfg: SubscriptionConfig = { ...DEFAULT_SUBSCRIPTION_CONFIG, models: { ...DEFAULT_SUBSCRIPTION_CONFIG.models }, student: { ...DEFAULT_SUBSCRIPTION_CONFIG.student }, school: { ...DEFAULT_SUBSCRIPTION_CONFIG.school } }

  if (p.models && typeof p.models === 'object') {
    const m = p.models as Record<string, unknown>
    for (const key of ['school', 'student', 'manual'] as const) {
      const entry = m[key]
      if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).enabled === 'boolean') {
        cfg.models[key] = { enabled: (entry as Record<string, unknown>).enabled as boolean }
      }
    }
  }
  if (typeof p.defaultBillingModel === 'string' && (BILLING_MODELS as readonly string[]).includes(p.defaultBillingModel)) {
    cfg.defaultBillingModel = p.defaultBillingModel as BillingModel
  }
  if (p.student && typeof p.student === 'object') {
    const s = p.student as Record<string, unknown>
    if (typeof s.defaultClaimWindowDays === 'number' && s.defaultClaimWindowDays >= 1 && s.defaultClaimWindowDays <= 365) {
      cfg.student.defaultClaimWindowDays = Math.round(s.defaultClaimWindowDays)
    }
    if (typeof s.defaultValidityMonths === 'number' && s.defaultValidityMonths >= 1 && s.defaultValidityMonths <= 36) {
      cfg.student.defaultValidityMonths = Math.round(s.defaultValidityMonths)
    }
  }
  if (p.school && typeof p.school === 'object') {
    const s = p.school as Record<string, unknown>
    if (typeof s.defaultGraceDays === 'number' && s.defaultGraceDays >= 0 && s.defaultGraceDays <= 90) {
      cfg.school.defaultGraceDays = Math.round(s.defaultGraceDays)
    }
  }
  return cfg
}

/** Load the effective config (creating the global setting row if absent —
 *  same ensure-semantics as the platform settings route). */
export async function loadSubscriptionConfig(): Promise<SubscriptionConfig> {
  let setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
  if (!setting) {
    setting = await db.platformSetting.create({ data: { id: 'global' } })
  }
  return parseSubscriptionConfig(setting.subscriptionConfig)
}

/** Validate an incoming PATCH body and persist the new config atomically.
 *  Throws VALIDATION_FAILED on any invalid field (fail-closed — the caller
 *  is expected to surface actionable messages). */
export async function saveSubscriptionConfig(patch: Record<string, unknown>): Promise<SubscriptionConfig> {
  const current = await loadSubscriptionConfig()
  const next: SubscriptionConfig = {
    models: { ...current.models },
    defaultBillingModel: current.defaultBillingModel,
    student: { ...current.student },
    school: { ...current.school },
  }
  const problems: string[] = []

  if (patch.models !== undefined) {
    if (typeof patch.models !== 'object' || patch.models === null) problems.push('models must be an object')
    else {
      const m = patch.models as Record<string, unknown>
      for (const key of ['school', 'student', 'manual'] as const) {
        if (m[key] !== undefined) {
          const v = m[key]
          if (typeof v !== 'object' || v === null || typeof (v as Record<string, unknown>).enabled !== 'boolean') {
            problems.push(`models.${key}.enabled must be boolean`)
          } else {
            next.models[key] = { enabled: (v as Record<string, unknown>).enabled as boolean }
          }
        }
      }
    }
  }
  if (patch.defaultBillingModel !== undefined) {
    if (typeof patch.defaultBillingModel !== 'string' || !(BILLING_MODELS as readonly string[]).includes(patch.defaultBillingModel)) {
      problems.push(`defaultBillingModel must be one of ${BILLING_MODELS.join('|')}`)
    } else {
      next.defaultBillingModel = patch.defaultBillingModel as BillingModel
    }
  }
  if (patch.student !== undefined) {
    if (typeof patch.student !== 'object' || patch.student === null) problems.push('student must be an object')
    else {
      const s = patch.student as Record<string, unknown>
      if (s.defaultClaimWindowDays !== undefined) {
        const n = Number(s.defaultClaimWindowDays)
        if (!Number.isInteger(n) || n < 1 || n > 365) problems.push('student.defaultClaimWindowDays must be 1–365')
        else next.student.defaultClaimWindowDays = n
      }
      if (s.defaultValidityMonths !== undefined) {
        const n = Number(s.defaultValidityMonths)
        if (!Number.isInteger(n) || n < 1 || n > 36) problems.push('student.defaultValidityMonths must be 1–36')
        else next.student.defaultValidityMonths = n
      }
    }
  }
  if (patch.school !== undefined) {
    if (typeof patch.school !== 'object' || patch.school === null) problems.push('school must be an object')
    else {
      const s = patch.school as Record<string, unknown>
      if (s.defaultGraceDays !== undefined) {
        const n = Number(s.defaultGraceDays)
        if (!Number.isInteger(n) || n < 0 || n > 90) problems.push('school.defaultGraceDays must be 0–90')
        else next.school.defaultGraceDays = n
      }
    }
  }

  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: `Invalid subscription configuration: ${problems.join('; ')}`,
      internalDetail: `saveSubscriptionConfig: ${problems.join('; ')}`,
    })
  }

  // Extra safety: turning a model off requires a conscious decision — if
  // every model were disabled, no activation path would remain (documented,
  // fail-closed against accidental full lockout of new subscriptions).
  if (!next.models.school.enabled && !next.models.student.enabled && !next.models.manual.enabled) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'At least one commercial model must stay enabled (school, student, or manual).',
      internalDetail: 'saveSubscriptionConfig: all models disabled',
    })
  }

  await db.platformSetting.update({
    where: { id: 'global' },
    data: { subscriptionConfig: JSON.stringify(next) },
  })
  return next
}
