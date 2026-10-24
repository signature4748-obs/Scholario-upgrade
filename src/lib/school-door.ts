// ============================================================
// school-door.ts — the per-school login door DECISION contract
// ------------------------------------------------------------
// THE DEFECT THIS MODULE LOCKS OUT (super-admin UX/routing fix,
// 2026-10): the school doors used to auto-replace to
// /?tenant=<slug> for ANY authenticated session — because the root
// route rendered the role dashboard for every school session, the
// console's "Open website" link landed the operator in the PRINCIPAL
// panel, and a session from ANOTHER tenant was silently bounced to
// its own dashboard from THIS school's door.
//
// THE SEMANTICS (audit §Issue 2, acceptance matrix):
//   · "Public Website" (/s/<slug> and /?tenant=<slug>) = the school's
//     PUBLIC homepage, regardless of any authenticated session — that
//     link must NEVER auto-redirect into a role dashboard.
//   · "School Login" (/s/<slug>/login, /login?tenant=<slug>) = the
//     sign-in ENTRY POINT for that school:
//       - unauthenticated → the sign-in form for THIS school;
//       - cached session belonging to THIS school → a DELIBERATE
//         continue to '/' (the session-driven dashboard — the visitor
//         is already signed into this exact school, a redundant form
//         would be hostile), never /?tenant=… (that URL means the
//         public website now);
//       - cached session belonging to a DIFFERENT school → THIS
//         school's form (no silent cross-tenant bounce; the visitor
//         keeps their other-tenant session);
//       - custom-domain door (no slug — the origin IS the school) →
//         continue: the session cookie is per-origin, so any session
//         on this origin already belongs to this school.
//
// Server-side tenant isolation is UNTOUCHED: the login POST still
// binds the session to the user's real schoolId, and every business
// API derives its tenant from the server session — never from these
// URLs. This module is the CLIENT-side routing decision only.
//
// Purity: every helper here is plane-agnostic and side-effect-free
// (unit-tested in tests/unit/school-door.test.ts; the live-HTTP
// contract is pinned in tests/regression/public-vs-login-doors.test.ts).
// ============================================================

/** What the caller knows about the door + the persisted auth cache. */
export interface SchoolDoorContext {
  /**
   * The CANONICAL server-resolved tenant slug of this door
   * (`null` ONLY for a domain-resolved custom-domain door, where the
   * origin itself belongs to exactly one school). An empty string is
   * NOT a custom domain — it is a malformed door that can never
   * confirm ownership.
   */
  doorSlug: string | null
  /**
   * The persisted client auth cache says a session exists. The cache
   * is a CACHE, never the authority — the server session is. A `true`
   * here triggers the server-truth probe (or the per-origin continue
   * on a custom domain).
   */
  cachedAuthenticated: boolean
}

/** What the door should do next. */
export type SchoolDoorDecision =
  /** Render the sign-in form for THIS school. */
  | { phase: 'form' }
  /**
   * Ask the server (/api/auth/me) whether the cached session actually
   * belongs to this door's school. Callers resolve the probe with
   * {@link resolveSchoolDoorProbe} and apply the outcome — including
   * any stale-cache cleanup — in the probe's OWN resolution step
   * (never from a separate effect: a cleanup effect watching the
   * cache races a fresh in-form sign-in and kills it).
   */
  | { phase: 'probe' }
  /**
   * A session for THIS school exists → deliberate continue to the
   * dashboard root. `target` is ALWAYS '/' — the session-driven
   * surface. It is never '/?tenant=…' (that link means the public
   * website) and never a role URL (the root route resolves the role).
   */
  | { phase: 'continue'; target: '/' }

/** The deliberate continue target: the dashboard root, session-driven. */
export const SCHOOL_DOOR_CONTINUE_TARGET = '/' as const

/** Boot-time decision from the door context. Pure. */
export function decideSchoolDoor(ctx: SchoolDoorContext): SchoolDoorDecision {
  if (!ctx.cachedAuthenticated) {
    // No cached session — nothing to probe; the honest form.
    return { phase: 'form' }
  }
  if (ctx.doorSlug === null) {
    // Custom-domain door: the session cookie is scoped to this
    // origin, and this origin belongs to exactly one school — any
    // session here is this school's. Continue without a probe.
    return { phase: 'continue', target: SCHOOL_DOOR_CONTINUE_TARGET }
  }
  // Shared-origin door (app origin / unified dev): the cookie is shared
  // across tenants — only the server can tell whose session this is.
  return { phase: 'probe' }
}

/** The server-truth answer a probe can produce. */
export type SchoolDoorProbeKind =
  /** /api/auth/me: a valid session that owns this door's school. */
  | 'same-school'
  /** /api/auth/me: a valid session for a DIFFERENT tenant. */
  | 'other-school'
  /** /api/auth/me 401: no valid server session (the cache was stale). */
  | 'unauthenticated'
  /** Transport failure / non-401 error: the truth is unknown. */
  | 'unavailable'

/**
 * The minimal /api/auth/me truth the decision needs: the session's own
 * school slug (server-derived, never URL-carried).
 */
export interface SchoolDoorProbeTruth {
  school?: { slug?: string | null } | null
}

/**
 * Map a /api/auth/me response onto the probe kind for a door.
 *
 * · ok + session school slug === doorSlug → 'same-school'
 * · ok + any other identity (other tenant, or a session whose school
 *   slug is missing) → 'other-school' — ownership can never be
 *   confirmed for this door
 * · 401 → 'unauthenticated' (the cached client session is stale)
 * · any other status / transport failure → 'unavailable' (never guessed)
 */
export function classifySchoolDoorProbe(
  doorSlug: string,
  response: { ok: boolean; status: number },
  truth: SchoolDoorProbeTruth | null,
): SchoolDoorProbeKind {
  if (!response.ok) {
    return response.status === 401 ? 'unauthenticated' : 'unavailable'
  }
  const sessionSlug = truth?.school?.slug
  if (typeof sessionSlug === 'string' && sessionSlug.length > 0 && sessionSlug === doorSlug) {
    return 'same-school'
  }
  return 'other-school'
}

/**
 * Resolve the probe into the next decision. Pure.
 *
 * Callers: when the kind is 'unauthenticated', clear the stale cache
 * HERE — in the same resolution step that produces this decision — and
 * never from a separate effect. For 'other-school' and 'unavailable'
 * the cache is KEPT: the other-tenant session may be perfectly valid,
 * and an unknown truth never justifies destroying client state.
 */
export function resolveSchoolDoorProbe(kind: SchoolDoorProbeKind): SchoolDoorDecision {
  if (kind === 'same-school') {
    return { phase: 'continue', target: SCHOOL_DOOR_CONTINUE_TARGET }
  }
  // other-school | unauthenticated | unavailable → the honest form for
  // THIS school (the sign-in POST will surface any transport problem).
  return { phase: 'form' }
}
