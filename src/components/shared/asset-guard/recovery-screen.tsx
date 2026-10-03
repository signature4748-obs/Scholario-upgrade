'use client'

/**
 * React-side recovery screen of the Asset Guard system.
 *
 * Rendered by AssetErrorBoundary when a lazily-loaded module chunk
 * fails (e.g. a stale deployment bundle referencing a missing chunk,
 * or a dev-server restart between page load and a panel import).
 * Mirrors the inline watchdog's recovery screen — branded, honest,
 * self-explanatory, with a real Retry — but as a React component so
 * it inherits the (already loaded) design system.
 *
 * Design policy: LIGHT always (Scholario's production design system —
 * white/near-white surfaces, subtle borders, teal brand accent, dark
 * readable typography). It must never follow prefers-color-scheme.
 */
import { useEffect, useState } from 'react'

export function AssetRecoveryScreen({
  kind = 'chunk',
  onRetry,
}: {
  kind?: 'chunk' | 'asset'
  onRetry?: () => void
}) {
  const [seconds, setSeconds] = useState(3)

  useEffect(() => {
    const t = window.setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (seconds === 0 && onRetry) onRetry()
  }, [seconds])

  const isPlatform = typeof window !== 'undefined' && window.location.pathname.startsWith('/platform')
  const loginHref = isPlatform ? '/platform/login' : '/'

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Scholario could not load this workspace"
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-50 p-6 text-center text-slate-900"
      style={{ visibility: 'visible' }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_8px_24px_rgba(15,23,42,0.08)]">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-13 w-13 items-center justify-center rounded-xl bg-teal-600 text-2xl font-extrabold text-white"
          style={{ height: 52, width: 52 }}
        >
          S
        </div>
        <h1 className="mb-2 text-lg font-bold text-slate-900">
          Something went wrong
        </h1>
        <p className="mb-1 text-sm leading-relaxed text-slate-600">
          Your session is safe. We couldn&rsquo;t load this workspace.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-slate-500">
          {kind === 'chunk'
            ? 'A part of the application failed to download — the server may be restarting.'
            : 'A required asset failed to load — the server may be restarting.'}
        </p>
        <p className="mb-5 text-xs text-slate-500" aria-live="polite">
          {seconds > 0 ? `Reloading in ${seconds}s…` : 'Reloading…'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-xl bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Retry
          </button>
          <a
            href={loginHref}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Go to login
          </a>
        </div>
        <div className="mt-6 text-[11px] uppercase tracking-[0.22em] text-slate-400">
          SCHOLARIO · School OS
        </div>
      </div>
    </div>
  )
}
