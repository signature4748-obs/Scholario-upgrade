/**
 * mini-services/postgres-db — embedded PostgreSQL 18.4 service.
 *
 * Brings up (or adopts) the persistent local cluster used by the dev
 * stack: cluster directory db/pg (git-ignored), port 5432, application
 * database `scholario`. Credentials come from the repo .env DATABASE_URL
 * (single source of truth — never printed).
 *
 * Behaviour:
 *   · port :5432 already serving  → ADOPT the running cluster (a respawned
 *     service after a crash must never stomp a live postgres).
 *   · db/pg/PG_VERSION exists     → start the existing cluster (no re-init).
 *   · otherwise                   → initialise + start + create database.
 *   · supervision loop: if the port goes down, bring the cluster back.
 *
 * No `bun --hot` by design (a database must not hot-restart).
 * The keepalive watchdog supervises this service via :5432 liveness and
 * respawns it; kill patterns never match the postgres process itself.
 */
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync, readFileSync } from 'fs'
import net from 'net'
import path from 'path'

const ROOT = '/home/z/my-project'
const CLUSTER = `${ROOT}/db/pg`
const PORT = 5432

// The embedded PG binaries link ICU 60; Debian 13 ships ICU 76. A locally
// extracted libicu60 (dpkg -x, outside the repo) provides it — no root needed.
const ICU60 = '/home/z/.local/icu60/usr/lib/x86_64-linux-gnu'
if (existsSync(ICU60)) {
  process.env.LD_LIBRARY_PATH = [ICU60, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}

const log = (m: string) => console.log(`[postgres-db ${new Date().toISOString()}] ${m}`)

/** Parse the app DATABASE_URL from the repo .env (values never logged). */
function parseDatabaseUrl(): { user: string; password: string; database: string } {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(`${ROOT}/.env`, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    throw new Error('no .env — cannot source database credentials')
  }
  const raw = env.DATABASE_URL
  if (!raw || !raw.startsWith('postgresql://')) {
    throw new Error('.env DATABASE_URL is not a postgresql:// URL')
  }
  const u = new URL(raw)
  return {
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: (u.pathname || '/scholario').slice(1) || 'scholario',
  }
}

const portOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1', timeout: 1500 })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.once('timeout', () => { s.destroy(); resolve(false) })
  })

async function ensureCluster(): Promise<void> {
  if (await portOpen(PORT)) {
    log(`port :${PORT} already serving — adopting the running cluster`)
    return
  }
  const { user, password, database } = parseDatabaseUrl()
  const pg = new EmbeddedPostgres({
    databaseDir: CLUSTER,
    user,
    password,
    port: PORT,
    persistent: true, // never wipe db/pg on close
  })
  if (existsSync(`${CLUSTER}/PG_VERSION`)) {
    log('existing cluster at db/pg — starting (no re-init)')
    await pg.start()
  } else {
    log('no cluster at db/pg — initialising + starting')
    await pg.initialise()
    await pg.start()
  }
  try {
    await pg.createDatabase(database)
    log(`database "${database}" created`)
  } catch {
    log(`database "${database}" already present`)
  }
  if (!(await portOpen(PORT))) throw new Error('cluster did not come up on :5432')
  log(`cluster serving on :${PORT} (database: ${database})`)
}

async function main() {
  await ensureCluster()
  // Supervision: if postgres dies, bring it back (adopt-or-start again).
  let downCount = 0
  setInterval(async () => {
    try {
      if (await portOpen(PORT)) {
        downCount = 0
        return
      }
      downCount += 1
      if (downCount < 2) return
      log('cluster went down — restarting')
      await ensureCluster().catch((e) => log(`restart failed: ${e?.message ?? e}`))
      downCount = 0
    } catch {
      /* probe errors are non-fatal */
    }
  }, 5000)
}

main().catch((e) => {
  log(`FATAL: ${e?.message ?? e}`)
  process.exit(1)
})
