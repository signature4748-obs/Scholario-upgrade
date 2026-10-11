// ============================================================
// EMAIL PROVIDER ERROR CLASSIFICATION
// ------------------------------------------------------------
// Phase A (email diagnosis): one place that turns a provider
// HTTP/transport failure into a TYPED, actionable class, so the
// outbox (EmailDelivery.lastError), logs and the admin
// diagnostics endpoint can distinguish:
//
//   auth-invalid                — 401: key missing/invalid/revoked
//   testing-recipient-restricted — 403: provider testing mode
//                                 (Resend: "You can only send testing
//                                 emails to your own email address …")
//   unverified-sender-domain    — 403/422: from-domain not verified
//                                 (the non-testing variant)
//   rate-limited                — 429: retry with backoff
//   transient                   — 5xx / network: retry
//   invalid-request             — other 4xx: permanent, fix payload
//   unknown                     — unclassifiable: permanent by default
//
// THE LESSON THIS ENCODES (production 2026-10): all 7 production
// failures were HTTP 403 "testing emails to your own email address" —
// an AUTHENTICATED, VALID key whose account simply has no verified
// sending domain. Mislabeling that as "invalid API key" would send the
// owner rotating a perfectly good key. The 403 is NOT an auth error.
//
// The classification is a PURE function — fully unit-testable, no
// fetch, no env, no DB. Error strings it produces NEVER contain
// credentials (they carry status + provider response body only).
// ============================================================

export type EmailErrorClass =
  | 'auth-invalid'
  | 'testing-recipient-restricted'
  | 'unverified-sender-domain'
  | 'rate-limited'
  | 'transient'
  | 'invalid-request'
  | 'provider-config'
  | 'unknown'

export interface ProviderErrorClassification {
  errorClass: EmailErrorClass
  /** Same-provider retry worthwhile? (rate-limited / transient only) */
  retryable: boolean
  /** Operator-facing remediation hint. No secrets, ever. */
  hint: string
}

/** Matches Resend's testing-mode restriction (owner-only delivery). */
const TESTING_RECIPIENT_RE =
  /only send testing emails to your own email address|testing emails? to (?:your|the) (?:account[- ]owner|own)/i

/** Matches the domain-verification family WITHOUT the testing phrase. */
const UNVERIFIED_DOMAIN_RE =
  /verify (?:a )?domain|domain (?:is )?not (?:yet )?verified|not(?: yet)? verified|unverified (?:sender|domain)|only send (?:emails|messages) from (?:a )?verified/i

/** Classify a provider HTTP failure (status + response body text). */
export function classifyProviderHttpStatus(status: number, bodyText: string): ProviderErrorClassification {
  const body = bodyText ?? ''

  if (status === 401) {
    return {
      errorClass: 'auth-invalid',
      retryable: false,
      hint: 'Provider API key is missing, invalid or revoked. Rotate/update the key in the provider dashboard and the server env.',
    }
  }

  if (status === 403) {
    // Order matters: Resend's testing-mode message ALSO mentions domain
    // verification as the remediation — the precise diagnosis is the
    // recipient restriction, not "invalid key" and not merely "domain".
    if (TESTING_RECIPIENT_RE.test(body)) {
      return {
        errorClass: 'testing-recipient-restricted',
        retryable: false,
        hint: 'Provider account is in testing mode: only the account-owner address is deliverable until a sending domain is verified. This is NOT an invalid API key — do not rotate the key for this error.',
      }
    }
    if (UNVERIFIED_DOMAIN_RE.test(body)) {
      return {
        errorClass: 'unverified-sender-domain',
        retryable: false,
        hint: 'The from-address domain is not verified with the provider. Verify the domain (or use the provider sandbox sender within its restrictions).',
      }
    }
    return {
      errorClass: 'unknown',
      retryable: false,
      hint: 'Provider rejected the request with 403. Check the provider dashboard for account restrictions.',
    }
  }

  if (status === 422 && UNVERIFIED_DOMAIN_RE.test(body)) {
    return {
      errorClass: 'unverified-sender-domain',
      retryable: false,
      hint: 'The from-address domain is not verified with the provider.',
    }
  }

  if (status === 429) {
    return {
      errorClass: 'rate-limited',
      retryable: true,
      hint: 'Provider rate limit hit — the pipeline retries with bounded backoff.',
    }
  }

  if (status >= 500) {
    return {
      errorClass: 'transient',
      retryable: true,
      hint: 'Provider server error — the pipeline retries with bounded backoff.',
    }
  }

  if (status >= 400) {
    return {
      errorClass: 'invalid-request',
      retryable: false,
      hint: 'Provider rejected the payload (validation). Permanent — fix the request, do not retry.',
    }
  }

  return {
    errorClass: 'unknown',
    retryable: false,
    hint: 'Unclassified provider failure.',
  }
}

/**
 * Classify a transport-level (non-HTTP) failure — SMTP error codes and
 * nodemailer/network error codes.
 *
 *   421 / 450      → transient (server busy / greylisted)
 *   535            → auth-invalid (bad credentials)
 *   5xx (SMTP)     → invalid-request (permanent bounce family)
 *   EAUTH          → auth-invalid
 *   network codes  → transient
 */
export function classifyProviderTransportError(errorCode: string | undefined, smtpResponse: string): ProviderErrorClassification {
  const code = (errorCode ?? '').toUpperCase()
  const resp = (smtpResponse ?? '').trim()

  const m = resp.match(/^(\d{3})\b/)
  const smtpCode = m ? Number(m[1]) : null

  if (code === 'EAUTH' || smtpCode === 535) {
    return {
      errorClass: 'auth-invalid',
      retryable: false,
      hint: 'SMTP credentials rejected. Check the SMTP user + app password (Gmail requires a 16-char App Password with 2FA enabled).',
    }
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'ESOCKET' ||
    code === 'EENVELOPE' ||
    smtpCode === 421 ||
    smtpCode === 450
  ) {
    return {
      errorClass: 'transient',
      retryable: true,
      hint: 'SMTP connection/timeout failure — retryable.',
    }
  }
  if (smtpCode !== null && smtpCode >= 500) {
    return {
      errorClass: 'invalid-request',
      retryable: false,
      hint: 'SMTP permanent rejection (5xx) — address/policy rejected; do not retry.',
    }
  }
  return {
    errorClass: 'unknown',
    retryable: false,
    hint: 'Unclassified SMTP/transport failure.',
  }
}

/** Prefix width for the machine-parseable class tag in lastError. */
const CLASS_TAG_MAX = 32

/**
 * Format a failure for EmailDelivery.lastError:
 *   `[<class>] HTTP <status>: <body>` (or `[<class>] smtp: <detail>`),
 * clipped to fit the column budget. The class tag prefix makes the
 * diagnostics endpoint able to aggregate failures without re-parsing
 * provider prose.
 */
export function formatProviderError(errorClass: EmailErrorClass, detail: string, max = 480): string {
  const tag = `[${errorClass.slice(0, CLASS_TAG_MAX)}]`
  const clipped = detail.trim().length > max - tag.length - 1 ? `${detail.trim().slice(0, max - tag.length - 2)}…` : detail.trim()
  return `${tag} ${clipped}`
}

/** Parse the class tag back out of a stored lastError (diagnostics). */
export function parseErrorClass(lastError: string | null | undefined): EmailErrorClass | null {
  if (!lastError) return null
  const m = lastError.match(/^\[([a-z-]+)\]/)
  if (!m) return null
  const candidate = m[1] as EmailErrorClass
  const valid: EmailErrorClass[] = [
    'auth-invalid',
    'testing-recipient-restricted',
    'unverified-sender-domain',
    'rate-limited',
    'transient',
    'invalid-request',
    'provider-config',
    'unknown',
  ]
  return valid.includes(candidate) ? candidate : null
}
