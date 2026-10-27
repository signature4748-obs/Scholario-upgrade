// ============================================================
// 8B-7-e — Central email infrastructure: TYPES
// ------------------------------------------------------------
// Server-only contract shared by the template renderer and the
// sendEmail pipeline (src/lib/email/index.ts). Phase 8B mission §7:
// one place that knows how transactional email leaves Scholario.
// Every payload is recorded in the EmailDelivery table (audit +
// idempotency via dedupeKey).
//
// PHASE A (email hardening) additions:
//   · EmailProviderId — the pipeline is provider-agnostic; adapters
//     live in src/lib/email/providers/ (resend REST, gmail-smtp,
//     dev-log) behind one ProviderAttempt shape.
//   · QUEUED status — a provider 2xx means "accepted into the
//     provider's queue", NOT delivered. SENT now requires delivery
//     EVIDENCE (Resend webhook `email.delivered` event; the dev-log
//     transport where the log line IS the delivery). Never report an
//     email as delivered when it was merely queued or rejected.
//   · Provider error classes — auth vs testing-restriction vs
//     unverified-domain vs rate-limit vs transient (provider-errors.ts).
//
// Do not import from Client Components — see the guard in index.ts.
// ============================================================

/**
 * The closed set of transactional email templates. Adding a template
 * means adding a renderer in templates.ts (exhaustively checked there);
 * anything outside this union is rejected loudly by the pipeline
 * (FAILED EmailDelivery row, never a crash).
 */
export type TemplateId =
  | 'admission-enquiry-received'
  | 'salary-payment-recorded'
  | 'platform-password-reset'
  | 'platform-recovery-link'
  | 'platform-password-changed'
  | 'school-password-reset'
  | 'school-password-changed'
  | 'principal-invite'

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

/** Props for 'platform-password-reset' (PlatformAdmin account recovery). */
export interface PlatformPasswordResetEmailProps {
  /** Admin display name (from the PlatformAdmin row). */
  adminName: string
  /** The full reset link INCLUDING the raw single-use token. */
  resetUrl: string
  /** Minutes until the link expires (display only). */
  expiresInMinutes: number
  /** Requester IP for the security notice footer (display only). */
  requestIp?: string
}

/**
 * ROOT-ADMIN LOGIN REPAIR — Props for 'platform-recovery-link': the
 * AUDITED recovery procedure's mail (delivered to the CANDIDATE
 * mailbox). Consuming the link sets a new password AND designates
 * the candidate address as the account identity. Deliberately NO
 * requestIp footer (the requester is an operator, not the mailbox
 * owner) and NO previous-address disclosure (forwardable-safe).
 */
export interface PlatformRecoveryLinkEmailProps {
  adminName: string
  resetUrl: string
  expiresInMinutes: number
}

/** ROOT-ADMIN LOGIN REPAIR — Props for 'platform-password-changed'. */
export interface PlatformPasswordChangedEmailProps {
  adminName: string
}

/**
 * Props for 'school-password-reset' (school Student & Staff account
 * recovery — docs/SCHOOL_ACCOUNT_RECOVERY.md). Same token-hygiene
 * contract as the platform reset: the raw single-use token exists ONLY
 * inside the emailed link.
 */
export interface SchoolPasswordResetEmailProps {
  /** User display name (from the User row; falls back to a neutral salutation). */
  userName: string
  /** The full reset link INCLUDING the raw single-use token. */
  resetUrl: string
  /** Minutes until the link expires (display only). */
  expiresInMinutes: number
  /** Requester IP for the security notice footer (display only). */
  requestIp?: string
}

/** Props for 'school-password-changed' (post-reset confirmation). */
export interface SchoolPasswordChangedEmailProps {
  /** User display name (from the User row). */
  userName: string
}

/** Props for 'principal-invite' (founding-principal credential delivery). */
export interface PrincipalInviteEmailProps {
  /** Principal display name (from the provisioned User row). */
  principalName: string
  /** School display name (the new tenant). */
  schoolName: string
  /** The school's canonical sign-in door (absolute or relative — rendered as a link). */
  loginUrl: string
  /**
   * The one-time bootstrap password — included ONLY when it was
   * generated server-side (the same convention as the provision
   * response's tempPassword field: a caller-supplied password is
   * never emailed). Omitted ⇒ the email honestly says the platform
   * team will hand it over.
   */
  tempPassword?: string
  /** True while the school is PENDING (sign-in works after activation). */
  pendingActivation: boolean
}

/** Per-template prop payload (validated at RENDER time, not by types). */
export type EmailTemplateProps =
  | AdmissionEnquiryEmailProps
  | SalaryPaymentEmailProps
  | PlatformPasswordResetEmailProps
  | PlatformRecoveryLinkEmailProps
  | PlatformPasswordChangedEmailProps
  | SchoolPasswordResetEmailProps
  | SchoolPasswordChangedEmailProps
  | PrincipalInviteEmailProps

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
 * every outcome comes back as a value.
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
   * status SENT or QUEUED short-circuits the send as 'skipped'.
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
 *   status    'sent'    — DELIVERED (dev transport: the log line IS
 *                         the delivery; or provider delivery evidence)
 *             'queued'  — provider ACCEPTED the message (2xx/250) but
 *                         delivery is unconfirmed — this is the honest
 *                         status for provider-accepted sends awaiting
 *                         a delivery event; NEVER reported as delivered
 *             'skipped' — dedupeKey already has a SENT/QUEUED row
 *                         (idempotent — accepted sends never re-fire)
 *             'failed'  — invalid recipient / render failure / provider
 *                         rejection / transport exhausted (details in
 *                         the row's lastError, with a `[class]` tag)
 *   transport which transport carried / would carry the email
 *   attempts  transport attempts actually made (0 for pre-transport failures)
 */
export interface EmailResult {
  status: 'sent' | 'queued' | 'skipped' | 'failed'
  transport: EmailProviderId
  attempts: number
  /** Provider message id ('dev-log' in the dev transport). */
  messageId?: string
  /** EmailDelivery row id (when a row could be created). */
  deliveryId?: string
}

/** The providers the pipeline can dispatch to (providers/*.ts). */
export type EmailProviderId = 'resend' | 'gmail-smtp' | 'dev-log'

/**
 * One provider attempt result — the adapter-neutral outcome the retry
 * loop reasons about. NEVER contains credentials.
 */
export interface ProviderAttempt {
  ok: boolean
  /** Provider message id on acceptance (queue id / SMTP accepted id). */
  messageId?: string
  /** Retry the same provider? (rate-limited / transient only) */
  retryable: boolean
  /** Typed failure class (when classifiable). */
  errorClass?: string
  /** Formatted error detail (status + provider body; no secrets). */
  error?: string
}

/** Diagnostics surface for health/status pages (booleans only). */
export interface EmailTransportStatus {
  resendConfigured: boolean
}

/**
 * Resolved provider for this process, honoring EMAIL_PROVIDER override:
 *   'resend' | 'gmail-smtp' | 'dev-log' | 'auto' (default).
 * Explicit overrides that lack their credentials resolve to
 * configured:false with configError — sends fail loudly (honest
 * misconfiguration) instead of silently falling back.
 */
export interface ResolvedProvider {
  id: EmailProviderId
  /** 'explicit' (EMAIL_PROVIDER) or 'auto' (credential detection). */
  selection: 'explicit' | 'auto'
  configured: boolean
  configError?: string
}
