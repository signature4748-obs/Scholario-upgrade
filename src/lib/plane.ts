/**
 * plane — SCHOLARIO deployment-plane identity (two-Vercel-project
 * architecture).
 *
 * ONE GitHub repository builds TWO Vercel applications from the SAME
 * codebase:
 *
 *   scholario-platform (SCHOLARIO_PLANE=platform)
 *     · The control plane ONLY: /platform/* console + /api/platform/*.
 *     · School doors (/s/*, /login, school APIs) do not exist there.
 *
 *   scholario-app (SCHOLARIO_PLANE=school)
 *     · The school plane ONLY: /s/<slug> doors, /login, the ERP APIs.
 *     · /platform/* and /api/platform/* do not exist there.
 *
 *   unified (SCHOLARIO_PLANE unset or 'unified')
 *     · BOTH planes served from one deployment — the legacy
 *       scholario-production behavior, byte-compatible. Every existing
 *       deployment that does not set the variable keeps working exactly
 *       as before (fail-open to the current production topology).
 *
 * The value is set PER VERCEL PROJECT as an environment variable (same
 * repo, same build, different plane). Middleware enforces the boundary
 * at the edge (src/middleware.ts); API handlers keep their own
 * withUser / withPlatform authorization — the plane gate is route
 * existence, NOT authorization. Authorization is unchanged:
 *
 *   Supabase = Postgres + Storage + Realtime (NO Supabase Auth users)
 *   Custom scrypt sessions = who you are (User / PlatformAdmin rows)
 *   withUser / withPlatform = what you are allowed to do
 *
 * See docs/VERCEL_PROJECTS.md for the deployment map and
 * docs/AUTH_ARCHITECTURE.md for the identity model.
 */

export type Plane = 'platform' | 'school' | 'unified'

function readPlane(): Plane {
  const raw = process.env.SCHOLARIO_PLANE
  if (typeof raw !== 'string') return 'unified'
  const v = raw.trim().toLowerCase()
  if (v === 'platform' || v === 'school' || v === 'unified') return v
  // Unrecognized value → 'unified' (fail-open to the legacy topology:
  // a typo'd plane value must never silently delete half the product).
  return 'unified'
}

/** The deployment plane (memoized per process). */
export const PLANE: Plane = readPlane()

/** True when this deployment serves the platform control plane. */
export function planeServesPlatform(): boolean {
  return PLANE === 'platform' || PLANE === 'unified'
}

/** True when this deployment serves the school ERP plane. */
export function planeServesSchool(): boolean {
  return PLANE === 'school' || PLANE === 'unified'
}

// ─── Platform-plane API surface ──────────────────────────────────────────
//
// Shared infrastructure every plane serves regardless of role:
//   /api              heartbeat (service up + version)
//   /api/app-version  VersionGuard poll
//   /api/webhooks/*   provider-signed webhooks (Resend, Razorpay,
//                     platform-subscription) — signature-verified
//                     endpoints, plane-independent
//
// Control-plane-only APIs:
//   /api/platform/*   the platform console's API surface
//
// Everything else under /api/* is SCHOOL-plane surface (school auth,
// public school branding, ERP modules) and does not exist on the
// platform plane.

/** Shared API routes served on EVERY plane. */
export function isSharedApiRoute(pathname: string): boolean {
  if (pathname === '/api' || pathname === '/api/') return true
  if (pathname.startsWith('/api/app-version')) return true
  if (pathname.startsWith('/api/webhooks/')) return true
  return false
}

/**
 * Platform-plane API allowlist: shared infra + the control-plane API
 * surface. Used by the middleware edge gate — a route NOT on this list
 * is a school-plane route and 404s on the platform project.
 */
export function platformPlaneApiAllowed(pathname: string): boolean {
  if (isSharedApiRoute(pathname)) return true
  if (pathname.startsWith('/api/platform/')) return true
  return false
}

// ─── School-plane platform exemptions ────────────────────────────────────
//
// The school login door renders the platform's PUBLIC broadcast banner
// (maintenance windows, incident notices). It is an anonymous, public,
// read-only endpoint with no identity — a deliberate cross-plane
// exemption (the banner degrades silently when unreachable by design).
const SCHOOL_PLANE_PLATFORM_EXEMPT = new Set<string>([
  '/api/platform/announcements/public',
])

/**
 * School-plane platform-route exemption check: the ONE public platform
 * endpoint the school door may read. Everything else under
 * /platform/* / /api/platform/* does not exist on the school project.
 */
export function schoolPlanePlatformExempt(pathname: string): boolean {
  return SCHOOL_PLANE_PLATFORM_EXEMPT.has(pathname)
}

// ─── Canonical school URLs (cross-plane) ─────────────────────────────────
//
// SCHOOL_APP_BASE_URL (server-side env, set on the PLATFORM project)
// points at the school-plane deployment origin, e.g.
// https://scholario-app.vercel.app. The platform console uses it to
// surface each school's canonical login URL — admins must never guess.
//
// When unset (local dev, the unified legacy deployment), the helper
// degrades to a SAME-ORIGIN RELATIVE path: the unified deployment
// serves both planes, so /s/<slug>/login on its own origin is correct.
// ────────────────────────────────────────────────────────────────────────

function schoolAppBaseUrl(): string | null {
  const raw = process.env.SCHOOL_APP_BASE_URL
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/\/+$/, '')
  if (!v) return null
  return v
}

function safeSlug(slug: string): string {
  return encodeURIComponent(slug.trim().toLowerCase())
}

/**
 * The school's canonical LOGIN URL (the door the principal/staff/
 * student/parent sign in through):
 *   <SCHOOL_APP_BASE_URL>/s/<slug>/login   (two-project topology)
 *   /s/<slug>/login                        (unified fallback)
 */
export function schoolLoginUrl(slug: string): string {
  const base = schoolAppBaseUrl()
  return base ? `${base}/s/${safeSlug(slug)}/login` : `/s/${safeSlug(slug)}/login`
}

/**
 * The school's canonical PUBLIC URL (tenant website):
 *   <SCHOOL_APP_BASE_URL>/s/<slug>          (two-project topology)
 *   /?tenant=<slug>                         (unified fallback)
 */
export function schoolPublicUrl(slug: string): string {
  const base = schoolAppBaseUrl()
  return base ? `${base}/s/${safeSlug(slug)}` : `/?tenant=${safeSlug(slug)}`
}

/** True when school URLs are absolute cross-project links. */
export function schoolUrlsAreCrossPlane(): boolean {
  return schoolAppBaseUrl() !== null
}
