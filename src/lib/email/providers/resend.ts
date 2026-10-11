// ============================================================
// EMAIL PROVIDER: RESEND (REST)
// ------------------------------------------------------------
// ONE POST to https://api.resend.com/emails, bounded by a 5s
// AbortController timeout. NEVER throws (network errors/aborts come
// back as retryable outcomes). Error details carry status + a
// response-body excerpt — NEVER the Authorization header or API key.
//
// Failures are classified (provider-errors.ts) before they leave this
// module: a 403 "testing emails to your own email address" is
// testing-recipient-restricted (NOT auth-invalid — the key is fine),
// 401 is auth-invalid, 429/5xx/network retry, other 4xx permanent.
// ============================================================

import { classifyProviderHttpStatus, formatProviderError } from '../provider-errors'
import type { ProviderAttempt, RenderedEmail } from '../types'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 5_000
/** Body excerpt budget inside lastError (class tag + status line + body). */
const ERROR_DETAIL_MAX = 480

function briefError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * ONE Resend attempt. `from`/`to`/`rendered` make up the envelope;
// the API key is passed in by the caller — this function never
// touches env, keeping it trivially stubbable in tests.
 */
export async function resendAttempt(
  apiKey: string,
  from: string,
  to: string,
  rendered: RenderedEmail,
): Promise<ProviderAttempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS)
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject: rendered.subject, html: rendered.html }),
      signal: controller.signal,
    })
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null
      const messageId = body && typeof body.id === 'string' ? body.id : undefined
      // 2xx without a parseable id — accepted; the pipeline logs
      // 'ok_no_provider_id' loudly when the id is missing.
      return { ok: true, messageId, retryable: false }
    }
    const bodyText = await res.text().catch(() => '')
    const classification = classifyProviderHttpStatus(res.status, bodyText)
    const error = formatProviderError(
      classification.errorClass,
      `HTTP ${res.status}: ${bodyText.trim()}`,
      ERROR_DETAIL_MAX,
    )
    return { ok: false, retryable: classification.retryable, errorClass: classification.errorClass, error }
  } catch (e) {
    // Network failure or the 5s abort — both retryable by policy.
    return {
      ok: false,
      retryable: true,
      errorClass: 'transient',
      error: formatProviderError('transient', `network: ${briefError(e)}`, ERROR_DETAIL_MAX),
    }
  } finally {
    clearTimeout(timer)
  }
}
