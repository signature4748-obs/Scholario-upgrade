'use client'

/**
 * admissions client-api — the browser-side client for the
 * server-issued admissions workflow (FEE-ADMISSIONS MVP, Phase F).
 *
 * Every call goes through the standard { ok, data } | { ok:false, error,
 * code } envelope. NOTHING here imports server modules — this file is
 * client-only and safe for 'use client' components.
 */

// ── server DTO shapes (mirror the routes) ─────────────────────────────

export interface AdmissionsConfig {
  enabled: boolean
  academicYear: string | null
}

export interface ServerQuoteLineItem {
  headId: string
  name: string
  category: string
  kind: 'FIXED' | 'OPTIONAL' | 'QUANTITY'
  frequency: string
  quantity: number
  unitAmount: number
  amount: number
  discounted: boolean
  discountCode?: string
}

export interface ServerQuote {
  structureId: string
  structureVersion: number
  academicYear: string
  classId: string
  className: string
  lineItems: ServerQuoteLineItem[]
  discount: { code: string; name: string; amount: number } | null
  totals: { gross: number; discount: number; net: number }
}

export interface ServerQuoteResponse {
  academicYear: string
  classId: string
  className: string
  structureId: string
  structureVersion: number
  selectableHeads: {
    id: string
    name: string
    category: string
    kind: 'FIXED' | 'OPTIONAL' | 'QUANTITY'
    frequency: string
    mandatory: boolean
    unitAmount: number
  }[]
  quote: ServerQuote
}

export interface QuoteSelections {
  optionalHeadIds?: string[]
  quantities?: Record<string, number>
  discountCode?: string
}

export interface ServerApplicationSummary {
  id: string
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'ENROLLED' | 'REJECTED'
  academicYear: string
  classId: string | null
  className: string
  section: string | null
  applicantName: string
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  submittedAt: string | null
  decisionAt: string | null
  rejectionReason: string | null
  enrolledAt: string | null
  enrolledStudentId: string | null
}

export interface ServerFeeSnapshot {
  applicationId: string
  status: string
  studentId: string | null
  className: string
  section: string | null
  academicYear: string
  structureVersion: number | null
  discountName: string | null
  discountAmount: number
  totalAmount: number
  issuedAt: string
  lineItems: ServerQuoteLineItem[]
}

export interface ServerEnrolResult {
  application: { id: string; status: string }
  student: {
    id: string
    userId: string
    name: string
    loginEmail: string
    admissionNo: string
    className: string
    rollNo: string | null
  }
  admissionNo: string
  feeSnapshot: {
    totalAmount: number
    discountAmount: number
    discountName: string | null
    academicYear: string
    structureVersion: number
    lineItems: ServerQuoteLineItem[]
  }
  totals: { gross: number; discount: number; net: number }
  idempotentReplay: boolean
  /** ONE-TIME bootstrap credential — present only on the executing
   * request (never on replays). */
  tempPassword?: string
}

export type DecisionAction = 'start-review' | 'request-correction' | 'resubmit' | 'approve' | 'reject'

export class AdmissionsApiError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'AdmissionsApiError'
    this.code = code
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string; code?: string }
    | null
  if (!res.ok || !json?.ok) {
    throw new AdmissionsApiError(
      json?.error || `Request failed (HTTP ${res.status})`,
      json?.code || `HTTP_${res.status}`,
    )
  }
  return json.data as T
}

// ── endpoints ──────────────────────────────────────────────────────────

export async function getAdmissionsConfig(): Promise<AdmissionsConfig> {
  return call<AdmissionsConfig>('/api/admissions/config')
}

export async function fetchServerQuote(
  classId: string,
  selections?: QuoteSelections,
): Promise<ServerQuoteResponse> {
  return call<ServerQuoteResponse>('/api/fees/quote', {
    method: 'POST',
    body: JSON.stringify({ classId, selections }),
  })
}

export async function submitServerApplication(input: {
  clientRequestId: string
  formData: Record<string, unknown>
  feeSelections?: QuoteSelections
  classId?: string
  section?: string
}): Promise<{ application: ServerApplicationSummary; idempotentReplay: boolean }> {
  return call('/api/admissions/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function getServerApplication(id: string) {
  return call<{
    application: ServerApplicationSummary & { payload: { formData: Record<string, unknown>; feeSelections?: QuoteSelections } }
    events: { id: string; action: string; actorRole: string | null; notes: string | null; createdAt: string }[]
    feeSnapshot: ServerFeeSnapshot | null
    duplicateAdvisory: {
      checked: boolean
      possibleDuplicates: {
        id: string
        status: string
        applicantName: string
        className: string
        section: string | null
        applicantDob: string | null
        submittedAt: string | null
      }[]
    }
  }>(`/api/admissions/applications/${id}`)
}

export async function serverDecide(
  id: string,
  action: DecisionAction,
  payload?: { notes?: string; reason?: string; formData?: Record<string, unknown> },
) {
  return call<{ id: string; status: string }>(`/api/admissions/applications/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  })
}

export async function serverEnrol(
  id: string,
  input: { loginEmail: string; rollNo?: string; classId?: string },
): Promise<ServerEnrolResult> {
  return call<ServerEnrolResult>(`/api/admissions/applications/${id}/enrol`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function getServerFeeSnapshot(id: string): Promise<ServerFeeSnapshot> {
  return call<ServerFeeSnapshot>(`/api/admissions/applications/${id}/fee-snapshot`)
}

/** Map the local admission status vocabulary onto the server machine. */
export function localStatusFromServer(serverStatus: string): string {
  switch (serverStatus) {
    case 'SUBMITTED':
      return 'Submitted'
    case 'UNDER_REVIEW':
      return 'Under Review'
    case 'APPROVED':
      return 'Approved'
    case 'ENROLLED':
      return 'Completed'
    case 'REJECTED':
      return 'Rejected'
    default:
      return 'Submitted'
  }
}
