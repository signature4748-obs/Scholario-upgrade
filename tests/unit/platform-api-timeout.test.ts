/**
 * platformApi — the AbortController timeout (2026-10-16 fix-batch
 * regression, FIX 1).
 *
 * Every platformApi call is bounded by a timeout (default 30s,
 * per-call override) so a hung request (server stall, dropped
 * connection) surfaces a typed PlatformApiError with code `TIMEOUT`
 * instead of leaving busy states stuck forever. This unit-pins the
 * timeout path with a stubbed global fetch — NO database, NO HTTP
 * server (same pure-unit scope as platform-session-gate.test.ts; the
 * client-module import convention is the one established by the
 * tests/security/* client-helper suites).
 *
 * The stub mirrors real fetch semantics for the one behavior that
 * matters here: the returned promise never resolves on its own and
 * settles (rejects) only when the request's abort signal fires —
 * exactly what a real fetch does when its AbortController aborts.
 */
import { describe, test, expect, afterAll } from 'bun:test'

import { platformApi, type PlatformApiError } from '@/components/platform/platform-client'

const realFetch = globalThis.fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

/** A fetch that HANGS forever unless the caller aborts it (the real
 *  fetch contract for an aborted in-flight request). */
function stubHungFetch(): void {
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new DOMException('This operation was aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      })
    })
  }) as typeof fetch
}

describe('platformApi — AbortController timeout', () => {
  test(
    'a hung fetch settles as a typed TIMEOUT error (ok=false, code TIMEOUT) within the budget',
    async () => {
      stubHungFetch()
      const timeoutMs = 50
      const startedAt = Date.now()
      let caught: PlatformApiError | null = null
      try {
        // A never-settling server: without the timeout this await
        // would hang the caller's busy state forever.
        await platformApi<{ sessions: unknown[] }>(
          '/api/platform/support/sessions',
          undefined,
          timeoutMs,
        )
      } catch (e) {
        caught = e as PlatformApiError
      }
      const elapsed = Date.now() - startedAt

      // It REJECTED (never resolved) and settled around the budget —
      // not instantly (nothing raced the timer) and not never.
      expect(caught).not.toBeNull()
      expect(caught?.ok).toBe(false)
      expect(caught?.code).toBe('TIMEOUT')
      expect(String(caught?.error)).toContain('timed out')
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 5)
      expect(elapsed).toBeLessThan(5_000)
    },
    10_000,
  )
})
