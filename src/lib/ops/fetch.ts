/**
 * Ops provider fetch — bounded HTTP for management-API adapters.
 *
 * Every external provider call in the ops center goes through
 * `opsFetch()`:
 *   · hard timeout via AbortController (provider-specific defaults, all
 *     bounded — a hung provider must never hang a dashboard request);
 *   · JSON parsing with a body-size guard;
 *   · typed failure classes (no error text leaks credentials; provider
 *     error bodies are passed through `redactDetail` before surfacing);
 *   · a tiny retry with exponential backoff for TRANSIENT failures only
 *     (network errors + 5xx + 429). 4xx = permanent, never retried.
 */

import { redactDetail } from '@/lib/observability/redact'

export class OpsFetchError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'parse',
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'OpsFetchError'
  }
  /** Transient → retried by opsFetch; permanent → surfaced as failure. */
  get transient(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true
    if (this.kind === 'http') {
      const s = this.status ?? 0
      return s >= 500 || s === 429
    }
    return false
  }
}

export interface OpsFetchOptions {
  timeoutMs?: number
  attempts?: number
  /** Extra headers (Authorization added by callers — never logged). */
  headers?: Record<string, string>
}

const MAX_BODY_BYTES = 256 * 1024

export async function opsFetch(url: string, opts: OpsFetchOptions = {}): Promise<unknown> {
  const attempts = Math.max(1, Math.min(3, opts.attempts ?? 2))
  const timeoutMs = opts.timeoutMs ?? 8_000
  let lastError: OpsFetchError | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: opts.headers, signal: controller.signal, cache: 'no-store' })
      if (!res.ok) {
        const bodyText = (await res.text().catch(() => '')).slice(0, 600)
        lastError = new OpsFetchError('http', res.status, `HTTP ${res.status}: ${redactDetail(bodyText, 240)}`)
        if (!lastError.transient || attempt === attempts) throw lastError
      } else {
        const raw = await res.text()
        if (raw.length > MAX_BODY_BYTES) {
          throw new OpsFetchError('parse', res.status, 'response body exceeds size guard')
        }
        try {
          return JSON.parse(raw)
        } catch {
          throw new OpsFetchError('parse', res.status, 'response is not valid JSON')
        }
      }
    } catch (e) {
      if (e instanceof OpsFetchError) {
        if (!e.transient || attempt === attempts) throw e
        lastError = e
      } else if (e instanceof Error && e.name === 'AbortError') {
        lastError = new OpsFetchError('timeout', null, `timeout after ${timeoutMs}ms`)
        if (attempt === attempts) throw lastError
      } else {
        lastError = new OpsFetchError('network', null, e instanceof Error ? e.message : String(e))
        if (attempt === attempts) throw lastError
      }
    } finally {
      clearTimeout(timer)
    }
    // bounded backoff before the next attempt (transient only)
    await new Promise((r) => setTimeout(r, 200 * attempt))
  }
  throw lastError ?? new OpsFetchError('network', null, 'unreachable')
}
