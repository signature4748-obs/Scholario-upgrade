/**
 * platform/mfa-config — the SINGLE switch for Platform Admin TOTP/MFA.
 *
 * PRODUCT-DIRECTION RESET (Part 1) — mandatory TOTP on the platform
 * control plane is TEMPORARILY DISABLED. The intended sign-in for this
 * phase is email + password only.
 *
 * This is a policy switch, NOT a removal:
 *  · the full RFC 6238 TOTP implementation stays intact
 *    (lib/platform/totp.ts, PlatformAdmin.totpSecret, verification
 *    routes, session step-up bookkeeping);
 *  · every enforcement point consults isPlatformTotpEnabled(), so
 *    re-enabling MFA later = flip the env flag — no code surgery;
 *  · school-user authentication and tenant isolation are NOT affected
 *    (they never used platform TOTP);
 *  · this is not an authentication bypass: the password check, the
 *    dual rate limits, the audit trail and the session cookie all stay
 *    exactly as they were. Only the second-factor challenge is stood
 *    down, deliberately, until proper MFA returns after the core SaaS
 *    workflow is complete.
 *
 * Flag: PLATFORM_TOTP_ENABLED=1 turns the challenge back on.
 * (Read per-request on purpose: an env change + process restart is
 * enough to move between postures — no schema or code change needed.)
 */
export function isPlatformTotpEnabled(): boolean {
  return process.env.PLATFORM_TOTP_ENABLED === '1'
}
