/**
 * PHASE 8B — Server-side realtime publisher (Supabase Realtime REST
 * broadcast). Stateless — a single HTTPS POST per event, no long-lived
 * connection, no background process: Vercel/serverless-compatible.
 *
 * Contract:
 *  - fire-SAFE: never throws to the caller (realtime is optional; the DB
 *    is the source of truth and all surfaces work without events)
 *  - bounded: single attempt, 3s abort
 *  - payload discipline: notification signals only (ids/counts/hints),
 *    never row data
 *  - structured logging via the observability logger
 *  - NOTE for callers (Phase 8C-N): AWAIT every publish before returning
 *    the response. Vercel freezes the serverless function the moment the
 *    response is sent — a fire-and-forget publish is killed mid-flight
 *    and never delivers. The await is bounded (3s worst case) and cannot
 *    throw (this module's fire-safe contract).
 */

import { log } from '@/lib/observability/logger'
import { schoolChannel, userChannel } from './channels'
import { realtimePublishEnabled } from './mode'

/**
 * Event kinds kept compatible with the Phase-8A event-stream frames so
 * the live-feed store and its consumers keep working unchanged, plus the
 * Phase-8B 'salary' kind:
 *  'fee-payment' | 'announcement' | 'message' | 'timetable' | 'salary'
 */
export interface RealtimeEventPayload {
  /** Monotonic-ish event id for client-side dedupe (e.g. row cuid). */
  id: string
  kind: 'fee-payment' | 'announcement' | 'message' | 'timetable' | 'salary'
  /** UTC ISO timestamp of the underlying DB write. */
  at: string
  /** Minimal notification signal — ids/counts/hints, never row data. */
  [key: string]: unknown
}

/**
 * The per-event hints a caller hands to publishToUser/publishToSchool —
 * everything EXCEPT the kind (the publisher adds it). Named `id`/`at` are
 * REQUIRED; kind-specific hints ride the index signature.
 *
 * NOTE (why not `Omit<RealtimeEventPayload, 'kind'>`): the payload
 * interface carries a string index signature, so `keyof` widens to
 * `string | number` and `Omit` collapses to the bare index signature —
 * silently dropping the required id/at. This explicit shape keeps the
 * caller contract strong (id + at always present) with identical runtime
 * behavior.
 */
export interface RealtimeEventHint {
  /** Monotonic-ish event id for client-side dedupe (e.g. row cuid). */
  id: string
  /** UTC ISO timestamp of the underlying DB write. */
  at: string
  /** Kind-specific notification hints — ids/counts/hints, never row data. */
  [key: string]: unknown
}

function warnOnce(kind: string): void {
  log('warn', 'realtime_publish_skipped', { reason: 'not_enabled', kind })
}

/**
 * Publish to a school audience channel (`all` or `staff`). Never throws.
 */
export async function publishToSchool(
  schoolId: string,
  audience: 'all' | 'staff',
  kind: RealtimeEventPayload['kind'],
  payload: RealtimeEventHint,
): Promise<void> {
  if (!realtimePublishEnabled()) return warnOnce(kind)
  await postBroadcast(schoolChannel(schoolId, audience), kind, { kind, ...payload }, { schoolId, audience })
}

/**
 * Publish to a single recipient's user channel. Never throws.
 */
export async function publishToUser(
  schoolId: string,
  recipientUserId: string,
  kind: RealtimeEventPayload['kind'],
  payload: RealtimeEventHint,
): Promise<void> {
  if (!realtimePublishEnabled()) return warnOnce(kind)
  await postBroadcast(userChannel(schoolId, recipientUserId), kind, { kind, ...payload }, { schoolId, audience: 'user' })
}

async function postBroadcast(
  topic: string,
  event: string,
  payload: RealtimeEventPayload,
  scope: { schoolId: string; audience: string },
): Promise<void> {
  const url = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: String(process.env.SUPABASE_SERVICE_ROLE_KEY),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    })
    clearTimeout(timeout)
    if (!res.ok) {
      log('warn', 'realtime_publish_failed', {
        status: res.status,
        kind: payload.kind,
        schoolId: scope.schoolId,
        audience: scope.audience,
      })
    }
  } catch (error) {
    // Fire-safe: network/abort/parse errors are logged, never propagated.
    log('warn', 'realtime_publish_error', {
      kind: payload.kind,
      schoolId: scope.schoolId,
      audience: scope.audience,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}
