// ============================================================
// 8B-7-e — Central email infrastructure: TYPES
// ------------------------------------------------------------
// Server-only contract shared by the template renderer and the
// sendEmail pipeline (src/lib/email/index.ts). Phase 8B mission §7:
// one place that knows how transactional email leaves Scholario —
// Resend in production, a structured-log dev transport when
// RESEND_API_KEY is unset. Every payload is recorded in the
// EmailDelivery table (audit + idempotency via dedupeKey).
//
// Do not import from Client Components — see the guard in index.ts.
// ============================================================

/**
 * The closed set of transactional email templates. Adding a template
 * means adding a renderer in templates.ts (exhaustively checked there);
 * anything outside this union is rejected loudly by the pipeline
 * (FAILED EmailDelivery row, never a crash).
 */
export type TemplateId = 'admission-enquiry-received' | 'salary-payment-recorded'

/** Props for 'admission-enquiry-received' (public form confirmation). */
export interface AdmissionEnquiryEmailProps {
  /** Applicant student name as submitted on the public form. */
  studentName: string
  /** Requested grade ('' when the family left it blank). */
  grade?: string
  /** Contact email the family supplied ('' when absent). */
  contactEmail?: string
  /** Quotable reference (the ActivityLog row id minted by the trigger). */
  referenceId?: string
}

/** Props for 'salary-payment-recorded' (teacher salary confirmation). */
export interface SalaryPaymentEmailProps {
  teacherName: string
  /** Salary month, 'YYYY-MM'. */
  month: string
  /** Plain decimal string as stored, e.g. '12345.00'. */
  amount: string
}

/** Per-template prop payload (validated at RENDER time, not by types). */
export type EmailTemplateProps = AdmissionEnquiryEmailProps | SalaryPaymentEmailProps

/**
 * Tenant branding resolved server-side from the School row (minimal
 * columns only: name, shortName, themeColor, logoUrl). When schoolId
 * is absent or the school row is missing, the pipeline falls back to
 * neutral Scholario branding.
 */
export interface EmailBranding {
  schoolName: string
  shortName?: string
  /** Hex color ('#rrggbb'); sanitized before it touches HTML. */
  primaryColor: string
  /** Absolute http(s) URL only — relative paths are dropped. */
  logoUrl?: string
}

/** One fully-rendered email ready for a transport. */
export interface RenderedEmail {
  subject: string
  html: string
}

/**
 * The single send entry-point contract. `sendEmail` NEVER throws —
 * every outcome (sent / skipped / failed) comes back as a value.
 */
export interface EmailInput {
  to: string
  template: TemplateId
  props: EmailTemplateProps
  /** Tenant for branding + the EmailDelivery row (optional). */
  schoolId?: string
  /**
   * Idempotency key — the logical identity of the email (e.g.
   * 'admission-enquiry:<ActivityLog row id>'). A row with this key and
   * status SENT short-circuits the send as 'skipped'.
   */
  dedupeKey?: string
  /** Correlation id for log lines (request id at the call site). */
  requestId?: string
}

/**
 * Call-site tuning. The public admission form is latency-sensitive:
 * it passes `{ maxAttempts: 2 }` so the worst-case resend path stays
 * bounded (5s timeout + 250ms backoff + 5s timeout ≈ 10.3s) instead of
 * the default 3-attempt ≈ 15.3s envelope.
 */
export interface SendEmailOptions {
  /** Total transport attempts (default 3). 1 = no retries. */
  maxAttempts?: number
}

/**
 * Outcome of one sendEmail call.
 *
 *   status    'sent'    — delivered (resend 2xx, or dev transport)
 *             'skipped' — dedupeKey already has a SENT row (idempotent)
 *             'failed'  — invalid recipient / render failure / transport
 *                         exhausted (details in the row's lastError)
 *   transport which transport WOULD carry / carried the email
 *   attempts  transport attempts actually made (0 for pre-transport failures)
 */
export interface EmailResult {
  status: 'sent' | 'skipped' | 'failed'
  transport: 'resend' | 'dev-log'
  attempts: number
  /** Provider message id ('dev-log' in the dev transport). */
  messageId?: string
  /** EmailDelivery row id (when a row could be created). */
  deliveryId?: string
}

/** Diagnostics surface for health/status pages. */
export interface EmailTransportStatus {
  resendConfigured: boolean
}
