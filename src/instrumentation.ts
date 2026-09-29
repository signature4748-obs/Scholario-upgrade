/**
 * Next.js instrumentation hook (Phase 4 — items 2/5).
 *
 * `register()` runs once when the server process boots (dev and
 * production): it installs process-level safety nets so NOTHING fails
 * silently —
 *   - unhandledRejection → structured log line (process stays up; a stray
 *     promise is a defect signal, not a crash reason)
 *   - uncaughtException  → structured log line + `process.exit(1)` in
 *     production (supervisors restart a provably-crashed process; dev
 *     stays up to keep iterating)
 *
 * `onRequestError()` is Next's server error hook: any error that escapes
 * to the framework itself (server components, render, a route handler not
 * covered by the `api()` envelope) is logged with route + request id so
 * an error-boundary incident is still correlated in the log stream.
 *
 * IMPLEMENTATION CONSTRAINT (learned the hard way): this file is ALSO
 * compiled into the EDGE middleware sandbox, where Node APIs
 * (process.on, node:async_hooks) throw. Therefore this module imports
 * NOTHING (no logger import — webpack would bundle node-only deps into
 * the edge build and crash-loop the dev server) and guards every Node
 * API call. The log lines here are hand-rolled to the same JSON shape as
 * src/lib/observability/logger.ts emits.
 */

function procLog(level: 'error' | 'warn', event: string, detail: string): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      channel: 'process',
      level,
      event,
      detail: detail.slice(0, 300),
    })
    if (level === 'error') console.error(line)
    else console.warn(line)
  } catch {
    /* logging must never throw */
  }
}

export async function register() {
  // Edge middleware sandbox also evaluates this module — never register
  // process handlers there (the sandbox stub THROWS on process.on).
  if (process.env.NEXT_RUNTIME === 'edge') return

  try {
    process.on('unhandledRejection', (reason) => {
      procLog(
        'error',
        'unhandled_rejection',
        reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
      )
    })

    process.on('uncaughtException', (err) => {
      procLog('error', 'uncaught_exception', `${err.name}: ${err.message}`)
      if (process.env.NODE_ENV === 'production') {
        // A crashed process must not keep serving — let the supervisor
        // restart it. In dev we keep the server alive to keep iterating.
        process.exit(1)
      }
    })
  } catch {
    // Edge sandbox stub (process.on throws there despite the runtime
    // guard) — degrading to no process handlers is safe: Next's own error
    // surfaces still fire.
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routePath?: string; routeType?: string } = {},
): Promise<void> {
  // Never touch Node-only APIs here (this hook is also wired for edge
  // contexts); pure data formatting only.
  const err = error instanceof Error ? error : new Error(String(error))
  procLog('error', 'next_request_error', [
    `${err.name}: ${err.message}`,
    `route=${context.routePath ?? request.path}`,
    `operation=${request.method} ${request.path}`,
    `requestId=${request.headers?.['x-request-id'] ?? 'none'}`,
    `routeType=${context.routeType ?? 'unknown'}`,
  ].join(' | '))
}
