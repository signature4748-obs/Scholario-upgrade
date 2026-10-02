import { Prisma } from '@prisma/client'
import { db } from './db'
/**
 * Phase 8A — login-bucket reset for test suites.
 *
 * The rate limiter is now DATABASE-backed (mission §23: cross-instance
 * budgets). Login ACCOUNT buckets (rl:login:acct:<email>, 5/15min) and the
 * loopback IP bucket therefore persist across suite runs and dev-server
 * restarts — CORRECT production semantics, but a rapid re-run of a suite
 * can start inside a leftover blocked window.
 *
 * Deleting the shared rows heals the app within one request (the limiter
 * reconciles its local verdict from the DB on every check), and the
 * suites' existing direct-session fallbacks absorb that one sacrificial
 * request. Dev/integration DB only — fixture accounts, never production.
 *
 * PHASE 8C FIX (real root cause) — the helper was a SILENT NO-OP since
 * Phase 8A: Prisma's tagged-template `IN (${array})` binds the array as a
 * SINGLE parameter (Postgres: "could not determine data type"), the error
 * was swallowed by the catch, and no row was ever deleted. Every
 * 429-shadowed login test across suite runs traces back to this line.
 * `Prisma.join()` expands the list correctly. Additionally the IP keys now
 * cover BOTH loopback forms: the sandbox resolves `localhost` to IPv6
 * `::1`, so the live shared bucket is `rl:login:ip:::1` while the old
 * default (`127.0.0.1` only) targeted a key that was never written.
 * `loopbackIp` remains available for suites that pin a specific egress
 * address and is healed in addition to the two canonical loopback rows.
 */

export async function resetLoginBuckets(emails: string[], loopbackIp = '127.0.0.1'): Promise<void> {
  const keys = new Set<string>([
    ...emails.map((e) => `rl:login:acct:${e.toLowerCase()}`),
    'rl:login:ip:127.0.0.1',
    'rl:login:ip:::1',
  ])
  if (loopbackIp !== '127.0.0.1' && loopbackIp !== '::1') {
    keys.add(`rl:login:ip:${loopbackIp}`)
  }
  try {
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${Prisma.join([...keys])})`
  } catch {
    // Never block suite setup on limiter-state hygiene — but an error here
    // is now a REAL anomaly (the query is valid); it logs loudly below.
    console.warn('[login-buckets] heal query failed — limiter state left as-is')
  } finally {
    await db.$disconnect()
  }
}
