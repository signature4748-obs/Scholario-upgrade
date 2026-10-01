/**
 * Env-driven test credential configuration (Phase 8A credential-exposure
 * cleanup).
 *
 * Automated tests that log in through the REAL auth APIs need credentials
 * for the seeded demo/fixture accounts. Those credentials are defined ONCE
 * in prisma/seed-credentials.ts (env-driven, shared with the seed scripts)
 * — this helper re-exports them so the test harness and the seed corpus can
 * never drift apart. CI may override any value via the SEED_* environment
 * variables (see .env.example); the defaults match the canonical dev/QA
 * database exactly, so the suite passes against the standard seed pipeline
 * with no extra configuration.
 *
 * NOTE: test-local fixture passwords for users the tests THEMSELVES create
 * (probe/threshold users) stay per-file — they are not seeded credentials.
 */
import {
  SEED_DEMO_PASSWORD,
  SEED_PLATFORM_OPS_PASSWORD,
  SEED_PLATFORM_OPS_TOTP_SECRET,
  SEED_PLATFORM_ROOT_PASSWORD,
  SEED_PLATFORM_ROOT_TOTP_SECRET,
  SEED_TENANT_FIXTURE_PASSWORD,
} from '../../prisma/seed-credentials'

/** Demo principal (Sunrise Academy) — env-driven email override optional. */
export const DEMO_PRINCIPAL_EMAIL = process.env.TEST_DEMO_PRINCIPAL_EMAIL ?? 'principal@sunriseacademy.edu'

/** Password for the seeded demo-tenant family (principal/teacher1/student1…). */
export const DEMO_PRINCIPAL_PASSWORD = SEED_DEMO_PASSWORD

/** Platform root admin credentials (admin@scholario.cloud). */
export const PLATFORM_ROOT_EMAIL = 'admin@scholario.cloud'
export const PLATFORM_ROOT_PASSWORD = SEED_PLATFORM_ROOT_PASSWORD
export const PLATFORM_ROOT_TOTP_SECRET = SEED_PLATFORM_ROOT_TOTP_SECRET

/** Platform ops admin credentials (ops@scholario.io). */
export const PLATFORM_OPS_EMAIL = 'ops@scholario.io'
export const PLATFORM_OPS_PASSWORD = SEED_PLATFORM_OPS_PASSWORD
export const PLATFORM_OPS_TOTP_SECRET = SEED_PLATFORM_OPS_TOTP_SECRET

/** Tenant-isolation / clean-school fixture password. */
export const TENANT_FIXTURE_PASSWORD = SEED_TENANT_FIXTURE_PASSWORD

export { SEED_DEMO_PASSWORD, SEED_TENANT_FIXTURE_PASSWORD }
