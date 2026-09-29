/**
 * PHASE 3 — db:reset GUARD.
 *
 * `prisma migrate reset` drops the whole database and replays every
 * migration from scratch (then seeds). That is a legitimate DEVELOPMENT
 * operation, but it must never run against anything production-shaped.
 * This wrapper refuses in production and passes through in development.
 */
import { spawnSync } from "node:child_process";

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  console.error(
    "[db-reset-guard] REFUSED: prisma migrate reset would DROP the production database. " +
      "Restores are an ops runbook task (see docs/POSTGRES_MIGRATION_PLAN.md), never a script."
  );
  process.exit(1);
}

const r = spawnSync("bunx", ["prisma", "migrate", "reset"], { stdio: "inherit" });
process.exit(r.status ?? 1);
