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
 */

export async function resetLoginBuckets(emails: string[], loopbackIp = '127.0.0.1'): Promise<void> {
  const keys = [
    ...emails.map((e) => `rl:login:acct:${e.toLowerCase()}`),
    `rl:login:ip:${loopbackIp}`,
  ]
  try {
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${keys})`
  } catch {
    // Never block suite setup on limiter-state hygiene.
  } finally {
    await db.$disconnect()
  }
}
