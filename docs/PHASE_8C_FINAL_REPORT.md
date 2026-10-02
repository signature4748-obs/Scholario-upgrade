# SCHOLARIO PHASE 8C FINAL ENGINEERING REPORT

Date: 2026-10-02 · Session: Phase 8C (mission `upload/Pasted Content_1790917284974.txt`, §-numbers below refer to it) · Repo: `/home/z/my-project` (origin `github.com/signature4748-obs/Scholario-upgrade`, public)

## 1. Executive Summary

Phase 8C was executed A→M in order. Phases A–D (forensic audit, database hardening, repository cleanup, CI readiness) landed as commits `aa83f67`/`92f3019`/`f8ed719` (recorded in `worklog.md` 8C-B/C/D). This session completed the interrupted Phase E, then F, G, and verified H–K within the hard credential boundary (§ below), producing:

- **§11 Atomic provisioning, verified**: School + founding Principal created in ONE transaction; concurrent races produce exactly one winner + one typed 409, zero orphan schools (8/8 tests).
- **§12 Setup readiness, end-to-end**: one shared DB-computed contract (`src/lib/school/setup-readiness.ts`) consumed by BOTH the platform console Setup tab and the principal's dashboard Setup Guide — honest zero-progress on a fresh school, 100% on a configured one (browser-verified on both tenants, mobile included).
- **§37 Provisioning acceptance, 12/12**: platform provision → PENDING gate → audited activation → principal login → the full build (branding/people/attendance/fees/exams+marks/timetable/website/messaging) **through real APIs only — zero manual SQL**.
- **§36 Tenant acceptance, 15/15**: two control-plane-provisioned test schools, full A↔B cross-tenant gauntlet (DB-level zero-foreign-row evidence), platform admin sees both, safe archival purge.
- **§40 Test suite, fresh full evidence**: every suite re-run standalone this session — 518 pass / 0 fail / 14 designed skips (pg-rls off-Supabase), plus tsc 0 and eslint 0 errors.

The verdict is **INTEGRATION READY**: the 8C delta is complete and locally verified, but pushing it (GitHub), running parked CI on a real runner, deploying it (Vercel), live Supabase/Resend verification, and §47 credential rotation are all gated on user-held credentials that do not exist in this sandbox (the handoff Vercel token is invalid — `invalidToken`, re-verified this session).

## 2. GitHub

- **Branch status**: `main` at local `cc7d495` (Phase 8C-G). 9 commits ahead of `origin/main` (`4a8aa6e`, the 8B canonical): 8C-B/C/D + 8C-E/F/G + the pre-session in-flight commit `4b16c15` (UUID message, §11+§12 work, now fully verified and superseded by 8C-E). `development` branch exists (8C-D, §3 strategy).
- **CI status**: workflow validated and parked at `.github/ci.yml.parked` — the push token lacks `workflow` scope (same constraint as `f7e65b5`; restoring it needs a workflow-scoped PAT or the GitHub UI). The parked file's seed step runs the full canonical 10-seed corpus and its four CI-red defects were fixed in 8C-D.
- **Protection status**: not configurable from this sandbox (no repo-admin credential); the `development → PR → CI → main` strategy is documented in `docs/CI.md`.
- **Hygiene**: qa-shots/ (304 files) retired (8C-C); dev-only utilities (Caddyfile, keepalive.mjs, spawn-detached.mjs, warm-chunks.mjs, examples/, mini-services/event-stream) retained and classified; `secrets-scan` 5/5 green this session; repo is public — secrets discipline remains a live constraint.

## 3. Supabase

- **In-sandbox truth (reproduced, not faked)**: local PG 16.4 (CI-parity env) — all 5 migrations apply from empty (`prisma migrate deploy`), full canonical seed corpus green, RLS enabled by migration, pg_trgm + 24 GIN + hot-path indexes (8C-B) verified by `database-integrity` 41/41 and the RLS gap closed in 8C-B.
- **Live Supabase**: reachable and healthy through the running Vercel deployment (`/health/ready` → `database:ok`, 199 ms). No Supabase URL/keys/DB password exist in this sandbox (8C-A grep evidence stands), so dashboard-side checks (RLS advisor, plan-tier backups/PITR, storage buckets) are **credential-gated, not verified this session**.
- **Backups (§38, honest)**: `docs/BACKUP_RECOVERY.md` — operator-triggered `db-backup.ts` + TESTED restore (40–44 s for 9,171 rows); RPO unbounded by default (no schedule), RTO minutes; Supabase platform backups explicitly NOT assumed.

## 4. Vercel

- **Live (anonymous evidence, re-verified this session)**: `https://scholario-production.vercel.app` — home 200, `/health/live` ok, `/health/ready` `database:ok`; `/api/schools/public` serves `cache-control: private, no-store` + `vary: Host` (8B cache isolation live) with the full security header set (HSTS, nosniff, referrer-policy, permissions-policy). Deployment protection ON for team aliases.
- **What's NOT done and why**: the handoff Vercel token is INVALID (`api.vercel.com /v2/user → invalidToken:true` — truncated as suspected; no Vercel operation is possible). The 8C delta therefore CANNOT be deployed from here; the live deployment continues to serve the pushed 8B build. Git integration on the Vercel project was never connected (8B record) — connecting it is a user action.
- **Architecture unchanged**: one Vercel project, all tenants, serverless-compatible (8B); custom domains via the TenantDomain model (§29) with the domain→tenant resolution never trusting client input.

## 5. Platform Control Plane (§9)

Complete: list/search/filter/status/plan + live counts; school detail with activate/suspend/reactivate (step-up + audited reasons), plan & feature flags, metadata, domains tab, audit trail, sessions, admins, settings, support/access tools. **New this phase**: the Setup tab (DB-computed guided-setup progress) and atomic, race-safe provisioning (§10/§11) with P2002→typed 409 mapping. A school Principal can never reach platform routes (disjoint token spaces, platform-isolation 43/43).

## 6. School Onboarding (exact final workflow)

1. Platform admin → `/platform/schools` → **Create School** (name/slug/code/plan + founding principal) → ONE transaction → **PENDING** school + principal + audit row; principal login refused (403 `SCHOOL_SUSPENDED`) until…
2. …platform admin → school detail → danger zone → **Activate** (step-up + audited).
3. Principal signs in → dashboard shows the **Setup Guide** (required steps with live counts + deep-links) → builds the school through the normal modules (teachers/classes/subjects+CSA/students/fees/exams/marks/timetable/website) — the guide self-removes when required setup completes.
4. Platform admin watches the same progress on the console's **Setup tab** (identical shared contract — parity test green).

No manual SQL at any step (§37, 12/12). Demo school stays deterministic/isDemo-without-privileges; clean schools stay honestly empty (§13/§14, enforced by live-DB assertions).

## 7. Tenant Isolation (actual results)

- Seeded pair (Sunrise↔GreenValley): 57/57.
- **Freshly provisioned pair (§36, new)**: 15/15 — roster isolation; student/exam by-id 404 (no oracle); cross-tenant marks pinned to the audit-3-b contract (200 envelope, `updated:0`, per-row errors, ZERO DB writes; `setMark` re-gates the exam by tenant); fee/attendance/message cross-tenant writes refused with row-count evidence; teacher class-hub scoped by DB cross-check; platform sees both; archival purge leaves zero rows.
- Cache isolation: `/api/schools/public` private/no-store + `vary: Host` (live-verified on Vercel); tenant-domains 16/16 incl. A/B/A host-mix.

## 8. Security

**PASS** — atomicity/race-safety (§11); builders-only readiness surface (403/401 gates); platform/school token-space disjointness; strict shared-budget rate limiting exact under concurrency (8/8); credential endpoints fail-closed; secrets-scan clean; seed guards (7/7); headers (9/9); export policy; CSV-injection guards; validation (13/13); PENDING lifecycle gate (403 honest message); audit rows on provision/activate.

**WARN** — (1) repo is PUBLIC: any future secret exposure is immediately live (mitigated by scans + env-driven credentials; rotation §47 pending); (2) dev-server heap ceiling (1400 MB) OOM'd once under this session's suite storm — keepalive resurrected in ~40 s, the 2600 MB env-only override is documented (8C-A), package.json untouched; (3) login-bucket state left by heavy dev/verification logins can shadow the ACCOUNT_LOCKED test until healed — 8C-D's heal exists, this session re-encountered it from MY OWN traffic (system correct, procedure noted).

**BLOCKER (environment, not code)** — no GitHub push credential (8C unpushed + CI parked), invalid Vercel token (no deploy), no Supabase management credential (dashboard verifications), no Resend key (live email). None can be resolved from this sandbox; all are user actions with prepared runbooks.

## 9. Tests (fresh, this session, standalone per suite)

- **raw**: 518 pass / 0 fail / 14 skips (pg-rls, off-Supabase by design) — security 292 (tenant-isolation 57, platform-isolation 43, database-integrity 41, rate-limit 12+8, auth-core 13, upload 14, validation 13, platform-provisioning 8, salary 9, messaging 12, email-infra 10, phase75 14, realtime-bridge 9, tenant-domains 16, fee-lifecycle 5, errors 8, assignment-scope 11, pg-money 8, audit 5, file-signing 7, headers 9, search-case 4, csv-injection 4, export-policy 5, secrets-scan 5, seed-guard 7, demo-creds 5), e2e 32 (journeys 5, provisioning-acceptance 12, tenant-acceptance 15), api 65, regression 18, integration+unit 111.
- **re-verification**: provisioning-acceptance ×2, platform-provisioning ×3, school-setup-readiness ×2 — stable green.
- **build**: production build not re-run this session (canonical 8B record: EXIT 0, 147 s); dev-server compile + full route surface exercised instead.
- **lint**: eslint 0 errors (all touched files clean).
- **typecheck**: tsc 0 errors.
- **E2E**: §37 12/12 and §36 15/15 as above.
- **security**: all security suites listed above green standalone.

## 10. Performance

- Live prod `/health/ready` DB probe: **199 ms** (from this sandbox; bom1 co-location noted in 8B).
- Provisioning paths: full §37 journey (provision→activate→login→complete build→readiness) completes in ~3 s of test wall-clock.
- Readiness computation: one batched counts round (12 counts in parallel + 1 school read) — shared by both surfaces; parity test proves no double computation drift.
- 8B N+1 record stands (teacher/dashboard ~70→~24 queries; warm 7.7→3.4 s sandbox-RTT-bound).

## 11. Repository Cleanup

Retired earlier (8C-C): qa-shots/ (304 files), scaffold demo. Retained as classified dev-only: Caddyfile, keepalive.mjs, spawn-detached.mjs, warm-chunks.mjs, examples/, mini-services/event-stream. Added this phase: `src/lib/school/setup-readiness.ts`, `src/app/api/school/setup-readiness/`, `src/components/platform/modules/school-setup.tsx`, `src/components/principal/modules/dashboard/setup-guide.tsx`, 3 test files (platform-provisioning fixed, school-setup-readiness, provisioning-acceptance, tenant-acceptance). No garbage introduced (worklog + docs updated; /tmp probe scripts never committed).

## 12. Remaining Blockers (only real)

1. **GitHub push credential (workflow-scoped PAT)** → push 8C, restore `.github/ci.yml`, enable branch protection.
2. **Valid Vercel token** → connect Git integration / deploy the 8C delta (or connect the repo and let Preview deploy it), verify on production.
3. **Supabase dashboard access** → confirm RLS advisor, storage bucket policy, plan-tier backups/PITR for the real project.
4. **Resend API key** → live end-to-end email verification (infra + tests already green).
5. Then §47 rotation (below) — correctly sequenced AFTER the above.

## 13. Credential Rotation

**None rotated this session — by design.** §47 says rotate only after all integration work is finished; the integration steps above are credential-blocked. The only credential present in this sandbox (handoff Vercel token) is **invalid** — nothing live to rotate from here. Rotation runbook for the user (never values): Supabase DB password / service-role / anon / management token, Vercel token, GitHub PAT, Resend key, webhook + app signing secrets — then verify-new-fail-old, re-scan repo/logs/browser/git-history.

## 14. Final Verdict

**INTEGRATION READY**

The Phase 8C engineering is complete and verified to the standard the mission sets (correctness, isolation, integrity, honest observability, no faked success). Production Candidate requires the five credential-gated steps in §12; Production Ready additionally requires §47 rotation + post-rotation verification. The live production deployment remains healthy on the pushed 8B build throughout.
