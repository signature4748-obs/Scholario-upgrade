/**
 * STAGE B regression (2026-10-16) — the console session gate must never
 * resolve a 5xx/auth-me failure into an unlabelled skeleton.
 *
 * Reproduction being guarded: with the database down, GET /api/platform/auth/me
 * returns 500 DATABASE_FAILURE. The provider used to leave `me=null,
 * loading=false` — ConsoleShell's `if (loading || !me)` then rendered the boot
 * skeleton FOREVER (the reported "stuck skeleton / blank console"). The fix
 * classifies every outcome explicitly (src/lib/platform/session-gate.ts) and
 * the shell renders a retryable "Control plane unavailable" state.
 *
 * Pure-function scope: NO database, NO HTTP.
 */
import { describe, test, expect } from 'bun:test'
import { classifyAuthMe } from '@/lib/platform/session-gate'

describe('classifyAuthMe — session-gate outcomes', () => {
  test('401 is the only unauthenticated outcome (redirects to login)', () => {
    expect(classifyAuthMe(401, false)).toBe('unauthenticated')
    expect(classifyAuthMe(401, true)).toBe('unauthenticated')
  })

  test('2xx with an ok envelope authenticates', () => {
    expect(classifyAuthMe(200, true)).toBe('authenticated')
    expect(classifyAuthMe(204, true)).toBe('authenticated')
  })

  test('5xx (database down / control-plane failure) is unavailable — never a silent no-op', () => {
    expect(classifyAuthMe(500, false)).toBe('unavailable')
    expect(classifyAuthMe(503, false)).toBe('unavailable')
    expect(classifyAuthMe(502, true)).toBe('unavailable')
  })

  test('network exception (status 0) is unavailable', () => {
    expect(classifyAuthMe(0, false)).toBe('unavailable')
  })

  test('broken envelope on 2xx is unavailable (contract anomaly, not success)', () => {
    expect(classifyAuthMe(200, false)).toBe('unavailable')
  })

  test('403 is unavailable (not a login redirect — authorization is server-side)', () => {
    expect(classifyAuthMe(403, false)).toBe('unavailable')
  })
})
