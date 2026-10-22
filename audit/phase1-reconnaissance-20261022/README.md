# PHASE 1/9 — COMPLETE REPOSITORY RECONNAISSANCE & BASELINE AUDIT (pack index)

Date: 2026-10-22 · Repo: `signature4748-obs/Scholario-upgrade` @ `main` `7585fad` (clean, = origin/main) · Branch holding this pack: `audit/phase1-reconnaissance-20261022`

Method: read-only reconnaissance (git + GitHub/Vercel/Supabase APIs, SELECT-only production queries via the repo's Management-API channel), CI-recipe local baselines (typecheck, lint, fresh-PG migration replay, 12-seed corpus, full live-test matrix with CI-parity env + supervised dev server), static code analysis, and a deterministic pure-function reproduction of the reported Class 0 symptom. No production data was modified; no credentials, tokens, or private student data appear anywhere in this pack.

## Contents

| File | Deliverable |
|---|---|
| `BASELINE.md` | branch/SHA/PR/CI/release state, both Vercel plane deployment IDs + SHAs, production DB facts, environment limitations, every baseline command with exit codes and pass/fail counts, product-vs-environment separation |
| `FEATURE-INVENTORY.md` | role-by-role & module-by-module inventory: 21 pages, 324 API route files (412 method handlers), 131 Prisma models, 28 migrations, 116 test files, permission registries, sidebar registries, integrations, background work — with locations, permissions, dependencies, tests, honest verification status |
| `CLASS-SECTION-INVESTIGATION.md` | evidence-backed root cause of the Class 0 / excessive-sections report: **persisted data is correct; display/mapping error** in `students-store/server-sync.ts` (null `gradeLevel` → "Grade 0" group absorbing all 12 classes as "sections"); full code chain, production read-only queries, deterministic repro, blast radius, minimal fix proposal, what remains unverified |
| `TEST-MATRIX.md` | the click-by-click feature matrix (M1 platform / M2 principal / M3 teacher / M4 student / M5 cross-cutting) with the mission's full column schema, seeded with the only statuses Phase 1 earned (API-contract PASSes from the baseline; D1 row = FAIL), plus the Phase 2 execution priority |
| `DEFECTS.md` | 1 confirmed product defect (D1 Grade-0 grouping, P1) · 1 test-robustness defect (D2 sort collation, P3) · 3 labeled observations (D3 dev-restart holds, D4 doc drift, D5 Green Valley state) · suspected-but-unconfirmed list kept explicit · no urgent security issues |
| `PHASE2-PLAN.md` | prioritized 7-step Phase 2 execution plan (fix D1 + regression tests → prove on safe tenant → D2 test fix → UI walk of onboarding spine → principal sweep → teacher/student sweeps → close the ledger) with gates |

## Reproduction artifact

The Class-0 repro referenced in CLASS-SECTION-INVESTIGATION.md §3:

```ts
// safe, read-only: feeds the repo's own mapRosterToRecords (server-sync.ts)
// the exact production payload shape observed 2026-10-22 (12 Class DTOs,
// name "Class 1".."Class 12", gradeLevel: null, section: "A"):
// → CASE 1 output: 1 record, name="Grade 0", sections=[A×12]
// → CASE 2 (gradeLevel "1".."12"): 12 records "Grade 1".."Grade 12"
```

Executed 2026-10-22 with `bun` against the checkout's own mapper (import path `src/lib/store/students-store/server-sync.ts`); no DB, no network, no fixtures mutated.

## Session environment notes (for reproducibility)

- Local stack: embedded PG 18.4 (:5432), supervised `bun run dev` (:3000) with `DEV_OLD_SPACE_MB=1700` (the repo's sandbox-tuned value — 4096 causes kernel OOM kills on this 4 GB box) and the ci.yml fixture env block exported into the server process.
- The local corpus was reset + 12-seeded per the ci.yml recipe (§Seeds) before the live suites; note that aborted suite runs leave `Reliability Test *` / `Provision Test *` rows behind (documented in DEFECTS D2 because one such leftover flipped the sort test).
- Supabase Management API: only one of the two handoff tokens answers (the other is expired); queries were SELECT-only.
