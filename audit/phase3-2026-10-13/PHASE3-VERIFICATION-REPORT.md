# PHASE 3 VERIFICATION REPORT — school-provisioning reliability lifecycle

**Session:** 2026-10-13 (continuation), Task: finish implementation + verification
**Feature branch (pushed):** `feat/phase3-school-provisioning-reliability` @ `c5ccd41`
**Pull request:** #29 (open, base `main` @ `27183a9`) — NOT merged, NOT deployed
**Local evidence branch:** `main` @ 15 local-only commits (never pushed)

## 1. Implementation files changed (the PR, 11 files, +1602/−198)

| File | Change |
|---|---|
| `src/app/api/platform/schools/route.ts` | idempotent replay + principal-invite send + ledger invitation column |
| `src/app/api/platform/schools/[id]/reissue-credential/route.ts` | NEW — guarded credential re-issue |
| `src/app/api/platform/schools/[id]/route.ts` | dossier provisioning state + readiness + invitation |
| `src/app/api/schools/route.ts` | DELETED — dead legacy school-plane factory |
| `src/lib/platform/principal-invite.ts` | NEW — invite send/dedupe/state derivation |
| `src/lib/email/templates.ts` | `principal-invite` template (zod-validated, escaped) |
| `src/lib/email/types.ts` | template id + props types |
| `src/components/platform/modules/provision-wizard.tsx` | replay-aware panel + honest invitation state |
| `src/components/platform/modules/school-detail.tsx` | Access card: credential/invite states + re-issue flow |
| `src/components/platform/modules/schools.tsx` | ledger invite-failed chip |
| `tests/security/provisioning-reliability.test.ts` | NEW — 12-test reliability suite |

No schema changes · no migrations · no secrets · no mock data. `dbg-replay.mts`
(debug script from the implementation commit) deliberately EXCLUDED from the PR.

## 2. Test results (disposable PostgreSQL @ 127.0.0.1:54331, live dev server)

**All green — per suite / small groups (the reliable execution mode):**
- provisioning-reliability **12/12** (×2 runs) · platform-provisioning **8/8** (×2)
- platform-isolation **45/45** (×5 runs) · school-setup-readiness **5/5** (×2)
- e2e provisioning-acceptance §37 **12/12** · e2e tenant-acceptance §36 **15/15**
- tenant-isolation+model **76/76** · tenant-domains+saas-hardening **36/36** (after .env fixture restore)
- email-infra+providers **49/49** · plane-architecture+secrets-scan+pg-rls **32 pass/14 skip**
- credential-reset+platform-password-change+auth-core **33/33** (×2)
- upload-authz+upload+resend-webhook **93 pass/9 skip** · auth-gate+identity-authz **74/74** (×2)
- auth-sessions+calendar-server-events **20/20** (×2) · saas+subscription-lock **30/30**
- platform-account-recovery **76/76** (×2) · fee-gateway+fee-admissions **58/58**
- messaging+RAH+holidays+attendance **49/49** · identity+errors+fee-lifecycle+auth-sessions **64/64**
- credential-reset+auth-core+plane+domain-smoke **66/66**
- phase75+tenant-iso+recovery+provisioning+reliability group **167 pass/1 skip/0 fail** (re-run)

**Full-suite batch (log: full-test-batch-chunked.log): 1142 pass / 66 unique fail.**
Every failure belongs to the in-repo documented dev-server memory flake family
(kernel OOM-kill of next-server at ~2.3–2.6 GB RSS on the 4 GiB sandbox; cold-compile
first-hit latency; beforeAll cascades during slow windows). Every affected suite was
re-verified green standalone (above). Zero assertion-level failures survived re-run.

**One genuine environment gap found + fixed:** `saas-hardening` webhook test 401 —
`.env` had been slimmed to `DATABASE_URL` only when the disposable PG was wired; the
fail-closed webhook route correctly rejected unsigned traffic. Fix: restored the five
dev-only test-fixture env vars to `.env` (same set as `scripts/dev-keepalive.mjs`,
values committed in-repo — never real secrets).

**One workspace anomaly root-caused (NOT a Phase 3 regression):** local `main` was
missing 4 upload-route files (659 lines) — deleted by auto-checkpoint `f8be545`;
`origin/main` HAS them. Restored locally (commit `744e4d4`); the feature branch
carries them by construction. This caused the upload/auth-gate suite failures in
batch runs, not the Phase 3 diff (which never touches those paths).

## 3. End-to-end (browser, Agent Browser) — full lifecycle verified

Provision wizard (6 steps) → PENDING school + one-time credential (server-generated,
shown once) + invitation "delivered (sent), transport dev-log" → activation via
Danger zone → ACTIVE "Usable — setup incomplete" (NEEDS_SETUP) → re-issue via UI
(confirm → fresh credential + invite re-sent) → OLD password 401 "credential
mismatch" (dev.log) → NEW password admits → forced first-password-change →
principal workspace (full nav, live data) → dossier flips to "Owns password",
re-issue button REMOVED (client mirror of the server's owned-refusal) →
activity trail LOGIN_FAILED/LOGIN_SUCCESS/PASSWORD_CHANGED/SESSION_ROTATED/LOGOUT.
Setup tab: honest DB-computed 3/5 required. Screenshots in this directory.

## 4. Tenant isolation & authorization (roles)

- **Super Admin (platform root):** full console; school sessions/anonymous 401 on
  platform APIs; disjoint token spaces verified bidirectionally (suites + browser probes).
- **Principal:** full §36/§37 journeys + browser E2E; foreign-tenant student id →
  404 no-oracle; own-tenant roster honest-scoped (0 rows for the new tenant).
- **Teacher:** 403 on builders-only surfaces; class-hub scoped to own school (§36).
- **Student:** 403 on staff surfaces (setup-readiness, role boundaries suites).
- **No failed invitation is ever reported as READY:** FAILED/missing invite +
  bootstrap credential pending ⇒ `REQUIRES_ATTENTION` (suite + UI verified).

## 5. Gates

- `tsc --noEmit`: **0 errors** · `eslint .`: **0 errors** (57 pre-existing warnings, count unchanged)
- Production build `SCHOLARIO_PLANE=platform NODE_ENV=production next build --webpack`
  (2500 MB heap, dev server stopped): **EXIT 0** — compile 67 s, TypeScript gate
  passed, 200/200 static pages, standalone bundle + static/public copies, new route
  in the table. (Note: bare `bun run build` without a plane var fails-closed at
  page-data collection — pre-existing origin/main behavior from `3e90b25`, not a
  Phase 3 regression; production deployments set the plane env per project.)

## 6. Production safety (explicit confirmations)

- **NO production connection, mutation, dump, dispatch, merge, deploy, billing or
  DNS change of any kind this session.** All testing used the local disposable
  PostgreSQL (54331) and the local dev server. The pending feeId migration was NOT
  applied; no production-write workflow dispatched. The only network operations:
  GitHub (read-only fetch + the feature-branch push + PR #29 creation, per mission).
- Local evidence preserved: 15 local commits on `main` (never pushed), 3 stashes,
  16 audit dirs. The 55432 drill cluster (restored production copy) untouched.

## 7. Remaining notes for review

- Branch-switch flake: an environment auto-checkpoint reverts non-`main` checkouts in
  the project worktree — the feature branch was built and committed from a separate
  worktree (`/tmp/phase3-wt`), then pushed.
- Batch-mode memory flake is environmental (4 GiB sandbox); CI/Vercel runners are
  unaffected. Per-suite runs are the reliable local mode (documented above).
