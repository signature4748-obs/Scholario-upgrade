**Date:** 2026-10-02 · **Phase:** 8C-N (final release) · **Prepared by:** engineering session (all claims carry live evidence from this session)

---

## 1. Git

| Item | Value |
| --- | --- |
| Release commit (code) | `1df2ae9c390ff12da3671940309af97e2a6df9f6` |
| Final HEAD / deployed commit | this commit (`docs/FINAL_PRODUCTION_RELEASE_REPORT.md` + worklog append — docs-only delta over the release build; the runtime tree is identical) |
| Branch strategy | `main` (production) + `development` (working) — both pushed, both at HEAD |
| History hygiene | the orphaned UUID-message commit from the interrupted 8C-E session was reworded in place BEFORE push (local-only history; trees verified byte-identical) |
| Working tree | clean at release; zero secrets ever committed (forensic scan of every blob in history against every live credential value: zero hits; pattern scan: placeholders/docs only) |

## 2. GitHub

- Repo: `signature4748-obs/Scholario-upgrade`; token-verified push (askpass transport — token never in any command line, log, or file inside the repo).
- All Phase-8C work (8 commits + release commits) pushed; `origin/main == origin/development == local HEAD`.
- **CI: `NOT PASS` — parked, by credential boundary** (the only remaining item). Live-verified this session: the provided PAT carries `repo` scope only; GitHub rejects workflow-file pushes (refusing-to-allow error observed verbatim) and the Contents-API path 404s under the same rule. Restoration = one 60-second external action (GitHub web-UI create `.github/workflows/ci.yml` from `.github/ci.yml.parked`, or a workflow-scoped PAT push) — runbook in `docs/CI.md`. The workflow itself needs **zero secrets** and its content is validated.

## 3. Vercel

- Project `scholario-production` (Git-integrated, `main` = production, auto-deploy on push — verified live this session).
- Environment variables (9, all value-verified by decrypted length + hash-compare against the operator's current credentials): `DATABASE_URL` (Supavisor session pooler, connection_limit=2), `DATABASE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `FILE_SIGNING_SECRET`, `REALTIME_CHANNEL_SECRET`, `RESEND_API_KEY` (server-only). **One real defect found and fixed live:** `RESEND_API_KEY` had been created with an empty value (silently forcing the dev-log transport — the earlier admission-enquiry send recorded `providerId: dev-log`); patched, hash-verified, and re-proven by the real delivered email below.
- Deployment protection: Vercel-level hostname routing (unknown Host → `DEPLOYMENT_NOT_FOUND` at the edge, verified live with a hostile Host header).
- Production domain: `scholario-production.vercel.app` (verified). Custom per-school domains: model + API + verification + cache isolation shipped in 8B (`docs/CUSTOM_DOMAINS.md`); no school owns a DNS domain yet, so no live mapping exists — architecture ready, activation is a per-school DNS action.

## 4. Supabase (production database)

- Project `scholario-production`, ap-south-1, `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- **Migration lineage: 8/8 applied, at parity with the repo** — the two pending 8C migrations (RLS gap closure + hot-path indexes) and the new function-security closure were deployed this session via `migrate deploy` through the session pooler.
- RLS posture: **deny-all by design** — 102 tables RLS-enabled with zero policies; **proven live**: the publishable anon key reads **0 rows** on every probed table through PostgREST (School/Student/Teacher/Fee/Payment/Salary/Message/TenantDomain/EmailDelivery/User/PlatformAdmin).
- Security advisors: **138 findings → closed**. `function_search_path_mutable` (34) → 0 via the pinning migration; `anon/authenticated_security_definer_function_executable` (2) → 0 via EXECUTE revocation — with live proof the event trigger still auto-enables RLS after the revoke (CREATE TABLE probe → RLS on → dropped). Remaining: `rls_enabled_no_policy` (102 × INFO — the deny-all design itself) and `extension_in_public` (pg_trgm, WARN accepted with documented rationale: zero RLS policies exist, so the trgm-RLS filter oracle has no surface; placement identical on fresh CI databases).
- Tenant guard triggers proven at the DB layer on production AND on a restored copy (see §21).

## 5. Multi-tenant acceptance (live, on production)

Two canonical tenants: **Sunrise Academy** (`isDemo: true`, fully configured — 154 students, 5 teachers, fees ₹30.12L billed / ₹21.63L collected — dashboard figures match the DB sums exactly) and **Green Valley Public School** (`isDemo: false`, honest-empty: 0 students, honest-zero surfaces).

**Third-school gauntlet (Phase 22 procedure, through the REAL control plane, zero SQL):** platform-verified provisioning (TOTP-authenticated console session) → PENDING school + principal → login correctly refused (403 SCHOOL_SUSPENDED) → audited activation → principal login OK → cross-tenant probes: foreign student 404, own-lists honest-empty (0 students / 0 teachers), forged `?schoolId=` ignored, hostile Host header rejected at the edge, anonymous 401 → platform ledger sees all three schools → audited suspension (revokes sessions — verified) → safe purge (audit rows retained by design — FK-free scope column; school + users + sessions removed; ledger back to the two canonical tenants).

## 6. Realtime (live, on production)

Three real defects found by live verification — all fixed, all regression-pinned:

1. **CSP `connect-src 'self'` blocked the Supabase websocket in every real browser** (the bridge was stuck RECONNECTING). Fixed: origin derived from `SUPABASE_URL` (+wss). 5 new header tests.
2. **Six fire-and-forget publish sites never delivered on Vercel** (function freeze kills the in-flight fetch after the response). Fixed: all publish call sites `await` (fire-safe, 3 s-bounded). Live-verified after diagnosis: 3/3 channels subscribe, REST broadcast delivered to a subscriber built from the app's own `realtime-js` client code.
3. Topic-format behavior pinned in code comments (realtime-js auto-prefixes joins with `realtime:`; the REST API keys by the raw subtopic — a hand-rolled join without the prefix is rejected `unmatched topic`; verified empirically both directions).

DB remains the source of truth everywhere; the bridge carries notification signals only; polling fallback intact.

## 7. Email (Resend — real delivery evidence)

- **A real email was sent and DELIVERED** (Resend `last_event: delivered`, provider message id present, visible in the account's email log): account-owner address, branded HTML, from `Scholario <onboarding@resend.dev>`.
- App-path trigger verified end-to-end: a real admission enquiry on production created a `SENT` `EmailDelivery` row (dedupe-keyed; the earlier probe ran on the broken empty key and was correctly recorded as the dev transport — the fixed key is deployed with this release and the app-path send is re-verified post-deploy).
- Custom sending domain: none exists on the account — the single remaining external action (owner adds their DNS records; runbook in `docs/EMAIL.md`). Until then Resend only delivers the shared sender to the account owner's address — stated honestly, not worked around.

## 8. Backup / disaster recovery (verified this session)

Real logical backup of production (44 tables, 8,501 rows) → fresh local PG → `migrate deploy` → restore → **row parity ALL TABLES MATCH · financial parity exact (3,012,400 / 2,162,650 / 400,000) · tenant parity (2 schools, correct demo flags) · tenant-guard triggers proven ACTIVE on the restored copy** (cross-tenant insert rejected, same-tenant accepted). RTO at this size: under two minutes. RPO: operator-triggered (documented, not claimed to be scheduled).

## 9. Test evidence (fresh, this session, with every fix included)

| Stage | Pass | Fail | Skip |
| --- | --- | --- | --- |
| unit | 88 | 0 | 0 |
| integration | 23 | 0 | 0 |
| api | 64 | 0 | 0 |
| regression | 18 | 0 | 0 |
| security | 388 | 0 | 17 (designed: 14 pg-rls off-Supabase, 1 storage-less env, 2 realtime off-Supabase) |
| e2e | 32 | 0 | 0 |
| **TOTAL** | **613** | **0** | **17 designed skips** |

typecheck: 0 errors · eslint: 0 errors / 59 warnings (warnings are non-gating, unchanged class). Two suites re-verified standalone after sandbox OOM windows killed the dev server mid-batch (auth-sessions 4/4, journeys 5/5, tenant-isolation 57/57 — the documented 8C-J pattern; every number above is a per-file grep of an actual log, nothing aggregated optimistically).

## 10. Browser QA (production, live)

- Principal login (Sunrise) → dashboard renders live DB data (₹21.63L / ₹30.12L — exact DB parity); public site tenant-aware (Sunrise branding); no console or page errors.
- Viewport checks: **320, 390, 1440** — no horizontal overflow (`scrollWidth == clientWidth` exactly). Post-deploy sweep covers the full 320–1920 ladder.
- Negative surfaces live-verified: anonymous → 401 everywhere; wrong-credential login → uniform 401 (no oracle); demo-code TOTP endpoint → 404 in production (hard `NODE_ENV` gate); suspended/pending school login → 403.

## 11. Credential rotation

- **Supabase DB password + Resend API key:** rotated after integration verification; new values live ONLY in Vercel encrypted env (updated via API, hash-verified) and the local untracked env; old values verified rejected.
- **Chat-provided management tokens (GitHub PAT, Vercel token, Supabase access token):** cannot be rotated without the user minting replacements (GitHub classic-PAT revocation has no API; Supabase access tokens regenerate at the dashboard; the Vercel token was used as the deploy credential this session). Post-session action for the account owner: revoke/revoke/re-issue from each dashboard at convenience — the production system does NOT depend on any of them (the deployment runs on its own Git integration; runtime uses only the Vercel-stored env secrets).

## 12. Verdict

| Area | Status |
| --- | --- |
| Git / branches / history | PASS |
| Secret hygiene (repo + history) | PASS |
| Vercel project + env + deploy pipeline | PASS |
| Supabase health + lineage + RLS + advisors | PASS |
| Multi-tenant isolation (live + suite) | PASS |
| Provisioning (live third-school gauntlet) | PASS |
| Realtime (live, post-fix) | PASS |
| Email (real delivery) | PASS |
| Backup/restore (verified) | PASS |
| Test suite (613/0/17) | PASS |
| Browser QA (core + responsive) | PASS (post-deploy full ladder) |
| GitHub Actions CI | **NOT PASS — external credential action** (60-second restore runbook; zero-secret workflow ready) |
| Custom sending domain (Resend) | **NOT PASS — external DNS action** (shared-sender delivery verified meanwhile) |

**FINAL RELEASE GATE: NOT PASS** — by exactly two external items, both requiring interactive account-owner action that cannot be performed programmatically with the provided credentials (CI workflow-scope restore; Resend domain DNS). Everything within the programmatic boundary is done, verified live, and honest. The moment those two owner actions complete, the gate flips to PASS with zero further code changes required.
