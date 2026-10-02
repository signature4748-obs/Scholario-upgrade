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
  SEED_SHOWCASE_PRINCIPAL_PASSWORD,
  SEED_SHOWCASE_STUDENT_PASSWORD,
  SEED_SHOWCASE_TEACHER_PASSWORD,
  SEED_TENANT_FIXTURE_PASSWORD,
} from '../../prisma/seed-credentials'

/** Demo principal (Hawkings) — env-driven email override optional. */
export const DEMO_PRINCIPAL_EMAIL = process.env.TEST_DEMO_PRINCIPAL_EMAIL ?? 'principal@hawkingshigh.edu'

/** Password of the demo PRINCIPAL (principal@hawkingshigh.edu — its own family). */
export const DEMO_PRINCIPAL_PASSWORD = SEED_SHOWCASE_PRINCIPAL_PASSWORD

/** Password of the featured teacher (teacher1@hawkingshigh.edu). */
export const DEMO_TEACHER_1_PASSWORD = SEED_SHOWCASE_TEACHER_PASSWORD

/** Password of the featured student (7-A roll 01). */
export const DEMO_STUDENT_PASSWORD = SEED_SHOWCASE_STUDENT_PASSWORD

/** Password of every OTHER demo-tenant account (the default family). */
export const DEMO_FAMILY_PASSWORD = SEED_DEMO_PASSWORD

/**
 * The FEATURED STUDENT (7-A roll 01) — resolved from the deterministic
 * corpus (never a hardcoded generated address; the roster is the truth).
 * Env override for parity with the other identities.
 */
import { buildStudentRoster } from '../../prisma/hawkings-corpus'
import { DEMO_STUDENT_POSITION } from '../../prisma/seed-identity'
const FEATURED_STUDENT = buildStudentRoster().find(
  (s) => s.level === DEMO_STUDENT_POSITION.level && s.idx === DEMO_STUDENT_POSITION.idx,
)
export const DEMO_STUDENT_EMAIL =
  process.env.TEST_DEMO_STUDENT_EMAIL ?? FEATURED_STUDENT?.studentEmail ?? 'aman.sah@hawkingshigh.edu'

/** Featured teacher (faculty #1 — the 1-A class teacher). */
export const DEMO_TEACHER_1_EMAIL = process.env.TEST_DEMO_TEACHER_EMAIL ?? 'teacher1@hawkingshigh.edu'

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
