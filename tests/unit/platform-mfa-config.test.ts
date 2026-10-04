/**
 * Platform MFA policy switch — unit contract (Product Direction Reset).
 *
 * PLATFORM_TOTP_ENABLED is the SINGLE switch that stands the platform
 * TOTP challenge up or down. This file pins the re-enable contract:
 * flipping the env flag is enough to move between postures — no code
 * surgery. The HTTP-level posture while OFF is pinned by AUTH-09
 * (tests/security/auth-gate.test.ts) and PHASE 6
 * (tests/security/platform-isolation.test.ts).
 *
 * Env mutation is save/restored per-test (bun runs tests in one process;
 * leaving the flag set would poison every other suite).
 */
import { describe, test, expect, afterEach } from 'bun:test'

import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'

const FLAG = 'PLATFORM_TOTP_ENABLED'
const PREV = process.env[FLAG]

afterEach(() => {
  if (PREV === undefined) delete process.env[FLAG]
  else process.env[FLAG] = PREV
})

describe('PLATFORM_TOTP_ENABLED · the single MFA policy switch', () => {
  test('unset (default) or explicitly off → platform TOTP stood down', () => {
    delete process.env[FLAG]
    expect(isPlatformTotpEnabled()).toBe(false)
    process.env[FLAG] = '0'
    expect(isPlatformTotpEnabled()).toBe(false)
    // Only the exact enable value counts — no accidental truthy strings.
    process.env[FLAG] = 'true'
    expect(isPlatformTotpEnabled()).toBe(false)
  })

  test("= '1' → the challenge returns (re-enable = flip the flag, nothing else)", () => {
    process.env[FLAG] = '1'
    expect(isPlatformTotpEnabled()).toBe(true)
  })

  test('read per-request: posture can move without process restart of the flag itself', () => {
    delete process.env[FLAG]
    expect(isPlatformTotpEnabled()).toBe(false)
    process.env[FLAG] = '1'
    expect(isPlatformTotpEnabled()).toBe(true)
    delete process.env[FLAG]
    expect(isPlatformTotpEnabled()).toBe(false)
  })
})
