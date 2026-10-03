# SCHOLARIO — OPERATOR LAUNCH ACCESS

**Date:** 2026-10-03 (restored after a sandbox snapshot rollback; updated with the
rotation root-cause) · **Scope:** operator handoff only. Tenant-isolation audit
evidence lives in git history (`docs: launch access handoff`, 637796d) and the
final forensic acceptance is `docs/release/FINAL_FORENSIC_PRODUCTION_ACCEPTANCE.md`
(commit a675a6f, at HEAD).

**Rule:** password values are NEVER in this file, in Git, or in source code. They
are delivered by exactly one secure mechanism (below).

---

## 1. SUPER ADMIN (Platform control plane)

| Item | Value |
| --- | --- |
| Production URL | `https://scholario-production.vercel.app/platform` → `/platform/login` |
| Login identifier | `admin@scholario.cloud` (root, all permissions) |
| Login factors | email + password + **TOTP** (6-digit authenticator code, every sign-in) |
| Secure handoff | `/home/z/.sec/scholario-demo-credentials.md` (chmod 600, outside the repo) → *Platform control plane* table. TOTP secret = env-driven `SEED_PLATFORM_ROOT_TOTP` (same artifact section). |

Secondary platform admin: `ops@scholario.io` (ops, limited) — same artifact table.

## 2. HAWKINGS HIGH SCHOOL PRITHVIPUR (demo tenant — 82 students)

| Item | Value |
| --- | --- |
| School URL | `https://scholario-production.vercel.app/?slug=hawkings-prithvipur` → **Login Portal** |
| Principal login | `principal@hawkingshigh.edu` — Dr. (Smt.) Sunita Verma |
| Teacher login | `teacher1@hawkingshigh.edu` — Smt. Kavita Singh |
| Student login | `aman.sah@hawkingshigh.edu` — Aman Sah, Class 7-A |
| Secure handoff | Same artifact → *Key accounts* table + full 177-account tables. |

## 3. GREEN VALLEY PUBLIC SCHOOL (clean tenant — zero business data by design)

| Item | Value |
| --- | --- |
| School URL | `https://scholario-production.vercel.app/?slug=green-valley` → **Login Portal** |
| Principal login | `principal@greenvalley.test` — Dr. Sandhya Menon |
| Teacher login | `teacher.b@greenvalley.test` — Sunil Rao |
| Student login | `student.b@greenvalley.test` — Ira Rao |
| Secure handoff | Same artifact → *Green Valley* table (tenant-fixture family; `principal.b@`/`parent.b@` fixtures also exist). |

---

## Secure credential mechanism (the ONLY delivery channel)

- **File:** `/home/z/.sec/scholario-demo-credentials.md` — chmod 600, generated OUTSIDE
  the repo by `scripts/gen-credential-report.ts` (refuses in-repo output paths; values
  never reach stdout). 177 Hawkings + 5 Green Valley + 3 platform accounts.
- **Regenerate:** `DATABASE_URL=<local pg url> bun scripts/gen-credential-report.ts`
  (re-reads the DB + env-driven seed source `prisma/seed-credentials.ts`; rotate by
  setting `SEED_*` vars and re-seeding).
- Repo hygiene enforced by tests: `demo-credential-exposure` + `secrets-scan` suites.

## Login verification (2026-10-03, one real login per account)

Each account: real login → `/me` identity echo (role + tenant binding) → logout →
dead-session 401 proof. Password values never printed.

| Account | Workspace stack (latest code 2199417, this deployment) | Production Vercel |
| --- | --- | --- |
| admin@scholario.cloud (root + TOTP) | **PASS** (isRoot confirmed) | rotated — see below |
| principal@hawkingshigh.edu | **PASS** (PRINCIPAL @ hawkings-prithvipur) | rotated — see below |
| teacher1@hawkingshigh.edu | **PASS** (TEACHER @ hawkings-prithvipur) | rotated — see below |
| aman.sah@hawkingshigh.edu | **PASS** (STUDENT @ hawkings-prithvipur) | rotated — see below |
| principal@greenvalley.test | **PASS** (PRINCIPAL @ green-valley) | rotated — see below |
| teacher.b@greenvalley.test | **PASS** (TEACHER @ green-valley) | rotated — see below |
| student.b@greenvalley.test | **PASS** (STUDENT @ green-valley) | rotated — see below |

Browser-verified additionally: Hawkings site (live counts 82/16/15/14), Login Portal →
principal sign-in → full ERP dashboard (82 students, 16 teachers, attendance 90.2%,
pending fees ₹4.30 L — live DB values), Green Valley site (own branding, honest zeros),
platform login page, 375px mobile (no overflow, no console/page errors).

## ⚠ Production access is credential-blocked — owner action required

**Root cause is now known (this was previously an unexplained divergence):** the final
forensic acceptance (commits 64b93b4 / a675a6f) executed a deliberate credential
rotation to the API boundary — Supabase DB password, Resend key, both signing secrets,
and the demo credential families: **all old credentials dead by design**. The rotated
values were delivered into the sandbox's secure storage (`/home/z/.sec/*`, chmod 600)
and the session vault — **both wiped by the Oct 3 sandbox snapshot rollback** (the same
reset that reverted the workspace; see the recovery worklog entry). Production
therefore rejects every pre-rotation credential — that is the security system working
as released, not a defect.

**Owner actions (any one):** ① retrieve the rotated handoff if it was exported/read
before the reset, ② re-rotate production credentials via the documented runbooks
(docs/FINAL_PRODUCTION_RELEASE_REPORT.md §23 owner-action list; docs/BACKUP_RECOVERY.md),
then regenerate the secure artifact, or ③ provision fresh launch accounts through the
platform provisioning flow. Until then: production login access is blocked; the
workspace stack above is the verified operational surface.

## Infrastructure (unchanged)

ONE repo (`signature4748-obs/Scholario-upgrade`, main @ 2199417) · ONE Vercel project
(`scholario-production`) · ONE Supabase project (`kbyknezedewvgrnqervj`) · TWO school
tenants (hawkings-prithvipur, green-valley) · temporary slug URLs are canonical until
real custom domains are configured. Resend: one API key; custom sending domain still
unconfigured (owner DNS action).
