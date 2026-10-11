/**
 * keepalive — dev-server watchdog (the established sandbox pattern).
 *
 * Polls :3000/health/ready every 15s; on 3 consecutive failures it kills
 * the stale dev server (pkill next dev) and relaunches with the EXPLICIT
 * PG DATABASE_URL (the sandbox injects a stale SQLite URL into every
 * shell — the relaunch must carry the real URL). Respawn capped at once
 * per 30s to avoid thrash under the documented OOM flake family.
 *
 * Run detached: setsid bun scripts/dev-keepalive.mjs > /dev/null 2>&1 &
 */
import { spawn, exec } from 'node:child_process'

// PHASE 8 (8-J ops repair): 5433+sslmode was the WRONG endpoint (dead —
// 7-env proved the cluster is 5432 loopback, plaintext, no TLS). A respawn
// with the dead URL produced a server whose every query failed.
const PG_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/scholario?connection_limit=20&pool_timeout=20'
const HEALTH = 'http://localhost:3000/health/ready'
const POLL_MS = 15_000
let failures = 0
let lastSpawn = 0

async function healthy() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(8000) })
    return res.ok
  } catch {
    return false
  }
}

function killStale() {
  return new Promise((resolve) => {
    exec('pkill -f "next dev" || true', () => resolve(undefined))
  })
}

async function launchDev() {
  const now = Date.now()
  if (now - lastSpawn < 30_000) return
  lastSpawn = now
  console.log(`[keepalive] ${new Date().toISOString()} (re)launching dev server`)
  const child = spawn(
    'bun',
    ['run', 'dev'],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      // 1700MB heap cap (2026-10-11): 2200 let the dev server grow to
      // ~3.0GB RSS under live-suite route-compilation load and the kernel
      // OOM-killed it mid-suite (4GB cgroup), cascading ~180 connection
      // failures across tests/security. 1700 keeps server+tests+PG inside
      // the budget; V8 GCs harder instead of dying.
      env: {
        ...process.env,
        DATABASE_URL: PG_URL,
        NODE_OPTIONS: '--max-old-space-size=1700',
        // TEST FIXTURES (never real secrets — the exact values the live
        // security suites document and sign with):
        //  · tests/security/platform-account-recovery.test.ts §H requires
        //    the dev server to run with FAKE GOOGLE_OAUTH_* values so the
        //    OAuth route contract (302/PKCE/state cookie) is exercisable.
        //  · tests/security/fee-gateway.test.ts:71 signs webhooks with the
        //    literal 'batch2-test-webhook-secret'; the server must verify
        //    with the same value.
        GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
        RAZORPAY_WEBHOOK_SECRET: 'batch2-test-webhook-secret',
        //  · tests/security/fee-gateway.test.ts:51 documents the B4 sandbox
        //    checkout contract: PAYMENTS_SANDBOX=1 + a local secret enables
        //    the in-process SandboxProvider (no network, HMAC-verified) so
        //    student checkout / verify / refund flows are exercisable.
        PAYMENTS_SANDBOX: '1',
        PAYMENTS_SANDBOX_SECRET: 'local-sandbox-secret',
      },
    },
  )
  child.unref()
}

launchDev()
setInterval(async () => {
  const ok = await healthy()
  if (ok) {
    failures = 0
    return
  }
  failures++
  if (failures >= 3) {
    console.log(`[keepalive] ${new Date().toISOString()} dev server down — respawning`)
    failures = 0
    await killStale()
    await new Promise((r) => setTimeout(r, 2500))
    await launchDev()
  }
}, POLL_MS)
