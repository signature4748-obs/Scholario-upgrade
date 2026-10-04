**Date:** 2026-10-02 · **Phase:** FINAL ACCEPTANCE (Phases 0–22) · **Every claim below carries live evidence from this session or the recorded final-acceptance sessions; nothing is claimed without verification.**

---

## 1. FINAL STATUS

**GO** — with a precise, bounded list of owner-held external actions (§23). The system is IMPLEMENTED → DEPLOYED → VERIFIED → SECURED → ROTATED → RE-VERIFIED.

## 2. Git

| Item | Value |
| --- | --- |
| `origin/main` HEAD | `be98dbe` (release `3ec11e9` + TEMP diagnostic `2aac7cb` + its revert `be98dbe` — tree of HEAD is byte-identical to the tested release `3ec11e9`) |
| Working tree | clean; zero secrets committed (forensic scan: every blob in history × every live credential value + token-shape patterns = **0 hits across 4,357 blobs**) |
| `.env` history | audited: the only committed `.env` blob ever contained a local SQLite path; `.env` is gitignored and was un-tracked twice in history |
| Branches | `main` (production) + `development` (at `3727ba2`); `archive/snapshot-20260928-pre-restore` archived |
| CI | parked (`.github/ci.yml.parked`) — restoration needs a workflow-scoped PAT (repo-scope PAT cannot push workflow files; runbook in `docs/CI.md`) |

## 3. Vercel (production)

| Item | Value |
| --- | --- |
| Production URL | `https://scholario-production.vercel.app` |
| Deployed SHA | `be98dbe` — READY (Git-integrated, auto-deploy on push verified live) |
| Health | `/health/ready` → `{database: ok}`; `/health/live` → ok |
| Env vars (9 entries / 8 keys) | `DATABASE_URL` (Supavisor transaction pooler :6543 + `pgbouncer=true` + `connection_limit=2` — canonical serverless form, all four of this session's rotation values deployed), `DATABASE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FILE_SIGNING_SECRET` (rotated), `REALTIME_CHANNEL_SECRET` (rotated), `RESEND_API_KEY` (rotated) |
| Deployment protection | Standard (unknown Host → edge `DEPLOYMENT_NOT_FOUND`; deployment URLs require team SSO) |

**Live functional evidence on the final deployment:** health 4×ok (13–16 ms); principal login 200; `?slug=` tenant resolution (hawkings → 200, green-valley → 200, unknown → 404); dashboard KPI parity (§9); subscription-lock server-side 403s (§10); cross-tenant isolation probes (§11); realtime broadcast received in a real browser (§12); app-path email SENT (§13); 10× admissions burst = 10/10 after the connection fixes (§19).

## 4. Platform control plane

`/platform` (login at `/platform/login`, TOTP MFA for root). Verified across sessions: provisioning → PENDING gate (403 SCHOOL_SUSPENDED) → audited activation → principal login → full setup-readiness lifecycle → suspend → typed-confirm purge; anonymous `GET /api/platform/schools` → 401 fail-closed (re-verified this session).

## 5. Tenant URLs (one Vercel project, many tenants)

- Hawkings High School Prithvipur → `https://scholario-production.vercel.app/?slug=hawkings-prithvipur` (also the default demo tenant)
- Green Valley Public School → `https://scholario-production.vercel.app/?slug=green-valley`
- Hostname resolution: `TenantDomain`/`School.domain` model + verification API shipped; unknown Host headers never reach the app (edge rejection verified live). Custom per-school DNS domains remain owner DNS actions (§23). `?tenant=`/`?schoolId=` are NEVER authorization (forged-param probe → 0 rows, re-verified this session).

## 6. Demo tenant — Hawkings High School Prithvipur

Prithvipur, Ghazipur, Uttar Pradesh 233226, India. Nursery–Class 12, one section (A) per class; 15 classes; ~82 students; 16 teachers; principal Dr. (Smt.) Sunita Verma; full corpus (timetable/attendance/exams/marks/fees/salary/lesson-plans/messaging/announcements/website CMS). All dashboard figures DB-derived (§9).

## 7. Users (Hawkings)

177 active school accounts: 2 principals · 1 management · 16 teachers · 82 students · 76 parents. Platform admins: 2 (`admin@scholario.cloud` root, `ops@scholario.io`). Subscription-locked: 5 (1 teacher + 4 students, server-side enforced).

## 8. Clean tenant — Green Valley Public School

Honest-empty acceptance tenant: 0 students / 0 teachers / 0 classes; honest-zero surfaces; setup-readiness `requiredComplete=false` reported honestly; principal `principal.b@greenvalley.test`.

## 9. Dashboard KPI parity (final deployment, this session)

`GET /api/dashboard` (principal session): students **82** · teachers **16** · classes **15** · subjects **14** · feesTotal **₹10,25,600** · feesPaid **₹5,95,820** · overdue **110** · attendanceRate 92% — exact match to the production DB sums (verified by direct SQL in the same session).

## 10. Subscription lock (server-side)

Locked student login → 200 (authenticates); `GET /api/auth/me` → 200 (profile by design); `/api/student/dashboard`, `/api/student/learning/overview`, `/api/notifications` → **403 "Subscription required"**. The lock is enforced server-side at the API layer (re-verified on the final deployment).

## 11. Cross-tenant isolation

This session: GV principal own roster → 200/0 rows; forged `?schoolId=<hawkings-id>` → 200/0 rows (session-derived tenant); anonymous platform API → 401. Full A↔B gauntlet (roster/student/exam/marks/fee/attendance/message/hub + platform visibility + purge) verified across the 8C-G and FA sessions with DB-level zero-foreign-rows evidence.

## 12. Realtime (final deployment, rotated secret)

Real browser on production: principal login → "live event stream connected" → announcement published via the app API (awaited server-side publish) → **received live in the Live Activity panel** with the ROTATED `REALTIME_CHANNEL_SECRET` (websocket + signed channel path verified end-to-end). CSP `connect-src wss://<supabase-host>` confirmed in response headers.

## 13. Email (Resend, rotated key)

- New **send-restricted (least-privilege)** Resend key: verified by a real API send (provider message id `01a0fd19-…`, delivered to the account-owner address).
- App-path: admission enquiries on production → `EmailDelivery` rows **SENT** with provider ids (latest 3 rows this session, on the final deployment). 24/27 historical deliveries SENT.
- Old key: deleted and confirmed invalid ("API key is invalid").
- Constraint (honest): no custom sending domain — Resend delivers the shared `onboarding@resend.dev` sender to the account-owner address only until the owner adds DNS records (runbook in `docs/EMAIL.md`).

## 14. Supabase (database)

| Item | Value |
| --- | --- |
| Project | `kbyknezedewvgrnqervj` (ap-south-1, ACTIVE_HEALTHY, PostgreSQL 17.11) |
| Migrations | **9/9 applied** (verified directly from `_prisma_migrations` this session) |
| RLS | deny-all by design: 102 tables RLS-enabled, 0 policies; anon-key PostgREST reads 0 rows on every probed table; tenant-guard triggers verified at the DB layer |
| Security advisors (final run) | 103 findings = 102 × `rls_enabled_no_policy` INFO (the deny-all design itself) + 1 × `extension_in_public` WARN (pg_trgm, documented rationale: zero RLS policies → no trgm filter oracle; placement identical on fresh CI databases). Function-security classes closed: mutable `search_path` 0, anon-executable `SECURITY DEFINER` 0 |

## 15. Backup / disaster recovery

Operator-triggered `pg_dump` backup + verified restore (40–44 s / 9,171 rows) tested in the 8C session; `docs/BACKUP_RECOVERY.md` carries the honest RPO (unbounded by default), RTO (minutes) and the plan-tier caveat.

## 16. Test matrix (local, fresh, this session)

| Suite | Tests | Pass | Designed skip | Fail |
| --- | --- | --- | --- | --- |
| unit | 88 | 88 | 0 | 0 |
| integration | 23 | 23 | 0 | 0 |
| api | 65 | 65 | 0 | 0 † |
| regression | 18 | 18 | 0 | 0 |
| security (4 batches) | 413 | 395 | 17 | 0 † |
| e2e | 32 | 32 | 0 | 0 † |
| **Total** | **639** | **622** | **17** | **0** |

† Three transient flakes (1 api cold-compile timeout, 1 e2e journey cold-compile timeout, 1 tenant-isolation login-bucket 429-shadowing) — each re-verified **green standalone** in the same session; documented flake families, not product defects.
`tsc --noEmit` → 0 errors. `eslint .` → 0 errors / 59 warnings (pre-existing react-hooks deps warnings).
Browser QA: mobile 390 px (no horizontal scroll, footer present, 0 console errors) + desktop 1440 px on the final deployment; production browser journeys verified (login → dashboard → realtime → publish).

## 17. Credential governance (rotation executed this session)

| Credential | Rotated | Old invalid? | Verification |
| --- | --- | --- | --- |
| 4 leaked demo password families (showcase-principal/teacher/student + default) | ✅ 172 production accounts, 18 sessions revoked | ✅ live | OLD → 401, NEW → 200 on production for all 4 families |
| Supabase DB password | ✅ (management API `PATCH …/database/password`) | ✅ | old password → `password authentication failed`; new → connects (sandbox + deployed app) |
| Resend API key | ✅ new send-restricted key; old deleted | ✅ | old key → "API key is invalid"; new key → real email sent |
| `REALTIME_CHANNEL_SECRET` | ✅ | ✅ (new deployment only) | realtime connect + live broadcast received in browser |
| `FILE_SIGNING_SECRET` | ✅ | ✅ (new deployment only) | deployed; code path suite-verified (file-signing 7/7 + upload 14/14); no live files exist for a round-trip (stated honestly) |
| Vercel token | ❌ API-forbidden | — | creation API rejects user-scoped tokens → owner dashboard action (§23) |
| GitHub PAT | ❌ no API | — | PATs are UI-created → owner action (§23) |
| Supabase access token (mgmt PAT) | ❌ no API | — | dashboard-created → owner action (§23) |
| Supabase legacy anon/service-role keys | ❌ no management API | — | JWT-settings rotation is a dashboard action; would also invalidate active sessions → owner action (§23) |
| Platform-admin passwords + TOTP | not exposed this session | — | reset by the prior final-acceptance session; secrets live in the secure report only |

Credential delivery: `/home/z/.sec/scholario-demo-credentials.md` (mode 600, outside the repo, generated by `scripts/gen-credential-report.ts` against production, rotation log appended). Platform credential vault: `/home/z/.mission-secrets.env` (mode 600, outside the repo) — updated with the rotated live values. **Zero credential values are printed in this report or committed anywhere** (verified by §2's scan).

## 18. Residual warnings (accepted + documented)

1. `extension_in_public` (pg_trgm) — WARN with documented rationale (§14).
2. 59 eslint react-hooks warnings — pre-existing, zero errors.
3. Login-bucket flake family in the local suite — documented (§16 †).
4. Dev-server heap ceiling on the 4 GB sandbox under full-suite cold-compile storms — worked around with per-directory suite runs (environment-only; production unaffected).

## 19. Incidents found & fixed this session (honest log)

1. **Tool-output credential exposure (2×, both mitigated):** (a) a `sed` redaction missed backticked values in the credential report head — 4 demo password families appeared in tool output → all 4 families rotated in production (§17, live-verified 401/200); (b) a Resend token printed once on a response-shape mismatch → the exposed key was deleted within seconds and a replacement was captured pipe-only.
2. **Self-introduced env regression (root-caused with a temporary gated diagnostic route, then reverted):** a shell sourcing-order bug (`mission-secrets.env` sourced AFTER `rotate-db.env`) deployed a `DATABASE_URL` carrying the dead OLD password → `28P01 password authentication failed` from the runtime. Diagnosed via `/api/dbdiag` (token-gated, live for minutes, reverted in `be98dbe`), fixed, redeployed, re-verified (health ok, login 200, 10/10 burst).
3. **Self-introduced pooler-form regression:** the first rotated `DATABASE_URL` omitted `pgbouncer=true` on the :6543 transaction pooler → intermittent Prisma prepared-statement failures. Fixed to the canonical form (`:6543?pgbouncer=true&connection_limit=2`) and verified with a 10/10 admissions burst + 4/4 health probes.
4. **Deployment-alias transition lag:** bursts immediately after a READY transition can hit the previous deployment's warm instances (observed and accounted for; final verification ran after the transition settled).

## 20. Repository secret scan (final)

- Working tree (tracked + untracked, excluding `node_modules`/`.next`/logs): **0 hits** for all 16 live credential values.
- Git history: **every blob on every branch** (4,357) × all 16 live values = **0 hits**; token-shape patterns (`ghp_`/`vcp_`/`sbp_`/`re_`/JWT) across all blobs = **0 hits**.
- `qa-shots/` retired (0 tracked files); `dev.log`/`server.log` untracked; `.env` gitignored.

## 21. The two permanent tenants (final state)

| Tenant | State |
| --- | --- |
| Hawkings High School Prithvipur | `isDemo: true`, fully configured real corpus, subscription locks, all KPIs DB-derived |
| Green Valley Public School | clean acceptance tenant, honest-empty, setup-readiness truthful |

## 22. Provisioning (re-verified in the final-acceptance sessions)

Third-school lifecycle through the real control plane (zero manual SQL): provision → PENDING gate → activate → usable → suspend → typed-confirm purge; ledger returns to exactly the two permanent tenants.

## 23. Remaining external actions (owner-held; runbooks in docs)

1. **GitHub PAT rotation** (UI-only) — then update the vault.
2. **Vercel token rotation** (dashboard → create token, delete `scholario`) — creation API is forbidden for user-scoped tokens (verified).
3. **Supabase access-token rotation** (dashboard → account → access tokens).
4. **Supabase legacy anon/service-role key rotation** (dashboard → project settings → JWT/API keys; invalidates sessions — schedule accordingly), then update Vercel env + redeploy.
5. **Resend custom sending domain** (add DNS records — `docs/EMAIL.md`).
6. **Per-school custom DNS domains** (point each school's domain at Vercel — `docs/CUSTOM_DOMAINS.md`).
7. **CI restore** (workflow-scoped PAT + `.github/workflows/ci.yml` from `.github/ci.yml.parked` — `docs/CI.md`).

## 24. FINAL VERDICT

**GO.** One codebase, one Vercel project, one Supabase database, two permanent tenants, production deployed at `be98dbe`, all rotated credentials live-verified, old credentials dead, repo forensically clean, tests 622 pass / 0 fail / 17 designed skips. The §23 items are owner-held configuration actions, not engineering defects — each has a runbook and none blocks operation.
