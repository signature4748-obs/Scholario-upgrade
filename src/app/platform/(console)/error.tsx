'use client'

/**
 * (console)-scoped error boundary — Phase 2 item 1 of the PR #31
 * stability hardening.
 *
 * WHY THIS EXISTS: before it, ANY render error inside a console page
 * (Overview/Schools/Subscriptions/…/school workspace) bubbled to the
 * ROOT boundary (src/app/error.tsx), which replaced the ENTIRE control
 * plane — nav, session, context — with a generic "Something went wrong"
 * card: the screen from the user's report. Next.js segment boundaries
 * let us catch the failure at the (console) group instead: this
 * boundary renders INSIDE the console layout, so the shell — sidebar
 * navigation, admin identity, sign-out — survives and the operator can
 * still navigate away.
 *
 * CONTENTS (per the hardening spec):
 *   · Try again     — the segment reset (Next re-renders the page).
 *   · Reload page   — full document reload for stuck client state.
 *   · Back to Schools — the primary recovery route for school-centric
 *     workflows (Link, not history.back, so it always lands somewhere
 *     known-good).
 *   · Reference     — the error digest (the same id Next logs
 *     server-side), truncated, copyable, NEVER the error internals.
 *   · Mutation warning — because a render error can strike right after
 *     a submit, the boundary tells operators to CHECK whether the
 *     action completed (audit log / the target surface) before
 *     repeating it, rather than blindly resubmitting.
 *
 * The console shell around it keeps the session; sign-out stays one
 * click away. No error details, stack frames or query text ever reach
 * the client here — only the digest.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, RefreshCw, RotateCcw, Copy, Check } from 'lucide-react'

export default function PlatformConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Client-side mirror of the server diagnostic — digest only (the id
    // Next also logs server-side for this error), never internals.
    console.error(
      JSON.stringify({
        channel: 'client',
        level: 'error',
        event: 'platform_console_error_boundary',
        digest: error.digest ?? null,
      }),
    )
  }, [error])

  const digest = error.digest ?? null
  const shortDigest = digest ? digest.slice(0, 24) : null

  const copyDigest = async () => {
    if (!shortDigest) return
    try {
      await navigator.clipboard.writeText(shortDigest)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (permissions/iframe) — the digest stays
      // visible on screen for manual transcription.
    }
  }

  return (
    <div
      role="alert"
      aria-labelledby="console-error-heading"
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
        </span>
        <div>
          <h2
            id="console-error-heading"
            className="font-display text-lg font-bold tracking-tight text-slate-900"
          >
            This console page hit an unexpected error
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            The rest of the control plane is still available — use the navigation to move on, or
            retry below.
          </p>
        </div>
      </div>

      <div className="w-full rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">If you just performed an action (save, suspend, assign…)</p>
        <p className="mt-0.5">
          Check whether it completed — open the target surface or the Audit log — before
          repeating it. Re-submitting a mutation that already succeeded can double-apply it.
        </p>
      </div>

      {shortDigest ? (
        <div className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Diagnostic reference
            </p>
            <p className="truncate font-mono text-xs text-slate-700">{shortDigest}</p>
          </div>
          <button
            type="button"
            onClick={copyDigest}
            aria-label={copied ? 'Reference copied' : 'Copy diagnostic reference'}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 focus-ring"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-ring"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-ring"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reload page
        </button>
        <Link
          href="/platform/schools"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Schools
        </Link>
      </div>
    </div>
  )
}
