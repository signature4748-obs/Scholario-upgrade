/**
 * PHASE 3 — db:reset GUARD.
 * PHASE 8A — production-database identity guard (src/lib/env semantics).
 *
 * `prisma migrate reset` drops the whole database and replays every
 * migration from scratch (then seeds). That is a legitimate DEVELOPMENT
 * operation, but it must never run against anything production-shaped.
 * This wrapper refuses in production and passes through in development.
 *
 * PHASE 8A: "production-shaped" now ALSO means database identity — the
 * same isProductionDatabase() semantics as the app: DATABASE_ENV=production,
 * or (fail-safe) DATABASE_ENV unset while DATABASE_URL points at a
 * Supabase host. db:reset is blocked against Supabase entirely in
 * production mode.
 */
import { spawnSync } from "node:child_process";
import { isProductionDatabase } from "../src/lib/env";

const isProd = process.env.NODE_ENV === "production";
const prodDb = isProductionDatabase();

if (isProd || prodDb) {
  console.error(
    "[db-reset-guard] REFUSED: prisma migrate reset would DROP the " +
      `${
        prodDb
          ? `production database (detected via DATABASE_ENV=${
              process.env.DATABASE_ENV ?? "unset"
            } / Supabase host recognition)`
          : "database in a production runtime (NODE_ENV=production)"
      }. ` +
      "Restores are an ops runbook task (see docs/POSTGRES_MIGRATION_PLAN.md), never a script. " +
      "If this database is really non-production, set DATABASE_ENV explicitly " +
      "(e.g. DATABASE_ENV=development)."
  );
  process.exit(1);
}

const r = spawnSync("bunx", ["prisma", "migrate", "reset"], { stdio: "inherit" });
process.exit(r.status ?? 1);
