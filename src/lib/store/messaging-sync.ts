'use client'

/**
 * PHASE 8B (Task 8B-7-d) — shared auto-refresh wiring for the
 * server-backed messaging stores (student + principal).
 *
 * The database is the single source of truth for every thread; these
 * listeners merely make the client CONVERGE on it sooner:
 *
 *   · window focus      — refetch when the user comes back (visible tab)
 *   · 'scholario:realtime-message' — a window CustomEvent a realtime
 *     bridge dispatches when a 'message' hint arrives for this user.
 *     Harmless if it never fires (the poll below still covers it).
 *   · every 60 seconds  — but ONLY while a thread view is open AND the
 *     document is visible (no background-tab traffic).
 *
 * Idempotent per store module (module-level attach guard). Listeners
 * live for the module's lifetime — the same lifetime as the store they
 * refresh.
 */

export interface MessagingAutoRefreshOptions {
  /** Re-fetch canonical state (thread list; the open thread if any). */
  refresh: () => Promise<void>
  /** True while a thread view is open (gates the 60-second poll). */
  hasOpenThread: () => boolean
}

const POLL_INTERVAL_MS = 60_000

export function attachMessagingAutoRefresh(opts: MessagingAutoRefreshOptions): void {
  if (typeof window === 'undefined') return

  const onFocus = () => {
    if (document.visibilityState === 'visible') void opts.refresh()
  }
  // The realtime bridge dispatches CustomEvent('scholario:realtime-message')
  // on window; a plain listener receives it (no payload contract needed —
  // the refetch pulls canonical rows).
  const onRealtimeHint = () => {
    if (document.visibilityState === 'visible') void opts.refresh()
  }
  const onPoll = () => {
    if (opts.hasOpenThread() && document.visibilityState === 'visible') {
      void opts.refresh()
    }
  }

  window.addEventListener('focus', onFocus)
  window.addEventListener('scholario:realtime-message', onRealtimeHint)
  window.setInterval(onPoll, POLL_INTERVAL_MS)
}

/** One-time purge of a retired localStorage persist key (base + every
 *  tenant-scoped `${base}::t:*` variant). The server-backed stores never
 *  persist — stale local threads must not survive as ghosts. */
export function purgeLegacyMessagingStorage(baseKey: string): void {
  if (typeof window === 'undefined') return
  try {
    const stale = Object.keys(window.localStorage).filter(
      (k) => k === baseKey || k.startsWith(`${baseKey}::t:`),
    )
    for (const k of stale) window.localStorage.removeItem(k)
  } catch {
    // Private-mode / blocked storage — nothing to purge.
  }
}
