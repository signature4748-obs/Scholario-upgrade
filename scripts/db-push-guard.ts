/**
 * PHASE 3 — db:push GUARD (migration-safe architecture).
 *
 * `prisma db push --accept-data-loss` was the pre-Phase-3 workflow that
 * created schema WITHOUT migration history and silently dropped data on
 * drift. It is now REPLACED by the versioned-migration workflow:
 *
 *   dev:      bun run db:migrate:dev    (prisma migrate dev — creates
 *             + applies versioned migrations, regenerates the client)
 *   deploy:   bun run db:migrate        (prisma migrate deploy — applies
 *             pending migrations only, never destructive)
 *   status:   bun run db:migrate:status
 *   audit:    bun run db:audit          (read-only integrity audit)
 *
 * This guard exists so that any stale docs, muscle memory or CI job
 * invoking `bun run db:push` fails LOUDLY instead of silently reshaping
 * the database outside migration control.
 *
 * Explicit override (NEVER possible in production):
 *   SCHOLARIO_ALLOW_DB_PUSH=1 NODE_ENV=development bun run db:push
 */
import { spawnSync } from "node:child_process";

const isProd = process.env.NODE_ENV === "production";
const override = process.env.SCHOLARIO_ALLOW_DB_PUSH === "1";

if (override && !isProd) {
  console.warn("[db-push-guard] development override — running `prisma db push` (no --accept-data-loss).");
  const r = spawnSync("bunx", ["prisma", "db", "push"], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

console.error(`
+----------------------------------------------------------------------+
|  db:push is DISABLED - migration-safe architecture (PHASE 3)         |
+----------------------------------------------------------------------+
|  The database is now managed by VERSIONED PRISMA MIGRATIONS.         |
|  Direct schema pushes bypass migration history and can destroy       |
|  data (the old workflow used --accept-data-loss).                    |
|                                                                      |
|  Instead use:                                                        |
|    bun run db:migrate:dev    create + apply a migration (dev)        |
|    bun run db:migrate        apply pending migrations (deploy-safe)  |
|    bun run db:migrate:status inspect migration state                 |
|    bun run db:audit          read-only database integrity audit      |
|                                                                      |
|  See docs/DATABASE_INTEGRITY.md (Migration discipline).              |
+----------------------------------------------------------------------+
`);
process.exit(1);
