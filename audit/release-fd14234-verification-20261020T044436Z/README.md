# Release `fd14234` — post-integration verification pack (2026-10-20)

Factual record of the verification performed AFTER the Add-School wizard
release (PR #41 → main `fd14234`) was merged, the production migration
applied, and both planes deployed. Every database command below was run
from a checkout of `fd142344c607be4f6763c9dfc80386d22e8aa665`
(origin/main HEAD at verification time) using the repository's own
pipeline scripts — read-only against production.

## 1. Release identity

| Item | Value |
|---|---|
| Repository | `signature4748-obs/Scholario-upgrade` |
| Release commit | `fd142344c607be4f6763c9dfc80386d22e8aa665` — "Merge pull request #41 from feat/add-school-wizard-7step" (2026-10-20T00:01:40Z) |
| Feature | 7-step Super Admin Add-School wizard — internal record prefix (server-side advisory-lock allocation), optional official code, subscription billing terms, student-based yearly-only rule, student-access pause |
| Diff | 17 files, +3,651 / −568 — incl. migration `20261020120000_school_record_prefix_billing_terms` and 921 new test lines (`tests/api/school-onboarding-wizard.test.ts` 785 + `tests/unit/school-identity-derive.test.ts` 136) |
| Branch CI before merge | GREEN at `79a4957` (pull_request run, 2026-10-19T23:41Z, run 39345357466 attempt after the 977646a typecheck fix) |

## 2. Production database (Supabase `kbyknezedewvgrnqervj` — ap-south-1)

- `20261020120000_school_record_prefix_billing_terms` applied
  **2026-10-20T00:05:24.207Z** — single-transaction Management-API
  pipeline apply, proven by the true-checksum history row:
  `checksum = 3f269cec3d568f3c45f5ed3abd581b49bb84ead08e6e407be5bf1833568a1f47`
  (= sha256 of the repository migration file, byte-identical),
  `rolled_back_at = NULL`.
- History: **26 applied / 26 in repo / 0 pending** (preflight + verify stage A).
- Objects verified on production:
  - `School.recordPrefix` TEXT nullable + `UNIQUE INDEX School_recordPrefix_key`
  - `SchoolSubscription.licensedStudents` INTEGER nullable + `CHECK (IS NULL OR > 0)` (`SchoolSubscription_licensedStudents_positive`)
- Deterministic backfill verified (oldest-first, per-abbrev MAX+1):
  - Green Valley Public School → **GVPS-0001**
  - Hawkings High School Prithvipur → **HHSP-0001**
- Financial ledger UNCHANGED vs the last in-repo evidence
  (`audit/apply-live-20261019T135302Z`): rows 226 · amount sum
  `602480.00` · privacy-safe digest `a87ebe601cdf…` → identical
  (verify stage E2) — the wizard migration moved no money.
- Also green (verify stages B–G): tenant guards ins+upd enabled ·
  trgm 24/24 · schoolId 11/11 · credential flags 2/2 + 180/180 ·
  invariant violations 0 · users 187 stable · account-recovery shapes intact.

### Honest process note

The 00:05:24Z apply was executed over the documented Management-API
pipeline channel (single transaction + true checksum — the
`_prisma_migrations` row is the authoritative record), but its pre-apply
preflight snapshot was **not retained in the repository**. This pack is
the **post-hoc** verification: the ledger digest above proves the
migration moved no financial value, and every pipeline gate re-ran green
from the release checkout. No production data beyond the migration's own
statements was touched.

## 3. Canonical verifications run from the `fd14234` checkout (this directory)

| Artifact | Script | Result |
|---|---|---|
| `preflight-log-20261020T044436Z.txt` + `preflight-snapshot-20261020T044436Z.json` | `scripts/prod-migration/preflight.ts` (read-only) | exit 0 — PRE-FLIGHT GREEN |
| `verify-20261020T044436Z.txt` | `scripts/prod-migration/verify.ts --snapshot …` | exit 0 — ALL VERIFICATIONS GREEN (A–G) |
| `verify-deployment-20261020T044436Z.txt` | `scripts/prod-release/verify-deployment.ts --plane both` | exit 0 — RELEASE LIVE AND VERIFIED ON EVERY ACTIVE PLANE |
| `smoke-20261020T044436Z.txt` | HTTP probes | see §4 |
| (out-of-band, same checkout) | `scripts/prod-release/config-preflight.ts` | exit 0 — PRODUCTION CONFIG GREEN, 0 missing on both planes |

Deployment provenance (two-plane contract):
- platform plane `scholario-platform` — deployment `dpl_AdpizAGsuwZxoCCGeU2X5hoT2LeX` READY, built from `fd142344c6`
- school plane `scholario-app` — deployment `dpl_Hhsd3qp1mVDMs7GnnDB2hRY69qRM` READY, built from `fd142344c6`

## 4. Production smoke (2026-10-20T04:46Z)

| URL | Result |
|---|---|
| `https://scholario-platform.vercel.app/health/ready` | 200 `{"status":"ready", … "database":"ok"}` |
| `https://scholario-platform.vercel.app/platform/login` | 200 |
| `https://scholario-app-virid.vercel.app/health/ready` | 200 `{"status":"ready", … "database":"ok"}` |
| `https://scholario-app-virid.vercel.app/login` | 200 |
| `https://scholario-app-virid.vercel.app/s/green-valley/login` | 200 |
| `https://scholario-app-virid.vercel.app/api/public/notices/rss` | 200 |
| `https://scholario-app-virid.vercel.app/api/schools/public` | 404 without slug — the documented fail-safe tenant resolution; **200** with `?slug=green-valley` |

## 5. CI on main (`fd14234`)

- **Attempt 1** (push run 39345157812, 2026-10-20T00:01Z): RED — a single
  test failed: `tests/security/fee-gateway.test.ts · BATCH2-B4 · legacy
  POST /api/fees payment-record`, with a transient `ECONNRESET` against
  the job-local dev server (1,504 pass / 36 skip / 1 fail). This is the
  dev-server memory-guard/restart flake signature documented inside
  `.github/workflows/ci.yml` (supervisor + `DEV_OLD_SPACE_MB=4096` +
  E2E heap-reset mitigations). The content-identical branch run at
  `79a4957` was green → environmental flake, not a regression.
- **Attempt 2** (rerun-failed-jobs, 2026-10-20T04:41Z dispatch): **GREEN —
  completed success.** The full matrix re-verified on the release commit:
  typecheck · lint · migration chain on fresh PG · drift gate (24 trgm +
  11 schoolId sanctioned) · production build · 1,541 tests · E2E journeys.
- The earlier main-push red at `348b5b6` (PR #40, docs-only merge) was the
  same environmental class (timetable-conflict regression tests failing
  <1ms — connection-level), also green on its branch run.

## 6. Operator notes (unchanged, honest states)

- Principal-invitation email stays honestly fail-limited in production
  until the sending domain is verified
  (`audit/closure-2026-10-13/resend-sender-domain-owner-runbook.md`);
  `RESEND_API_KEY` / `EMAIL_FROM` are configured on both planes
  (config-preflight §3).
- Google sign-in stays honestly OFF (the three `GOOGLE_*` variables are
  intentionally absent; the runtime config gate disables it cleanly).
- Custom-domain verification requires the owner to control the domain's
  DNS — it stays PENDING with instructions until a real TXT record
  answers (never faked).
