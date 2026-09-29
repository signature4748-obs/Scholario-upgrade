/**
 * The structured logger (Phase 4 — item 2).
 *
 * ONE log format for the entire application — single-line JSON on stdout
 * (and stderr for error level), ready for any log shipper:
 *
 *   { "ts": "2026-02-02T…", "channel": "http", "level": "info",
 *     "event": "http_request", "requestId": "…", "userId": "…",
 *     "schoolId": "…", "route": "/api/students", "operation": "GET /api/students",
 *     "duration": 42, "status": 200 }
 *
 * Correlation fields (requestId / userId / schoolId / route / operation)
 * are injected from the AsyncLocalStorage request context automatically —
 * call sites only pass event-specific fields.
 *
 * Every line passes through `redact()`: sensitive keys (password, token,
 * secret, cookie, authorization, signature…) are replaced with [REDACTED];
 * strings are length-capped; depth is capped. See redact.ts.
 *
 * Level control: LOG_LEVEL=debug|info|warn|error (default info).
 */
import { redact } from './redact'
import { getRequestContext } from './context'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

/** Fields that come from the request context (never from log callers). */
const CONTEXT_FIELDS = ['requestId', 'userId', 'schoolId', 'route', 'operation'] as const

export interface LogFields {
  [key: string]: unknown
}

/**
 * Emit one structured log line.
 *
 * @param level   severity
 * @param event   stable event name — grep/dashboard key (e.g. "http_request",
 *                "db_slow_query", "job_failed", "webhook_duplicate")
 * @param fields  event-specific structured fields (redacted before emit)
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (PRIORITY[level] < PRIORITY[minLevel()]) return

  const ctx = getRequestContext()
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    channel: 'app',
    level,
    event,
  }
  // Correlation fields — context is authoritative; explicit fields cannot
  // spoof them (dropped before merging).
  if (ctx) {
    if (ctx.requestId) entry.requestId = ctx.requestId
    if (ctx.userId) entry.userId = ctx.userId
    if (ctx.schoolId) entry.schoolId = ctx.schoolId
    if (ctx.route) entry.route = ctx.route
    if (ctx.operation) entry.operation = ctx.operation
  }
  // Hostile field sets (throwing getters / exotic accessors) must never
  // turn logging itself into a failure mode — degrade to a marker line.
  try {
    if (typeof fields.channel === 'string') entry.channel = fields.channel
    for (const [k, v] of Object.entries(redact(fields))) {
      if (CONTEXT_FIELDS.includes(k as (typeof CONTEXT_FIELDS)[number])) continue
      entry[k] = v
    }
  } catch {
    entry.detail = '[unserializable-fields]'
  }

  let line: string
  try {
    line = JSON.stringify(entry)
  } catch {
    // A field set that cannot serialize (circular, exotic) — log the fact,
    // never the raw object.
    line = JSON.stringify({ ...entry, detail: '[unserializable-fields]' })
  }

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** Convenience wrappers. */
export const logger = {
  debug: (event: string, fields?: LogFields) => log('debug', event, fields),
  info: (event: string, fields?: LogFields) => log('info', event, fields),
  warn: (event: string, fields?: LogFields) => log('warn', event, fields),
  error: (event: string, fields?: LogFields) => log('error', event, fields),
}
