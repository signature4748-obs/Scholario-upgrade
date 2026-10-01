/**
 * seed-identity — the single source of truth for the Phase-8A two-tenant
 * ACCEPTANCE corpus identity map (8A-C4 "seeds-rebrand").
 *
 * Production starts clean. The corpus that may live on the
 * development/integration database is exactly two tenants:
 *
 *   · Sunrise Academy (slug `sunrise-academy`) — the DEMO tenant: full
 *     canonical corpus (structure identical to the legacy "Demo School of
 *     Scholario"/Greenwood corpus — same counts, same money amounts; only
 *     identity strings were rebranded). isDemo = true.
 *   · Green Valley Public School (slug `green-valley`) — the CLEAN
 *     tenant: bootstrap configuration only (school profile + branding
 *     skeleton + GradeScale + ExamTypeConfig + Room + principal/fixture
 *     users) and ZERO business data. isDemo = false.
 *
 * Rebrand map (mechanical, 8A-R3 census-informed):
 *   Demo School of Scholario → Sunrise Academy        (slug demo-school → sunrise-academy)
 *   @demoschool.edu          → @sunriseacademy.edu
 *   Greenwood / greenwood.edu.in → Sunrise / @sunriseacademy.edu
 *   Bluebell Intl Academy    → Green Valley Public School (slug bluebell-academy → green-valley)
 *   @bluebell.test           → @greenvalley.test
 *   tenant.*@scholario.test  → tenant.*@sunrise.test
 *
 * The two PROBE_* constants identify the tenant-isolation probe rows that
 * live INSIDE the Sunrise tenant; the domain seeds that rebuild school
 * data (seed-teacher-academics' CSA matrix, seed-study-materials'
 * material wipe) explicitly PRESERVE them — they are test infrastructure,
 * not principal-configured academics.
 */

/** Demo (full-corpus) tenant. */
export const DEMO_SCHOOL_SLUG = 'sunrise-academy'
export const DEMO_SCHOOL_NAME = 'Sunrise Academy'
export const DEMO_SCHOOL_CODE = 'SUNRISE'
export const DEMO_SCHOOL_DOMAIN = 'sunriseacademy.scholario.app'
export const DEMO_SCHOOL_EMAIL_DOMAIN = 'sunriseacademy.edu'

/** Clean (honest-zero) tenant. */
export const CLEAN_SCHOOL_SLUG = 'green-valley'
export const CLEAN_SCHOOL_NAME = 'Green Valley Public School'
export const CLEAN_SCHOOL_CODE = 'GVPS'

/** Tenant-isolation probe identifiers owned by the DEMO tenant. */
export const PROBE_SUBJECT_CODE = 'SR-MATH'
export const PROBE_MATERIAL_TITLE = 'Sunrise Maths Worksheet 1'
