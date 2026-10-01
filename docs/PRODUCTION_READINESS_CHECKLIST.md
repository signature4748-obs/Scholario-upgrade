# Scholario-OS — Production Readiness Checklist (Phase 0)

Companion to `docs/PRODUCTION_READINESS_BASELINE.md`. Frozen-repo inventory of every readiness item with **status · evidence · affected files · severity · verification method**.

**Status legend**
- ✅ **PASS** — verified working/acceptable as-is
- ⚠️ **PARTIAL** — implemented but with material gaps
- ❌ **FAIL** — missing or actively harmful for production
- ⛔ **BLOCKER** — subset of FAIL that gates launch (mapped to Baseline §M)

**Severity legend**: `BLOCKER` > `HIGH` > `MEDIUM` > `LOW`
**Verification legend**: all verification methods below were actually executed during Phase 0 unless marked "run in later phase".

---

## 1. Repository hygiene

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| RH-1 | No committed environment files | ❌ BLOCKER | `.env` tracked with `DATABASE_URL=file:/home/z/my-project/db/custom.db` although `.gitignore` contains `.env*` | `.env`, `.gitignore` | BLOCKER | `git ls-files -i -c --exclude-standard` → lists `.env` |
| RH-2 | No committed runtime databases | ❌ BLOCKER | `db/custom.db` (3.7MB, 350 users, 519 sessions) tracked although `db/*.db` ignored | `db/custom.db`, `.gitignore` | BLOCKER | `git ls-files -i -c` + Prisma query of tracked file |
| RH-3 | No committed dev-only infrastructure | ⚠️ PARTIAL | `keepalive.mjs` force-tracked (watchdog, absolute `/home/z/my-project`); `warm-chunks.mjs`, `spawn-detached.mjs`, `Caddyfile`, `mini-services/`, `examples/` tracked | `keepalive.mjs`, `warm-chunks.mjs`, `spawn-detached.mjs`, `Caddyfile`, `mini-services/event-stream/**`, `examples/websocket/**` | MEDIUM | `git ls-files` + file headers |
| RH-4 | No committed QA/media bloat | ❌ FAIL | 156 screenshots (17MB) under `qa-shots/`; 19MB OCR runtime under `public/tesseract` | `qa-shots/**`, `public/tesseract/**` | MEDIUM | `du -sh qa-shots public/tesseract`; `git ls-files \| wc -l` = 1341 |
| RH-5 | Project documentation exists | ⚠️ PARTIAL | No README, no docs dir before Phase 0; only root `worklog.md` (2873 lines) | `README.md` (missing), `worklog.md`, `docs/` (created by this phase) | MEDIUM | `ls README*` → none; this document is the first `docs/` artifact |
| RH-6 | No secret material in tree | ✅ PASS | Grep for `sk-…`, `rzp_live_…`, `AIza…`, `ghp_…`, `BEGIN PRIVATE KEY` patterns → zero hits; payments/email secrets all env-gated | whole tree | LOW | `grep -rE` secret patterns across `src/ prisma/ public/` |
| RH-7 | Credentials not committed in source | ❌ FAIL | Demo plaintext passwords in login quick-access data + seed + worklog | `src/components/login/login-page/data.tsx`, `prisma/seed.ts`, `worklog.md` | HIGH | direct file read (Phase 0) |

## 2. Build & toolchain

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| BT-1 | Typecheck passes | ✅ PASS | `bunx tsc --noEmit` → 0 errors, exit 0 (recorded this phase) | whole tree | — | run `bunx tsc --noEmit` |
| BT-2 | Build errors not suppressed | ❌ FAIL | `typescript: { ignoreBuildErrors: true }` | `next.config.ts` | HIGH | read `next.config.ts`; currently masking nothing (tsc clean) — flag can be removed safely |
| BT-3 | Lint enforces meaningful rules | ⚠️ PARTIAL | `bunx eslint .` → 0 errors exit 0, but ~30 rules disabled (any, unused-vars, exhaustive-deps, no-console…) | `eslint.config.mjs` | MEDIUM | read config; run `bunx eslint .` |
| BT-4 | Strict TypeScript | ⚠️ PARTIAL | `strict: true` BUT `noImplicitAny: false`, `allowJs: true` | `tsconfig.json` | MEDIUM | read `tsconfig.json` |
| BT-5 | Production build succeeds | ✅ PASS | `bun run build` → standalone build completed, static+public copy steps OK (this phase) | `package.json` scripts | — | run `bun run build` |
| BT-6 | Dev-only hacks isolated from prod config | ❌ FAIL | custom lazyCompilation backend + watch ignores + sandbox `allowedDevOrigins` all inside `next.config.ts` (gated by `NODE_ENV` but same file) | `next.config.ts`, `src/lazy-compilation/**` | MEDIUM | read `next.config.ts` |
| BT-7 | Dependency set is portable | ⚠️ PARTIAL | `z-ai-web-dev-sdk` (sandbox AI SDK) is a runtime dep of `/api/ai/generate-questions`; `prisma` is a runtime dep (not devDep) | `package.json`, `src/app/api/ai/generate-questions/route.ts` | MEDIUM | read `package.json` + route imports |
| BT-8 | No machine-absolute paths | ❌ FAIL | `.env` DB URL, `keepalive.mjs` ROOT, `.zscripts` scripts (untracked), spawn-detached ROOT | `.env`, `keepalive.mjs`, `spawn-detached.mjs` | MEDIUM | grep `/home/z/my-project` |

## 3. Authentication

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| AU-1 | Passwords hashed with strong KDF | ✅ PASS | scrypt, 16-byte salt, 64-byte key, `timingSafeEqual` | `src/lib/auth.ts` | — | code read |
| AU-2 | Session tokens cryptographically random | ✅ PASS | `randomBytes(32).toString('hex')`, DB-unique | `src/lib/auth.ts` | — | code read |
| AU-3 | Cookie flags correct | ❌ FAIL | `httpOnly`+`sameSite:lax` OK; **`secure` missing** | `src/lib/auth.ts` (`setSessionCookie`) | HIGH | code read; curl login response `Set-Cookie` lacks `Secure` |
| AU-4 | Session token never exposed in responses | ❌ FAIL | login body returns `sessionToken`; client stores in `localStorage` and attaches Bearer | `src/app/api/auth/login/route.ts`, `src/lib/auth-session-token.ts`, `src/app/page.tsx` | HIGH | POST login → JSON contains `sessionToken` |
| AU-5 | Login brute-force protection | ❌ FAIL | no rate limit / lockout / captcha; no middleware | `src/app/api/auth/login/route.ts` | HIGH | code read; N rapid logins accepted |
| AU-6 | MFA for privileged roles | ❌ FAIL | none for any role incl. SUPER_ADMIN | `src/lib/auth.ts`, auth routes | MEDIUM | code read |
| AU-7 | Session expiry & revocation | ✅ PASS | 7-day TTL, lazy expiry delete, per-session revoke UI (`/api/auth/sessions/[id]`) | `src/lib/auth.ts`, `src/app/api/auth/sessions/**` | — | code read + DB query |
| AU-8 | CSRF protection | ⚠️ PARTIAL | no tokens; cookie flows rely on SameSite=Lax only; Bearer path CSRF-immune but localStorage-based | all POST routes | MEDIUM | grep `csrf` → none |
| AU-9 | Password change flow | ✅ PASS | `/api/auth/change-password` verifies old password | `src/app/api/auth/change-password/route.ts` | — | route read |
| AU-10 | Dev login bypasses gated | ❌ FAIL | quick-access credential chips render unconditionally (all four roles) | `src/components/login/login-page/data.tsx`, `index.tsx` | HIGH | load login screen in browser |

## 4. Authorization & tenancy

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| AZ-1 | All sensitive routes authenticated | ❌ BLOCKER | admissions + teachers upload (POST) and teachers upload `[fileId]` (GET/DELETE) have no auth | `src/app/api/admissions/upload/route.ts`, `src/app/api/admissions/upload/[id]/route.ts`, `src/app/api/teachers/upload/route.ts`, `src/app/api/teachers/upload/[fileId]/route.ts` | BLOCKER | grep sweep of all 188 routes for `withUser/getCurrentUser` (12 public, 6 legitimate + webhook + probes) |
| AZ-2 | School scoping enforced server-side | ✅ PASS | `schoolScoped()` on domain routes; `schoolId` filter in queries (sampled teacher/exams/fees/student) | `src/lib/api.ts`, 176 guarded routes | — | code sampling across domains |
| AZ-3 | Teacher scope canonical & robust | ⚠️ PARTIAL | CSA-based guard (good) + legacy case-insensitive teacherName fallback (name collision ⇒ scope grant) | `src/lib/teacher-scope.ts` | MEDIUM | code read |
| AZ-4 | Realtime tenant isolation | ❌ BLOCKER | socket broadcasts all schools' events to every socket; `cors: '*'`; auth-agnostic by design | `mini-services/event-stream/index.ts` | BLOCKER | code read + connect two demo schools and observe cross-tenant frames (later phase) |
| AZ-5 | Capability/permission enforcement on server | ⚠️ PARTIAL | fee capability guards exist ONLY client-side (store actions + UI); server `/api/fees/*` does not consult the capability matrix | `src/lib/permissions.ts`, `src/lib/tenant/store.ts`, `src/lib/store/fee-store.ts` | HIGH | code read |
| AZ-6 | Student data scoped to owning student | ✅ PASS | `/api/student/*` derives studentId server-side from session | `src/app/api/student/**` | — | route reads |
| AZ-7 | Role vocabulary single-sourced | ⚠️ PARTIAL | server uppercase strings vs client lowercase union; mapping ad hoc | `prisma/schema.prisma` (User.role), `src/lib/store/auth-store.ts` | LOW | code read |

## 5. Data & database

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| DB-1 | Production-grade database engine | ❌ BLOCKER | SQLite local file; Supabase migration deferred by instructions | `prisma/schema.prisma` (provider sqlite), `db/custom.db` | BLOCKER | schema read |
| DB-2 | Versioned migrations | ❌ FAIL | no `prisma/migrations/`; `db:push --accept-data-loss`; ad-hoc repair scripts | `package.json` (db:push), `prisma/backfill-payments.ts`, `prisma/migrate-iq3000.ts`, `prisma/repair-room-integrity.ts`, `prisma/spread-payments.ts`, `scripts/growth-migrate.ts` | HIGH | `ls prisma/` |
| DB-3 | Non-destructive default DB workflow | ❌ FAIL | `db:push` uses `--accept-data-loss`; sandbox dev.sh auto-runs it each start | `package.json`, `.zscripts/dev.sh` (untracked) | HIGH | script read |
| DB-4 | Connection string portable | ❌ FAIL | absolute machine path committed | `.env` | HIGH | file read |
| DB-5 | No PII in version control | ❌ BLOCKER | 519 session rows (IP+UA), 350 users, 152 student records committed | `db/custom.db` | BLOCKER | Prisma query of tracked file |
| DB-6 | Schema enums/constraints | ⚠️ PARTIAL | 0 Prisma enums; role/plan/status free strings | `prisma/schema.prisma` | MEDIUM | model scan |
| DB-7 | Single DB client | ⚠️ PARTIAL | event-stream opens the SQLite file directly with `bun:sqlite` | `mini-services/event-stream/index.ts` | MEDIUM | code read |
| DB-8 | Seed data clearly separated from runtime data | ⚠️ PARTIAL | 7 domain seed scripts write into the same `db/custom.db` that is committed | `prisma/seed*.ts` | MEDIUM | file inventory |
| DB-9 | Backups / PITR | ❌ FAIL | none (single file on ephemeral disk; no backup script) | repo-wide | HIGH | grep backup scripts → none |

## 6. API surface

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| API-1 | Uniform response envelope | ✅ PASS | `api()` wrapper everywhere (`{ok,data}` / `{ok,error}`, raw Response passthrough) | `src/lib/api.ts`, 188 routes | — | code read |
| API-2 | Correct HTTP error semantics | ❌ FAIL | non-mapped errors → 400 with raw `error.message` (no 500, leaks internals incl. Prisma messages) | `src/lib/api.ts` | MEDIUM | read wrapper; trigger a failing route |
| API-3 | Input validation layer | ⚠️ PARTIAL | hand-rolled per-route checks; no schema validation (zod removed) | all POST/PUT routes | MEDIUM | code sampling |
| API-4 | Health endpoint | ✅ PASS | `GET /api` → `{app,status,version}` | `src/app/api/route.ts`, `src/lib/app-version.ts` | — | curl `/api` (this phase: 200) |
| API-5 | Public endpoints minimized & intentional | ⚠️ PARTIAL | 12 unauthenticated routes; 6 legit (login/logout/health/version/public-site/rss) + webhook (HMAC) + admissions/public + **4 upload routes (not legit)** | see AZ-1 | BLOCKER | grep sweep |
| API-6 | Payment order flow single-sourced | ❌ FAIL | `/api/fees/orders` gateway STUB vs `payments/provider.ts` real+sandbox — two divergent paths | `src/app/api/fees/orders/route.ts`, `src/lib/payments/provider.ts` | HIGH | code read |
| API-7 | Webhook hardening | ✅ PASS | HMAC-SHA256 + `timingSafeEqual`, DB idempotency (`WebhookEvent` unique), fail-closed 503 without secret | `src/app/api/webhooks/razorpay/route.ts` | — | code read; POST without signature → 400 |
| API-8 | File upload validation | ⚠️ PARTIAL | magic-byte sniffing, size caps, opaque ids, traversal-safe ids — excellent; but anonymous (see AZ-1) and disk-only | upload routes + `[fileId]` routes | HIGH | code read + anonymous POST test (later phase) |

## 7. Payments / email / uploads / AI

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| PE-1 | Payment gateway integrated | ⚠️ PARTIAL | RazorpayProvider (fetch, env-gated, unconfigured) + SandboxProvider; `PAYMENTS_SANDBOX` unset; legacy stub path coexists | `src/lib/payments/provider.ts`, `src/app/api/fees/orders/route.ts`, `src/app/api/student/payments/**` | HIGH | code read; `getPaymentProvider()` returns null with current env |
| PE-2 | Webhook secret configured | ⚠️ PARTIAL | `RAZORPAY_WEBHOOK_SECRET` unset → route rejects (correct fail-closed) | `.env` | MEDIUM | POST webhook → 503/400 |
| PE-3 | Client never declares payment success | ✅ PASS | success only via server HMAC verify | `src/app/api/student/payments/verify/route.ts`, `provider.ts` | — | code read |
| PE-4 | Email provider exists | ❌ FAIL | no Resend/SMTP dependency (the mock EmailAdapter seam was deleted in PIH-4c — it had zero importers; the server-side boundary lands with the Resend phase) | deleted `src/lib/platform/adapters.ts` | HIGH (launch dep) | grep resend/smtp → none |
| PE-5 | File storage production-ready | ❌ FAIL | local disk `db/uploads/**` (ephemeral, no retention job) | upload routes, `src/lib/study-materials.ts` | HIGH | code read |
| PE-6 | AI feature portable | ❌ FAIL | `z-ai-web-dev-sdk` server dependency (sandbox-only) | `src/app/api/ai/generate-questions/route.ts`, `package.json` | MEDIUM | code read |
| PE-7 | Platform subscription/billing real | ❌ FAIL | client-side mock with hardcoded UPI + fabricated refs | `src/lib/platform-subscription.ts` | MEDIUM (not launch-critical) | code read |

## 8. Super Admin / platform

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| SA-1 | Real platform auth | ✅ PASS | SUPER_ADMIN role rows, null schoolId, session-gated routes | `src/lib/auth.ts`, `src/app/api/superadmin/**` | — | login smoke (this phase) |
| SA-2 | Cross-school read surfaces real | ✅ PASS | activity feed from ActivityLog/Payment/Session; platform dashboard counts | `src/app/api/superadmin/activity/route.ts`, `src/app/api/dashboard/route.ts` | — | route read |
| SA-3 | Tenant provisioning/management APIs | ❌ FAIL | no create/suspend school endpoint; only `showDemoSchool` toggle | `src/app/api/superadmin/settings/route.ts` | HIGH (SaaS posture) | API tree scan |
| SA-4 | Control-plane UI reflects real data | ⚠️ PARTIAL | Schools/Control Center read client mock tenant store (1 hardcoded tenant) | `src/components/superadmin/**` | HIGH | component read |
| SA-5 | Platform action audit log | ❌ FAIL | superadmin settings POST not logged; ActivityLog is school-scoped | `src/app/api/superadmin/settings/route.ts` | MEDIUM | code read |
| SA-6 | MFA / elevated session policy | ❌ FAIL | none | auth stack | MEDIUM | code read |
| SA-7 | Super admin credentials rotated | ❌ FAIL | seed super admin `admin@erpsuite.io` uses the env-driven dev default (rotatable via `SEED_SUPERADMIN_PASSWORD`); second account password follows the same mechanism — rotate before cutover | `prisma/seed-credentials.ts`, `db/custom.db` | HIGH | DB query + seed read |

## 9. Observability

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| OB-1 | Domain audit journal | ✅ PASS | ActivityLog (62 rows) + superadmin feed with provenance | `prisma/schema.prisma`, `src/app/api/superadmin/activity/route.ts` | — | route read + DB count |
| OB-2 | Structured app logging | ❌ FAIL | console.* only; logs tee'd to dev.log/server.log | repo-wide | MEDIUM | grep console usage |
| OB-3 | Error tracking / alerting / APM | ❌ FAIL | none | — | MEDIUM | dependency scan |
| OB-4 | Request correlation IDs | ❌ FAIL | none | — | LOW | grep |
| OB-5 | Deploy version marker | ✅ PASS | `/api` returns app + version 2.14.0 | `src/app/api/route.ts`, `src/lib/app-version.ts` | — | curl `/api` |
| OB-6 | Uptime/health monitoring | ⚠️ PARTIAL | heartbeat exists; no external monitor; keepalive is dev-only | `/api`, `keepalive.mjs` | LOW | infra review |

## 10. Testing & CI/CD

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| TC-1 | Automated test suite | ❌ BLOCKER | zero test files, zero runners | — | BLOCKER | `find . -name "*.test.*"` → none |
| TC-2 | CI pipeline | ❌ BLOCKER | no `.github/`, no workflows, no hooks | — | BLOCKER | `ls .github` → none |
| TC-3 | Lint/typecheck gates | ❌ FAIL | scripts exist (`lint`, tsc via editor) but nothing enforces them; build suppresses TS errors | `package.json`, `next.config.ts` | HIGH | config read |
| TC-4 | E2E smoke of critical flows | ❌ FAIL | manual QA screenshots only | `qa-shots/**` | HIGH | inventory |
| TC-5 | Route-guard regression sweep | ❌ FAIL | the Phase-0 grep sweep is currently the only guard inventory | `docs/PRODUCTION_READINESS_BASELINE.md` §A.6 | HIGH | re-run grep sweep after any new route |

## 11. Performance

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| PF-1 | Static asset weight sane | ❌ FAIL | `public/tesseract` 19MB in the static bundle | `public/tesseract/**` | MEDIUM | `du -sh public/*` |
| PF-2 | Client bundle segmented | ⚠️ PARTIAL | panels/modules lazy-loaded via `dynamic()`; but all 619 components behind one route; heavy libs client-side | `src/app/page.tsx`, panels | MEDIUM | bundle analysis (later phase) |
| PF-3 | Client data layer scalable | ❌ FAIL | 24 localStorage-persisted stores incl. 4918-line fee engine; quota/parse costs grow with data | `src/lib/store/**`, `src/lib/tenant/tenant-storage.ts` | HIGH | store inventory |
| PF-4 | Realtime strategy scalable | ⚠️ PARTIAL | 4s polling of SQLite, bounded takes; fine for 1 school demo | `mini-services/event-stream/index.ts` | MEDIUM | code read |
| PF-5 | DB growth headroom | ⚠️ PARTIAL | SQLite 3.7MB at 152 students/4268 attendance; BLOB columns (photoDataUrl) risk row bloat | `prisma/schema.prisma` | HIGH | DB size vs row counts |
| PF-6 | Caching strategy | ❌ FAIL | all APIs dynamic; no cache layer | routes | LOW | route flag scan |

## 12. UI / UX

| ID | Item | Status | Evidence | Affected files | Severity | Verification method |
|----|------|--------|----------|----------------|----------|---------------------|
| UX-1 | Design system consistent | ✅ PASS | shadcn-style kit, theme tokens, dark mode | `src/components/ui/**`, `tailwind.config.ts`, `globals.css` | — | browser review (Phase 0 preview verified) |
| UX-2 | Route-able URLs per module | ⚠️ PARTIAL | single `/` route + hash hints (`#portal`, `#platform`) | `src/app/page.tsx` | MEDIUM | URL inspection |
| UX-3 | Demo affordances removable | ❌ FAIL | credential chips, "Demo platform" copy, mock toppers hardcoded | `src/components/login/login-page/**`, mock modules | HIGH | login screen render |
| UX-4 | Public marketing site decoupled | ⚠️ PARTIAL | 1096-line public website bundled in app route with mock stats | `src/components/public-website/public-website.tsx` | LOW | code read |
| UX-5 | Accessibility audited | ❌ FAIL | not audited; no evidence either way | — | MEDIUM | a11y audit (later phase) |

---

## Frozen-state validation record (Phase 0)

Executed on the imported tree before committing documentation (see Baseline §M.2 for the narrative):

```
bunx tsc --noEmit        → 0 errors, exit 0
bunx eslint .            → 0 errors/warnings, exit 0
bun run db:generate      → success (client regenerated, 68 models)
bun run build            → success (standalone output + asset copy)
bun run dev              → Ready on :3000; GET / → 200; GET /api → 200 v2.14.0
login smoke (4 roles)    → POST /api/auth/login 200 for all demo accounts
route auth sweep         → 188 routes; 12 unauthenticated (6 legit + webhook + 4 upload routes + admissions/public)
```

> **Phase 0 commit contains documentation only** (`docs/PRODUCTION_READINESS_BASELINE.md`, `docs/PRODUCTION_READINESS_CHECKLIST.md`, `worklog.md` session entry). No source, config, schema, or data changes. No Supabase, no Vercel, no Resend, no fixes applied — per the freeze instructions.
