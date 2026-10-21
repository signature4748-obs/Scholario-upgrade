import Link from 'next/link'

import { PLANE } from '@/lib/plane'

/**
 * Root not-found boundary — PLANE-AWARE recovery (ROOT-ADMIN ROUTING
 * REPAIR, 2026-10-21).
 *
 * WHY: this one boundary is the 404 page for BOTH production
 * deployments (the same repository builds scholario-platform and
 * scholario-app). Before the repair its only recovery control was
 * "Return to home" → "/":
 *
 *   · SCHOOL plane — CORRECT: "/" is the public school portal root.
 *   · PLATFORM plane — WRONG: the platform deployment has no public
 *     surface; its middleware 307-redirects "/" to /platform/login (the
 *     control plane's only entry). So an authenticated Super Admin who
 *     hit ANY 404 (e.g. the then-broken /platform/audit, or a stale
 *     bookmark) was bounced to the sign-in page — the reported "Go to
 *     Home sends me to login" bug. A 404 inside the control plane must
 *     recover INSIDE the control plane.
 *
 * The recovery therefore follows the deployment plane (src/lib/plane —
 * the same env-driven gate the middleware uses):
 *
 *   · platform → "Back to Overview" (/platform — the canonical Super
 *     Admin home; the sidebar, logo and session gate all resolve there)
 *     plus the sign-in door as the secondary control. No bare "/" link
 *     exists in this variant (that path IS the login bounce).
 *   · school/unified → the original school-portal recovery, unchanged.
 *
 * The status stays an honest 404 — no silent redirect, no redirect
 * loop, nothing leaked. On the platform plane the middleware page gate
 * still runs FIRST (no platform cookie → 307 to /platform/login), so
 * this variant only renders for credential-holders — exactly the
 * operators whose recovery must stay in-plane. Unauthenticated visitors
 * to the school plane keep the public 404 unchanged.
 */
export default function NotFound() {
  if (PLANE === 'platform') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-center">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="font-display text-4xl font-extrabold tracking-tight text-slate-900">404</p>
          <h1 className="mt-2 font-display text-lg font-bold tracking-tight text-slate-900">
            This control-plane page does not exist
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            The address may be mistyped, or the page was moved or removed. Your session is unaffected.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/platform"
              className="inline-flex h-10 items-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-ring"
            >
              Back to Overview
            </Link>
            <Link
              href="/platform/login"
              className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-ring"
            >
              Sign-in page
            </Link>
          </div>
          <p className="mt-6 text-[11px] uppercase tracking-wide text-slate-400">
            SCHOLARIO Control Plane
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">404</h1>
      <p className="mt-2 text-base text-gray-600">Page or resource not found.</p>
      {/* ARCHITECTURE RESET — honest surface label: / is the public school
          surface, not a "dashboard". No invented navigation claims. */}
      <Link
        href="/"
        className="mt-6 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
      >
        Return to home
      </Link>
    </div>
  )
}
