'use client'

/**
 * Root segment error boundary (Phase 4 — item 5).
 *
 * Catches render errors INSIDE the root layout's page tree (below
 * layout.tsx, above global-error.tsx): the chrome (nav, footer) survives,
 * the failing segment is replaced by this boundary. Next.js passes a
 * `digest` — the SAME id Next logs server-side (next_request_error /
 * production error digest) — so a user-reported screen maps to the exact
 * server log line even without a requestId.
 *
 * global-error.tsx remains the last-resort boundary (layout itself fails);
 * not-found.tsx handles 404s; loading.tsx covers segment transitions.
 */
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Client-side mirror of the server diagnostic — include the digest so
    // support can correlate. Never log error internals beyond digest.
    console.error(
      JSON.stringify({
        channel: 'client',
        level: 'error',
        event: 'ui_error_boundary',
        digest: error.digest ?? null,
      }),
    )
  }, [error])

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center p-4 text-center"
    >
      <div className="max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-foreground">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This screen hit an unexpected error. Your data is safe — retry, or
          reload the page if it persists.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Reference: {error.digest.slice(0, 24)}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  )
}
