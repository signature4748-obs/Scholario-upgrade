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
import { copyFileSync, existsSync, symlinkSync } from 'fs'
import { firstPostgresUrlFrom } from './env-resolution'
import net from 'net'
import path from 'path'

const ROOT = '/home/z/my-project'
const CLUSTER = `${ROOT}/db/pg`
const PORT = 5432

// The embedded PG binaries link against the ICU 60 sonames (libicu*.so.60),
// but @embedded-postgres ships only the versioned files (libicu*.so.60.2),
// and the dynamic linker resolves by exact filename — Debian 13's ICU 76
// cannot satisfy them. Fixed reproducibly INSIDE the service: create the
// .so.60 soname aliases next to the real files (idempotent — `bun install`
// recreates the package tree on every boot and this recreates the aliases),
// then prepend the package lib dir to LD_LIBRARY_PATH. No external library
// directories: after a container reset, `bun install && bun run dev` in this
// directory brings PostgreSQL back with zero manual library steps.
const SERVICE_DIR = import.meta.dir
const EMBEDDED_LIB = path.join(SERVICE_DIR, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'lib')
if (existsSync(EMBEDDED_LIB)) {
  for (const base of ['libicudata', 'libicui18n', 'libicuuc']) {
    const soname = path.join(EMBEDDED_LIB, `${base}.so.60`)
    const versioned = `${soname}.2`
    if (existsSync(versioned) && !existsSync(soname)) {
      try {
        symlinkSync(versioned, soname)
      } catch {
        // Some sandbox shells forbid symlink creation — fall back to a copy
        // (32 MB inside the ephemeral node_modules tree; recreated per boot).
        try {
          copyFileSync(versioned, soname)
        } catch {
          /* give up quietly — postgres will fail loudly with its loader error */
        }
      }
    }
  }
  process.env.LD_LIBRARY_PATH = [EMBEDDED_LIB, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}
// Legacy fallback (harmless if absent): a pre-existing external icu60 shim.
const ICU60 = '/home/z/.local/icu60/usr/lib/x86_64-linux-gnu'
if (existsSync(ICU60)) {
  process.env.LD_LIBRARY_PATH = [ICU60, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}

const log = (m: string) => console.log(`[postgres-db ${new Date().toISOString()}] ${m}`)

/** Parse the app DATABASE_URL from the repo .env (values never logged).
 *
 * 2026-10-16 (post-reset hardening): resolution order is
 *   1. the OWNING WORKTREE's .env (../../.env — the same single source of
 *      truth the dev app in this worktree uses);
 *   2. /home/z/my-project/.env (legacy fallback).
 * The sandbox boot script clobbers the MAIN .env with the SQLite template
 * on every container reset; the worktree .env is reconstructed by
 * scripts/dev-env.sh. Pure logic extracted to ./env-resolution.ts
 * (unit-tested in tests/unit/pg-service-env-resolution.test.ts).
 */
function parseDatabaseUrl(): { user: string; password: string; database: string } {
  const raw = firstPostgresUrlFrom([path.resolve(SERVICE_DIR, '..', '..', '.env'), `${ROOT}/.env`])
  if (!raw) {
    throw new Error('no .env with a postgresql:// DATABASE_URL found (worktree .env or /home/z/my-project/.env)')
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
