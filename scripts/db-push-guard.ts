/**
 * PHASE 3 — db:push GUARD (migration-safe architecture).
 * PHASE 8A — production-database identity guard (src/lib/env semantics).
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
 * PHASE 8A: the production check is now DATABASE-IDENTITY based (imported
 * from src/lib/env — same semantics as the rest of the app): db:push is
 * blocked against Supabase entirely in production mode —
 * DATABASE_ENV=production, or (fail-safe) DATABASE_ENV unset while
 * DATABASE_URL points at a Supabase host. No override exists for that
 * case; the development override below can never reach it.
 *
 * Explicit override (NEVER possible in production / production DB):
 *   SCHOLARIO_ALLOW_DB_PUSH=1 NODE_ENV=development bun run db:push
 */
import { spawnSync } from "node:child_process";
import { getDatabaseEnv, isProductionDatabase } from "../src/lib/env";

const isProd = process.env.NODE_ENV === "production";
const prodDb = isProductionDatabase();

if (prodDb || isProd) {
  const reason = prodDb
    ? `PRODUCTION database (isProductionDatabase(): DATABASE_ENV=${
        process.env.DATABASE_ENV ?? "unset"
      })`
    : "production runtime (NODE_ENV=production)";
  console.error(
    `[db-push-guard] REFUSED: prisma db push against a ${reason}. ` +
      "Schema changes go through versioned migrations (bun run db:migrate:dev / db:migrate). " +
      "There is NO override for this — if this database is really non-production, " +
      "set DATABASE_ENV explicitly (e.g. DATABASE_ENV=development)."
  );
  process.exit(1);
}

const override = process.env.SCHOLARIO_ALLOW_DB_PUSH === "1";

if (override) {
  console.warn(
    `[db-push-guard] development override (DATABASE_ENV=${getDatabaseEnv()}) — running \`prisma db push\` (no --accept-data-loss).`
  );
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
|  (development-only escape hatch, never valid on a production DB:     |
|    SCHOLARIO_ALLOW_DB_PUSH=1 bun run db:push)                        |
|                                                                      |
|  See docs/DATABASE_INTEGRITY.md (Migration discipline).              |
+----------------------------------------------------------------------+
`);
process.exit(1);
