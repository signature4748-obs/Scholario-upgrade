// keepalive.mjs — sandbox watchdog (v3, 2026-09-24).
//
// LESSON LEARNED (v2 incident): a dev server mid-compile can be
// HTTP-unresponsive for 15s+; an HTTP-only probe wrongly declared it dead,
// killed the tree and raced a respawn into EADDRINUSE. v3 decides liveness
// by the OS truth instead:
//
//   alive  ⇔ something is LISTENING on the port (ss -ltn)
//   healthy ⇔ HTTP probe answers OK within the timeout
//
//   · LISTENING + slow/failed HTTP  → server is COMPILING — leave it
//     alone (log once, never kill).
//   · NOT LISTENING (2 consecutive probes) → truly dead → kill the full
//     tree (wrapper + bash pipeline + next child + tee), WAIT until the
//     port is actually free (up to 20s, escalating to kill -9), then
//     respawn via spawn-detached.mjs and allow a 120s compile window
//     before probing again.
//
//   :3000 → Next dev (`bun run dev`)      :3003 → event-stream mini-service
//   :5432 → postgres-db (embedded cluster; adopts a running instance)
//
// All output goes to stdout — spawn-detached.mjs routes it to dev.log.

import { spawn, exec } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'

const ROOT = '/home/z/my-project'
const PROBE_MS = 20_000
const HTTP_TIMEOUT_MS = 10_000

// Env hygiene (forensic-acceptance Phase 33 lesson): the platform bootstrap
// injects a stale DATABASE_URL=file:… into every shell; children inherit it
// and Next.js never overrides an existing process env var from .env. Load
// ROOT/.env here, OVERRIDING the process env, so every respawn (dev server,
// event-stream, postgres-db) carries the CI-parity values from the file.
try {
  for (const line of fs.readFileSync(`${ROOT}/.env`, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && m[1] !== 'NODE_ENV') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — keep the inherited env */ }

const log = (msg) => console.log(`[keepalive ${new Date().toISOString()}] ${msg}`)

function sh(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => resolve({ err, stdout: stdout ?? '' }))
  })
}

/** Process truth: does a matching service process exist?
 *  (ss/netstat on this sandbox CANNOT see the Next dev listener — the
 *  socket shows only as TIME_WAIT entries in /proc/net/tcp6 — so process
 *  presence is the only reliable liveness signal for it.) */
async function listening(port) {
  if (port === 3000) {
    // [d] bracket: the sh -c wrapper's own cmdline (which contains this
    // literal pattern text) must not match the regex it executes.
    const { stdout } = await sh(`pgrep -f "next de[v].*-p 3000" | head -1`)
    return stdout.trim().length > 0
  }
  if (port === 3003) {
    const { stdout } = await sh(`pgrep -f "bun --ho[t] index.ts" | head -1`)
    return stdout.trim().length > 0
  }
  const { stdout } = await sh(`ss -ltn | grep -c ':${port} ' || true`)
  return Number(stdout.trim() || '0') > 0
}

/** Health: does the service answer HTTP OK? (postgres-db :5432 → TCP.) */
const tcpOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1', timeout: 2000 })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.once('timeout', () => { s.destroy(); resolve(false) })
  })

async function healthy(port, path) {
  if (port === 5432) return tcpOpen(port)
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Post-restart chunk warming: after a (re)spawned Next server becomes
 * healthy, run warm-chunks.mjs once in the background. The warmer walks the
 * page + every referenced /_next chunk SEQUENTIALLY — pacing first-hit
 * compiles so they never stack up during a user's own browsing (the OOM
 * killer took down the server when a full 20-module Principal walkthrough
 * fired 20 first-hit compiles back-to-back: anon-rss 2.69GB > 4GB cgroup).
 */
let warmStarted = 0
async function warmChunks() {
  const now = Date.now()
  if (now - warmStarted < 60_000) return // 1-min re-entry guard (probe ticks)
  // Is a warmer still walking? (Warms of the full 3-role chunk graph take
  // 10–15 min — a time window cannot model that; process truth can.)
  // [s] bracket: the exec'ed shell's own cmdline (containing this literal
  // pattern text) must not match the regex it runs — keepalive v3.2 lesson.
  const { stdout } = await sh(`pgrep -f "bun warm-chunk[s].mjs" | head -1`)
  if (stdout.trim()) {
    log('warm skipped — a warmer is already running')
    warmStarted = now
    return
  }
  // Abort-aware loop protection: a marker with no doneAt AND no live process
  // means the last warm died mid-walk (server OOM). Cool off 5 minutes so a
  // warming-induced crash cannot loop.
  let marker = null
  try {
    marker = JSON.parse(fs.readFileSync(`${ROOT}/dev-warm-state.json`, 'utf8'))
  } catch {
    /* no marker yet — treat as completed */
  }
  if (marker && !marker.doneAt && marker.startedAt && now - marker.startedAt < 5 * 60_000) {
    log('warm skipped — previous warm aborted < 5 min ago (loop guard)')
    warmStarted = now
    return
  }
  warmStarted = now
  log('post-restart chunk warm triggered (paced, background)')
  spawnDetached('bun', [`${ROOT}/spawn-detached.mjs`, 'bun', 'warm-chunks.mjs'], ROOT)
}

function spawnDetached(cmd, args, cwd = ROOT) {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'ignore', 'ignore'] })
  child.unref()
  log(`spawned detached: ${cmd} ${args.join(' ')} (pid ${child.pid}) in ${cwd}`)
}

/** Kill by pattern, but ONLY processes whose working directory matches.
 *  (The next-dev wrapper and the event-stream wrapper share the cmdline
 *  `bun run dev` — cwd is the only distinguishing fact.) */
async function killTree(patterns, cwd) {
  for (const p of patterns) {
    if (cwd) {
      await sh(`
        for pid in $(pgrep -f "${p}" 2>/dev/null); do
          [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "${cwd}" ] && kill $pid 2>/dev/null || true
        done`)
    } else {
      await sh(`pkill -f "${p}" || true`)
    }
  }
}

/** Wait until the port is free (escalating to kill -9). */
async function waitForFreePort(port, patterns, cwd, timeoutMs = 20_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (!(await listening(port))) return true
    for (const p of patterns) {
      if (cwd) {
        await sh(`
          for pid in $(pgrep -f "${p}" 2>/dev/null); do
            [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "${cwd}" ] && kill -9 $pid 2>/dev/null || true
          done`)
      } else {
        await sh(`pkill -9 -f "${p}" || true`)
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return !(await listening(port))
}

const state = {
  next: { downProbes: 0, compiling: false, respawnedAt: 0, warmed: false },
  stream: { downProbes: 0, respawnedAt: 0 },
  db: { downProbes: 0, respawnedAt: 0 },
}

async function ensureService(name, port, path, patterns, spawnArgs, cwd, st) {
  const isListening = await listening(port)

  // Listening but HTTP-slow ⇒ compiling — NEVER kill (v2 lesson).
  if (isListening) {
    const ok = await healthy(port, path)
    if (!ok) {
      if (!st.compiling) {
        st.compiling = true
        log(`:${port} listening but not answering yet — likely compiling; leaving it alone`)
      }
    } else {
      if (st.compiling) {
        st.compiling = false
        log(`:${port} recovered (healthy again)`)
      }
      // First healthy probe after boot/respawn → pace-warm all chunks
      // in the background so user browsing never stacks first-hit
      // compiles (OOM guard). Only for the Next service.
      if (!st.warmed && name === 'next dev') {
        st.warmed = true
        warmChunks()
      }
    }
    st.downProbes = 0
    return
  }
  st.compiling = false
  st.downProbes += 1

  // Fresh respawn gets a 120s compile window before it can be declared dead.
  if (st.respawnedAt && Date.now() - st.respawnedAt < 120_000) {
    log(`:${port} not listening yet — respawn of ${name} still within its 120s compile window`)
    return
  }
  if (st.downProbes < 2) {
    log(`:${port} not listening (probe #${st.downProbes}) — waiting one more cycle`)
    return
  }
  st.downProbes = 0
  log(`:${port} is DOWN — killing the previous ${name} tree (cwd ${cwd}) and respawning`)
  await killTree(patterns, cwd)
  const freed = await waitForFreePort(port, patterns, cwd)
  if (!freed) {
    log(`:${port} still held after force-kill — will retry next cycle`)
    return
  }
  spawnDetached('bun', [`${ROOT}/spawn-detached.mjs`, ...spawnArgs], cwd)
  st.respawnedAt = Date.now()
  st.warmed = false // re-warm once the respawned server is healthy
}

async function tick() {
  try {
    await ensureService(
      'next dev', 3000, '/api/app-version',
      ['bun run dev', 'next dev', 'tee dev.log'],
      ['--cwd', ROOT, 'bun', 'run', 'dev'], ROOT, state.next,
    )
    await ensureService(
      'event-stream', 3003, '/?EIO=4&transport=polling',
      ['bun run dev', 'bun --hot index.ts'],
      ['--cwd', `${ROOT}/mini-services/event-stream`, 'bun', 'run', 'dev'],
      `${ROOT}/mini-services/event-stream`, state.stream,
    )
    await ensureService(
      'postgres-db', 5432, null,
      ['bun run dev', 'bun index.ts'],
      ['--cwd', `${ROOT}/mini-services/postgres-db`, 'bun', 'run', 'dev'],
      `${ROOT}/mini-services/postgres-db`, state.db,
    )
  } catch (e) {
    log(`tick error: ${e && e.message}`)
  }
}

log('watchdog v3 started (ss-based liveness; compile windows respected)')
await tick()
setInterval(tick, PROBE_MS)
