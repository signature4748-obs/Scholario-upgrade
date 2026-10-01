/**
 * seed-credentials — the single env-driven source for every demo/fixture
 * credential planted by the seed suite (Phase 8A credential-exposure
 * cleanup).
 *
 * WHY THIS EXISTS: before this module, demo passwords were hardcoded
 * literals scattered across the seed scripts AND printed to the seed
 * console output AND mirrored in the login UI quick-access chips. The
 * Phase-8A cleanup removed the login-surface exposure entirely and made
 * every remaining seeded credential env-driven:
 *
 *   • Seeds read these values when planting the demo/fixture accounts.
 *   • Automated tests import the SAME values (tests/helpers/credentials.ts
 *     re-exports this module) so the harness and the seed corpus can never
 *     drift apart — and CI can override any of them via environment
 *     variables without touching code.
 *
 * SECURITY POSTURE:
 *   • Server/test-side ONLY. This module must NEVER be imported from
 *     client code (src/components, src/lib client bundles). The regression
 *     guard tests/security/demo-credential-exposure.test.ts enforces that
 *     no client surface contains these literals.
 *   • All seed scripts hard-refuse to run under NODE_ENV=production, and
 *     the Phase-8A DATABASE_ENV=production lock blocks them fail-safe.
 *   • Defaults exist so the canonical dev/QA pipeline works out of the
 *     box; deployments rotate them by setting the env vars (documented in
 *     .env.example — empty placeholders, never real values).
 */

function envOr(name: string, fallback: string): string {
  const value = process.env[name]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** Demo-tenant family default (principal/teacher1/student1/N roster users). */
export const SEED_DEMO_PASSWORD = envOr('SEED_DEMO_PASSWORD', 'password123')

/** Legacy school-side super-admin rows (admin@erpsuite.io / admin@scholario.cloud). */
export const SEED_SUPERADMIN_PASSWORD = envOr('SEED_SUPERADMIN_PASSWORD', 'admin123')

/** Sunrise showcase trio (acceptance-testing identities for the demo tenant). */
export const SEED_SHOWCASE_PRINCIPAL_PASSWORD = envOr('SEED_SHOWCASE_PRINCIPAL_PASSWORD', 'principal123')
export const SEED_SHOWCASE_TEACHER_PASSWORD = envOr('SEED_SHOWCASE_TEACHER_PASSWORD', 'teacher123')
export const SEED_SHOWCASE_STUDENT_PASSWORD = envOr('SEED_SHOWCASE_STUDENT_PASSWORD', 'student123')

/** Platform control-plane root admin (admin@scholario.cloud). */
export const SEED_PLATFORM_ROOT_PASSWORD = envOr('SEED_PLATFORM_ROOT_PASSWORD', 'admin123')

/** Platform control-plane ops admin (ops@scholario.io). */
export const SEED_PLATFORM_OPS_PASSWORD = envOr('SEED_PLATFORM_OPS_PASSWORD', 'ops12345')

/**
 * Dev-preview TOTP secrets (base32) for the seeded platform admins — fixed
 * so the integration tests can compute the current code. NEVER used for
 * production admins (production enrollment generates random secrets).
 */
export const SEED_PLATFORM_ROOT_TOTP_SECRET = envOr('SEED_PLATFORM_ROOT_TOTP', 'JBSWY3DPEHPK3PXP')
export const SEED_PLATFORM_OPS_TOTP_SECRET = envOr('SEED_PLATFORM_OPS_TOTP', 'KRSXG5CTMVRXEZLU')

/** Tenant-isolation / clean-school fixture password (tenant.*@sunrise.test, principal.b@greenvalley.test). */
export const SEED_TENANT_FIXTURE_PASSWORD = envOr('SEED_TENANT_FIXTURE_PASSWORD', 'ScholarioTest2026')
