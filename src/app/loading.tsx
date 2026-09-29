/**
 * Root segment loading state (Phase 4 — item 5).
 *
 * Suspense fallback for the root route segment — shown while the server
 * streams the initial payload. Deliberately minimal and un-animated-heavy:
 * this renders on EVERY cold navigation of `/`.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-[60vh] items-center justify-center p-4"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}
