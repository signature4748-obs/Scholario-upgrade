/**
 * subscription/plans — plan registry validation + lookup helpers.
 *
 * Plans are the platform owner's configured product (Model A school
 * monthly/annual, Model B student annual, STAFF per-seat annual for
 * teacher/staff licensing). CRUD lives in the billing.manage-gated
 * platform routes; THIS module is the validation + purchase-time
 * resolution layer both planes share.
 */
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'

export const PLAN_SCOPES = ['SCHOOL', 'STUDENT', 'STAFF'] as const
export const PLAN_INTERVALS = ['MONTHLY', 'ANNUAL'] as const
export const PLAN_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type PlanScope = (typeof PLAN_SCOPES)[number]
export type PlanInterval = (typeof PLAN_INTERVALS)[number]

const CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED'])

/** Parse + sanitize a JSON map (modules/limits). Invalid → undefined so
 *  the caller can reject with an actionable message. */
function parseJsonMap(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

export interface PlanValidationInput {
  code: string
  name: string
  description?: string | null
  scope: string
  interval: string
  priceMonthly?: number | null
  priceAnnual?: number | null
  pricePerStudent?: number | null
  currency: string
  modules?: string | null
  limits?: string | null
  graceDays: number
  allowOnline: boolean
  allowOffline: boolean
  availableForNew: boolean
  availableForRenewal: boolean
  sortOrder: number
}

export interface ValidatedPlan extends Omit<PlanValidationInput, 'modules' | 'limits'> {
  modules: string
  limits: string
}

/** Full validation for create/update. Throws VALIDATION_FAILED with a
 *  collected, actionable problem list (the UI surfaces them directly). */
export function validatePlanInput(input: PlanValidationInput): ValidatedPlan {
  const problems: string[] = []

  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(String(input.code ?? ''))) {
    problems.push('Code must be 3–40 chars: uppercase letters, digits, - and _ (e.g. STUDENT-ANNUAL).')
  }
  if (!input.name || String(input.name).trim().length < 2 || String(input.name).trim().length > 80) {
    problems.push('Name must be 2–80 characters.')
  }
  if (!(PLAN_SCOPES as readonly string[]).includes(input.scope)) {
    problems.push(`Scope must be ${PLAN_SCOPES.join(' | ')}.`)
  }
  if (!(PLAN_INTERVALS as readonly string[]).includes(input.interval)) {
    problems.push(`Interval must be ${PLAN_INTERVALS.join(' | ')}.`)
  }
  if (input.scope === 'STUDENT' && input.interval !== 'ANNUAL') {
    problems.push('Student plans are annual by contract.')
  }
  if (input.scope === 'STAFF' && input.interval !== 'ANNUAL') {
    problems.push('Staff plans are annual by contract (per-seat, like student plans).')
  }
  if (!CURRENCIES.has(input.currency)) {
    problems.push('Unsupported currency.')
  }

  const money = (v: number | null | undefined, label: string, required: boolean) => {
    if (v === null || v === undefined || Number.isNaN(v)) {
      if (required) problems.push(`${label} is required for this plan.`)
      return null
    }
    if (!(v > 0) || v > 100_000_000) {
      problems.push(`${label} must be greater than zero and under 100,000,000.`)
    }
    return Math.round(v * 100) / 100
  }
  const priceMonthly = money(input.priceMonthly, 'Monthly price', input.scope === 'SCHOOL' && input.interval === 'MONTHLY')
  const priceAnnual = money(input.priceAnnual, 'Annual price', input.scope === 'SCHOOL' && input.interval === 'ANNUAL')
  // pricePerStudent doubles as the PER-SEAT price for STAFF plans (the
  // seat the school licenses for one teacher/staff member per year).
  const pricePerStudent = money(
    input.pricePerStudent,
    input.scope === 'STAFF' ? 'Per-seat annual price' : 'Per-student annual price',
    input.scope === 'STUDENT' || input.scope === 'STAFF',
  )
  if (input.scope === 'SCHOOL' && priceMonthly === null && priceAnnual === null) {
    problems.push('School plans need at least one price (monthly or annual).')
  }
  if (input.scope === 'STUDENT' && pricePerStudent === null) {
    problems.push('Student plans need a per-student annual price.')
  }
  if (input.scope === 'STAFF' && pricePerStudent === null) {
    problems.push('Staff plans need a per-seat annual price.')
  }

  if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 90) {
    problems.push('Grace days must be 0–90.')
  }
  if (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > 9999) {
    problems.push('Sort order must be an integer between -9999 and 9999.')
  }

  const modules = parseJsonMap(input.modules ?? '{}')
  if (modules === undefined) problems.push('Modules must be a JSON object (e.g. {"analytics":true}).')
  const limits = parseJsonMap(input.limits ?? '{}')
  if (limits === undefined) problems.push('Limits must be a JSON object (e.g. {"maxStudents":500}).')
  if (limits && 'maxStudents' in limits) {
    const n = Number((limits as Record<string, unknown>).maxStudents)
    if (!Number.isInteger(n) || n < 1 || n > 100_000) problems.push('maxStudents limit must be an integer between 1 and 100,000.')
  }

  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: `Invalid plan: ${problems.join(' ')}`,
      internalDetail: `validatePlanInput: ${problems.join('; ')}`,
    })
  }
  return {
    ...input,
    priceMonthly,
    priceAnnual,
    pricePerStudent,
    graceDays: input.graceDays,
    modules: JSON.stringify(modules ?? {}),
    limits: JSON.stringify(limits ?? {}),
  }
}

/** Purchase-time plan resolution: exact ACTIVE plan by code (for
 *  order/assignment flows) with availability + payment-policy checks. */
export async function resolvePlanForPurchase(opts: {
  code: string
  expectedScope: PlanScope
  /** 'new' (first purchase) | 'renewal' | 'assignment' (operator path). */
  kind: 'new' | 'renewal' | 'assignment'
  requireOnline?: boolean
  requireOffline?: boolean
}) {
  const plan = await db.subscriptionPlan.findUnique({ where: { code: opts.code } })
  if (!plan || plan.status !== 'ACTIVE') {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Plan not found or not available.',
      internalDetail: `resolvePlanForPurchase: ${opts.code} missing/archived`,
    })
  }
  if (plan.scope !== opts.expectedScope) {
    const scopeLabel = opts.expectedScope === 'STUDENT' ? 'student' : opts.expectedScope === 'STAFF' ? 'staff' : 'school'
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: `This plan is not available for ${scopeLabel} subscriptions.`,
      internalDetail: `resolvePlanForPurchase: scope ${plan.scope} != ${opts.expectedScope}`,
    })
  }
  if (opts.kind === 'new' && !plan.availableForNew) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'This plan is not available for new subscriptions.' })
  }
  if (opts.kind === 'renewal' && !plan.availableForRenewal) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'This plan is not available for renewals.' })
  }
  if (opts.requireOnline && !plan.allowOnline) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Online payment is not offered for this plan.' })
  }
  if (opts.requireOffline && !plan.allowOffline) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Offline payment is not offered for this plan.' })
  }
  return plan
}

/** The price a purchase pays for a plan (by scope/interval). STAFF plans
 *  use the per-seat annual price (pricePerStudent column) like STUDENT. */
export function planPrice(plan: {
  scope: string
  interval: string
  priceMonthly: unknown
  priceAnnual: unknown
  pricePerStudent: unknown
}): { amount: number; interval: string } {
  if (plan.scope === 'STUDENT' || plan.scope === 'STAFF') {
    const amount = Number(plan.pricePerStudent ?? 0)
    if (!(amount > 0)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'This plan has no price configured.', internalDetail: 'planPrice: per-seat/student plan without price' })
    }
    return { amount, interval: 'ANNUAL' }
  }
  if (plan.interval === 'MONTHLY') {
    const amount = Number(plan.priceMonthly ?? 0)
    if (!(amount > 0)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'This plan has no monthly price configured.', internalDetail: 'planPrice: monthly plan without price' })
    }
    return { amount, interval: 'MONTHLY' }
  }
  const amount = Number(plan.priceAnnual ?? 0)
  if (!(amount > 0)) {
    throw new AppError('INVALID_INPUT', { publicMessage: 'This plan has no annual price configured.', internalDetail: 'planPrice: annual plan without price' })
  }
  return { amount, interval: 'ANNUAL' }
}

/** Effective plan limits map (sanitized). */
export function planLimits(plan: { limits: string }): { maxStudents?: number } {
  const map = parseJsonMap(plan.limits) ?? {}
  const out: { maxStudents?: number } = {}
  const n = Number((map as Record<string, unknown>).maxStudents)
  if (Number.isInteger(n) && n >= 1) out.maxStudents = n
  return out
}
