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

const PG_URL =
  'postgresql://postgres:postgres@127.0.0.1:5433/scholario?sslmode=require&connection_limit=20&pool_timeout=20'
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
      env: { ...process.env, DATABASE_URL: PG_URL, NODE_OPTIONS: '--max-old-space-size=2200' },
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
