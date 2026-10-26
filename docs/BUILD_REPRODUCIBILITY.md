# BUILD REPRODUCIBILITY — Canonical Production Build

**Status: CANONICAL · VERIFIED** (2026-10-01, closure run — see §4)
**Scope:** how `bun run build` produces the production bundle, and why that
exact configuration is the repository's single build path.

---

## 1. The canonical command

`bun run build` executes (package.json is the single source of truth — the
configuration lives IN the script, not in a one-off shell command):

```sh
export NODE_ENV=production NODE_OPTIONS=--max-old-space-size=3072
prisma generate \
  && next build --webpack \
  && cp -r .next/static .next/standalone/.next/ \
  && cp -r public .next/standalone/
```

(The script wraps this in `bash -c 'export …; …'` — a bare
`NODE_ENV=… NODE_OPTIONS=… prisma generate && next build` prefix only ever
applied to `prisma generate`, never to `next build`: the documented 3072 MB
heap ceiling was silently inert for the compile itself, masked on 16 GiB CI
runners by the ~4 GiB default heap and fatal on the 4 GiB reference box —
proven by an OOM at the ~2 GiB default cap before the fix, EXIT 0 after.)

CI (`.github/workflows/ci.yml`, build gate) runs **exactly** `bun run build`
— no duplicated env/engine flags — so local builds, CI builds and deployments
all exercise ONE identical production build path. This is also byte-for-byte
the deploy-time semantics: both Vercel projects' `buildCommand` is
`npx prisma generate && npx next build --webpack`.

**Migrations are NOT part of the build.** `prisma migrate deploy` was removed
from `bun run build` (2026-10-26) so that no routine compilation — local
`bun run build`, CI build gate, or any future build invocation with a
production `DATABASE_URL` in scope — can ever apply production migrations as
a side effect. The sanctioned channels are exactly:

- **CI**: the explicit `bunx prisma migrate deploy` step against the
  job-local ephemeral postgres (already ordered before the build gate).
- **Production**: the Release workflow (`release.yml` /
  `production-db-migration.yml`), which applies migrations through the
  Supabase Management API inside the documented DATABASE-FIRST contract
  (docs/RELEASE.md). `bun run db:migrate` remains the explicit, intentional
  local/CI entry point.

## 2. Why webpack (not the Next 16 default Turbopack)

- **Memory constraint.** The reference build environment (and deployment
  target class) is a 4 GiB cgroup / small container. Next 16's default build
  engine (Turbopack) spawns a TypeScript build worker that exceeds the cgroup
  during a full ~240-route compile: the worker is **OOM-killed (SIGKILL)
  mid-type-check**. Observed and documented at commit `c1610f6`
  (FINAL PRE-PHASE-8 VERIFICATION).
- **Proven reproducibility.** webpack + a 3072 MB old-space heap is the
  configuration that completes end-to-end: compile clean, `Running TypeScript`
  phase clean, 162/162 static pages, full route table, **EXIT 0**
  (closure-run evidence in §4).
- **Dev/prod engine parity.** `dev` already runs `next dev --webpack` — the
  gateway-aware lazyCompilation backend (`src/lazy-compilation/`) is
  webpack-only. One bundler across dev and prod means one module-graph
  behavior and one set of quirks.
- `experimental.turbopackMemoryLimit` (2200) remains in `next.config.ts` only
  as guidance for non-`--webpack` boots; it does **not** make the default
  engine fit the 4 GiB ceiling during a full build.

## 3. Hard guarantees (no bypasses)

- `ignoreBuildErrors` is **removed** (Phase 4) — TypeScript errors fail the
  build. The build's `Running TypeScript` phase is the enforcement point.
- No ESLint `ignoreDuringBuilds`, no type-check bypass of any kind.
- `tsc --noEmit` (`bun run typecheck`) and `eslint .` (`bun run lint`) remain
  separate hard gates in CI (Gates 1–2), independent of the build.

## 4. Verified outputs (closure run, clean state)

Run: `rm -rf .next && bun run build` (dev server stopped — see §6).

| Check | Result |
|---|---|
| `bun run build` exit code | **0** |
| Engine banner | `▲ Next.js 16.1.3 (webpack)` |
| Compile | `✓ Compiled successfully in 59s` |
| TypeScript checking | `Running TypeScript …` ran and passed (build proceeded; no bypass exists) |
| Route generation | 242 routes; `Generating static pages (162/162) in 715.0ms` |
| Standalone bundle | `.next/standalone/server.js` + traced `node_modules` (incl. Prisma query engine and `.env`) |
| Static assets copied | `.next/standalone/.next/static/` — 4 dirs, 177 chunks (post-build `cp`) |
| Public assets copied | `.next/standalone/public/` — 5 entries (post-build `cp`) |
| Wall clock | 133 s from `rm -rf .next` to exit 0 |

Known non-blocking warning: Next 16.1 prints `⚠ The "middleware" file
convention is deprecated. Please use "proxy" instead.` (build completes; the
rename is a future modernization, not a build-reproducibility concern).

## 5. Production boot (runtime contract)

```sh
bun run start     # NODE_ENV=production bun .next/standalone/server.js
```

- `PORT` (default 3000), `HOSTNAME` (default 0.0.0.0).
- Runtime env: the build **traces `.env` into `.next/standalone/.env`**, and
  `server.js` chdirs to the standalone dir, so the canonical start works in
  the reference environment as-is. Real deployments must set `DATABASE_URL`
  (or replace the traced `.env`) — the traced file contains the sandbox's
  absolute SQLite path.
- Boot verification (closure run): `✓ Ready in 87ms`, then
  `/health/live` → **200** · `/health/ready` → **200** (`database: ok`,
  1 ms) · `/` → **200** (title verified) · `/api/schools/public` → **200**
  (real tenant JSON from the seeded DB).

## 6. Clean-state reproduction

```sh
rm -rf .next && bun run build
```

Do not prefix extra env vars — the canonical configuration is IN the script.
Stop the dev server first: its 1800 MB heap plus the build's 3072 MB heap
exceeds the 4 GiB cgroup (the standalone boot test may reuse port 3000 once
the dev server is stopped).
