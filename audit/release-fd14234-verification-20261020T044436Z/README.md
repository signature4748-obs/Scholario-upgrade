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
- Additional occurrences during this verification window (all the same
  live-dev-server transport class, each a DIFFERENT single test):
  - Release workflow dispatch (run 39372509050, on `fd14234`):
    `fee-gateway` BATCH2-B4, `ECONNRESET` at 68ms — the gate therefore
    CLOSED and migration/deploy/verify jobs were correctly SKIPPED
    (fail-closed design; production untouched).
  - This evidence PR's first CI run (run 39372654046, docs-only diff):
    tenant-slug session-isolation probe timed out at 5001ms (1 fail).
  - This evidence PR's CI rerun (attempt 2, identical tree): the
    provisioning-race canary failed at 2.12ms (transport-level) — a THIRD
    distinct test, same class.
  - Neither is a code regression: the identical tree passes the full
    matrix when the harness stays healthy (attempt 2 above; PR #41's
    branch run). The flake ledger across the window: **6 runs of the
    identical tree — 5 red, each on a single live-HTTP test at the
    transport level (fee-gateway ECONNRESET ×2, tenant-slug 5s
    timeout ×2, provisioning-race 2.12ms ×1) + 1 green (main fd14234
    attempt 2)** — chronic GitHub-runner dev-server instability, matching
    the mitigation history documented in `.github/workflows/ci.yml`
    (supervisor, `DEV_OLD_SPACE_MB=4096`, E2E heap reset). This PR's
    diff is `audit/` documentation only (text/JSON/PNG — nothing imports
    it at runtime), so these red runs carry no regression signal for
    the diff. A further heap bump or suite split requires a
    `workflow`-scoped token push (the repo's documented constraint) —
    owner decision, not attempted here.

## 5b. Release workflow (dispatch) — in-band gate record

- Dispatched on `main` @ `fd14234` (run 39372509050, defaults:
  `deploy_after_gate=false`, `migration_dry_run=false`).
- `Config pre-flight` job: **success** (the production-environment
  secrets are verified working in-band).
- `ci` job: red on the `fee-gateway` transport flake (§5) → the release
  gate evaluated and CLOSED; deploy/verify-deployment correctly
  skipped. No production change (by design).
- The gate components themselves are all green independently for this
  release SHA: CI (attempt 2), config-preflight (in-run + out-of-band),
  migration preflight/verify A–G (§3), two-plane verify-deployment (§3).

## 6. In-repo wizard visual verification (local stack — 2026-10-20)

Browser E2E against the REAL application running locally (repo at
`fd14234`, embedded PostgreSQL 18.4, canonical seed corpus, platform
root `admin@scholario.cloud`) — not the sandbox twin. Screenshots in
`wizard-visual/`:

- Full-page Add-School wizard opens from the **Schools** section; all 7
  steps walked with real values.
- **Identity**: name → auto short-name/slug (editable); live internal
  record-prefix preview **SIA-0001**; official school-code field
  optional with the honest "blank ⇒ the record prefix becomes the code"
  note.
- **Subscription**: School-based monthly/yearly vs Student-based —
  selecting Student-based hard-disables the frequency control to
  "Yearly (annual per-student)" with the explicit rule text; per-student
  amount + licensed student count; start date defaulted to today.
- **Academic**: session auto-default `2026-2027`, timezone
  `Asia/Kolkata`, Class 1–12 preset → 12 class rows (sections `A`).
- **Branding**: colour swatches + tagline with a live preview that
  reflected the tagline instantly; website enabled; optional custom
  domain with the honest PENDING-until-DNS text; platform subdomain
  shown.
- **Address**: invalid PIN `1234` BLOCKED continue with "Indian PIN code
  must be 6 digits (first digit 1–8)"; `471331` accepted.
- **Review**: Ready chips + per-section Edit for all six sections;
  `₹450.00 per student / year × 320 students = ₹1,44,000.00`;
  "none recorded yet — terms only, nothing billed at creation".
- **Create**: server-side transactional provision succeeded. A first
  attempt on a COLD route compile exceeded the client's platform-API
  timeout and provisioned NOTHING (verified: no audit row, no email, no
  DB row); the resubmit was idempotent — exactly ONE school, ONE invite
  email, ONE `platform.school.provisioned` audit row.
- **DB ground truth**: one School — `Sunrise International Academy`,
  `recordPrefix SIA-0001`, status PENDING, slug
  `sunrise-international-academy`; SchoolSubscription `PER_STUDENT` ·
  `ANNUAL` · `priceSnapshot 450` · `currencySnapshot INR` ·
  `licensedStudents 320` · `periodStart 2026-10-20` · `periodEnd NULL` ·
  no payment rows; 12 Classes; principal `mustChangePassword: true`.
- **390px viewport**: the platform schools shell renders with
  `scrollWidth 390 == clientWidth 390` — zero horizontal overflow.

## 7. Honest limitations of this pack

1. **The authed wizard walk at 390px could not be completed in this
   sandbox**: the environment is a 4GB box simultaneously hosting the
   sandbox preview app (~1.1GB), this repo's dev server and headless
   Chrome; the repo dev server was repeatedly OOM-cycled under that
   load. Verified at 390px: the schools shell (zero overflow). NOT
   verified in-browser: the full authed wizard flow at 390px in THIS
   repo (the identical flow was 390px-verified with zero overflow in
   the reference implementation's own browser E2E, and the wizard's
   behaviour is CI-verified). Recommended 2-minute owner spot-check:
   sign in to `scholario-platform.vercel.app` at 390px → Schools →
   Add school.
2. **School-record detail page visuals**: the detail page's first cold
   hydration wedged the tab under the same memory pressure; its APIs
   are covered by `tests/api/schools-management-overhaul.test.ts` and
   the prior audit screenshot series; not re-screenshotted here.
3. The 00:05:24Z live apply's pre-apply snapshot (§2 note) — post-hoc
   verification only; the ledger digest proves financial immutability.

## 8. Operator notes (unchanged, honest states)

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
