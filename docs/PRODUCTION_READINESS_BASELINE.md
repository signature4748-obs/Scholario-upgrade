# Scholario-OS — Production Readiness Baseline (Phase 0: Architecture + Repository Freeze)

> **Phase**: 0 — Inspection & baseline documentation. No functional changes were made in this phase.
> **Method**: Full-repository inspection of actual code (verified against implementation, not comments/docs).
> **Source**: `https://github.com/signature4748-obs/Scholario-OS` @ `125763b` (branch `main`).
> **Date of inspection**: this baseline was produced immediately after import; see `worklog.md` for the session record.
> **Scope rule**: this document invents **no speculative architecture**. Everything below cites real files in the frozen tree. Nothing was migrated, connected, or deleted in this phase.

---

## A. CURRENT ARCHITECTURE

### A.1 Runtime architecture (verified)

- **Framework**: Next.js `16.1.1` (App Router) + React `19`, TypeScript 5, Tailwind CSS 4, shadcn-style UI kit (`src/components/ui`, 62 components), Lucide icons, Framer Motion, Recharts.
- **Single-route SPA**: the only user route is `/` (`src/app/page.tsx`, 153 lines) — a client-side "god-entry" that dynamically imports:
  - `PublicWebsite`, `LoginPage`, `PlatformLanding` (unauthenticated states)
  - `PrincipalPanel`, `TeacherPanel`, `StudentPanel`, `SuperAdminPanel` (authenticated states)
  - All panels live under `src/components/{principal,teacher,student,superadmin,shell,shared}` — **619 `.tsx` components total**, ~233k lines of TS/TSX in `src/`.
- **State management**: **no server-state library** (no TanStack Query). 36 Zustand stores under `src/lib/store/*`, of which **24 are `persist(...)`-backed by `localStorage`** and tenant-namespaced (`src/lib/tenant/tenant-storage.ts`).
- **Dev runtime**: `next dev --webpack -p 3000` with `NODE_OPTIONS=--max-old-space-size=1800`, a **custom webpack `lazyCompilation` backend** (`src/lazy-compilation/`, SSE on fixed port 3777) and watcher rules that ignore `**/db/**` (`next.config.ts`). This exists solely to survive the 4GB sandbox cgroup; it is dev-only code wired into the production config file.
- **Realtime**: a separate mini-service `mini-services/event-stream` (Bun + socket.io on fixed port **3003**) that polls the shared SQLite file every 4s with `bun:sqlite` (readonly) and broadcasts `school-event` frames; the frontend connects via `io("/?XTransformPort=3003")` through the gateway.
- **Gateway**: committed `Caddyfile` (port :81) reverse-proxies to :3000, honors `XTransformPort` query routing, and serves a branded "Scholario is restarting" error page.
- **Dev-only infrastructure committed to the repo**: `keepalive.mjs` (watchdog that kills/respawns the dev tree; hardcoded `ROOT = '/home/z/my-project'`; listed in `.gitignore` but force-tracked), `warm-chunks.mjs` (pre-compiles all chunks via HTTP walk), `spawn-detached.mjs` (detached process launcher), `examples/websocket` (demo), `mini-services/event-stream`.
- **Build target**: `output: "standalone"`; `build` script copies `static/` and `public/` into `.next/standalone`; `start` runs `bun .next/standalone/server.js`.
- **Sandbox-coupled SDK**: `z-ai-web-dev-sdk` is a runtime dependency used server-side by `/api/ai/generate-questions`.

### A.2 Database architecture (verified)

- **Provider**: SQLite via Prisma `6.x`, single file `db/custom.db` (3.7 MB) — **the file is committed to git** (see D).
- **Connection string**: `DATABASE_URL=file:/home/z/my-project/db/custom.db` — an **absolute, machine-specific path committed in `.env`** (the `.env` file itself is committed despite `.env*` being in `.gitignore`).
- **Schema**: `prisma/schema.prisma` — **2073 lines, 68 models, 0 enums**. Roles/statuses/plans are free-form strings (`User.role` default `"STUDENT"`; `School.plan`/`status` strings; exam/fee workflow states as strings).
- **Migrations**: **there is no `prisma/migrations/` directory.** Schema evolution is done via `prisma db push --accept-data-loss` (`db:push` script) plus **hand-written data-repair scripts** in `prisma/` (`backfill-payments.ts`, `migrate-iq3000.ts`, `repair-room-integrity.ts`, `spread-payments.ts`, `scripts/growth-migrate.ts`) and 7 domain seed scripts (`seed.ts`, `seed-roster-150.ts`, `seed-study-materials.ts`, `seed-learning.ts`, `seed-student-dashboard.ts`, `seed-teacher-hub.ts`, `seed-teacher-academics.ts`, `seed-exam-ops.ts`).
- **Second DB client**: `mini-services/event-stream/index.ts` opens `db/custom.db` **directly** with `bun:sqlite` (readonly), bypassing Prisma entirely.
- **Uploads on local disk**: `db/uploads/{admissions,teachers,study-materials}` written by API routes via `fs/promises` (gitignored at runtime).
- **Data snapshot inside the committed DB** (queried via Prisma during this phase): 1 School (`Greenwood Public School`, code `DEMO`, `isDemo: true`), 350 Users (2 `SUPER_ADMIN` with `schoolId: null`; 2 `PRINCIPAL`; 1 `MANAGEMENT`; 4 `TEACHER`; 1 `DRIVER`; 152 `PARENT`; 153 `STUDENT`), **519 Session rows (with IP + user-agent PII)**, 152 Students, 4 Teachers, 21 Classes, 12 Subjects, 96 ClassSubjectAssignments, 21 Rooms, 686 ExamMarks, 4268 Attendance rows, 154 Fees, 131 Payments, 52 Messages, 10 StudyMaterials, 62 ActivityLogs, 42 GrowthEvents, 1 WebhookEvent.

### A.3 Authentication architecture (verified)

- **Custom credential sessions** (no NextAuth): `src/lib/auth.ts` — scrypt password hashing (`salt:hash`, 64-byte, `timingSafeEqual`), 32-byte hex session tokens, `Session` table with 7-day TTL, lazy expiry cleanup, device metadata (`userAgent`, `ipAddress`) and a devices management UI (`/api/auth/sessions`).
- **Transport**: cookie `erp_session` — `httpOnly: true`, `sameSite: 'lax'`, `path: '/'` — **no `secure` flag**.
- **Bearer fallback (dev workaround baked into the product)**: because the sandbox preview renders the app in a cross-site iframe, `POST /api/auth/login` **returns the raw session token in the response body**; `src/lib/auth-session-token.ts` persists it in `localStorage` (`scholario-session-token`) and a fetch interceptor attaches `Authorization: Bearer …` to every `/api/*` call. Server-side `getSessionToken()` accepts cookie or Bearer.
- **Login hardening absent**: no rate limiting, no account lockout, no captcha, no MFA anywhere (including `SUPER_ADMIN`). `POST /api/auth/change-password` exists.
- **Demo quick-access**: `src/components/login/login-page/data.tsx` commits plaintext credentials + one-click role chips for all four roles (see F/L).

### A.4 Authorization architecture (verified)

- **Route guards**: `src/lib/api.ts` `withUser(handler, { roles })` + `requireRole`; role values compared as strings (`SUPER_ADMIN`, `PRINCIPAL`, `MANAGEMENT`, `TEACHER`, `STUDENT`, `PARENT`, `DRIVER`).
- **School scope**: `schoolScoped(user)` returns `user.schoolId` and **throws for `SUPER_ADMIN`** — a deliberate platform/school split.
- **Teacher scope (canonical)**: `src/lib/teacher-scope.ts` — effective permissions derive from `ClassSubjectAssignment` rows (`teacherUserId`) UNION `Class.classTeacherId`, **plus a legacy fallback that name-matches timetable rows case-insensitively by `teacherName`** (kept for transition; a name collision would grant scope).
- **Capability layer**: `src/lib/permissions.ts` + `src/lib/tenant/*` — a *client-side* capability matrix (fee capabilities; `fee_structure_delete` platform-reserved). Guards run in UI + Zustand store actions, **not on the server** for the flows they gate (see C).
- **Student scope**: `/api/student/*` routes derive `ctx.studentId` server-side from the session (verified in `student/flashcards`, `student/dashboard`).

### A.5 Tenant-isolation strategy (verified)

- **Server (real)**: every domain model carries `schoolId`; API routes filter by the session's `schoolId` via `schoolScoped()`. This is the only enforced isolation boundary and it is consistently applied across the 176+ authenticated routes sampled.
- **Client (mock)**: `src/lib/tenant/schools.ts` registers exactly **one hardcoded tenant** (`t-dsg-gur-01` / Greenwood) with fabricated stats (1842 students vs 152 real); `tenant-storage.ts` namespaces every persisted store per tenant id in `localStorage`.
- **Realtime (NOT isolated)**: `mini-services/event-stream` broadcasts events for **all schools to every connected socket** (`cors: { origin: '*' }`); the comment states "clients filter by their own schoolId on the frontend, keeping the service auth-agnostic." Server-side tenant isolation does **not** exist for the realtime channel.
- **Super Admin (cross-tenant by design)**: `/api/superadmin/activity` merges ActivityLog/Payment/Session across all schools; `/api/dashboard` returns platform-wide counts for `SUPER_ADMIN`.

### A.6 API architecture (verified)

- **188 `route.ts` handlers** under `src/app/api/**`. Distribution: teacher 38, exams 35, student 21, homework 18, fees 16, auth 6, study-materials 4, teachers 3, students 3, schools 3, profile 3, classes 3, announcements 3, admissions 3, timetable 2, superadmin 2, rooms 2, attendance 2, plus singletons (webhooks/razorpay, transport, subjects, search, results, questions, public/rss, principal/academic, payments-export, notifications(-feed), messages, library, export, events, dashboard, contacts, assignments, app-version, ai, `/api`).
- **Envelope**: `api()` wrapper returns `{ ok: true, data }` or `{ ok: false, error }`; raw `Response` passthrough for file streams. Error→status mapping: `UNAUTHORIZED`→401, `FORBIDDEN`→403, `NOT_FOUND`→404, **everything else→400** (5xx never used; internal `Error.message` strings are surfaced to clients).
- **Unauthenticated endpoints** (verified by grep of every route file for `withUser|getCurrentUser`): `/api`, `/api/app-version`, `/api/auth/login`, `/api/auth/logout`, `/api/schools/public`, `/api/public/notices/rss`, `/api/admissions/public`, `/api/admissions/upload` (+`/[id]`), `/api/teachers/upload` (+`/[fileId]` GET **and DELETE**), `/api/webhooks/razorpay` (HMAC-verified, 503 when secret unset).
- **Health probe**: `GET /api` returns `{ app: "SCHOLARIO-OS", status: "ok", version: "2.14.0" }` (`src/lib/app-version.ts`).
- No OpenAPI/schema validation, no request-level size guards outside upload routes, no middleware (no `src/middleware.ts`).

### A.7 UI/module architecture (verified)

- Role panels: `principal` 325 components (4.8MB), `teacher` 94 (1.6MB), `student` 82 (1.1MB), `superadmin` 8, `shared` 40, `shell` 4, `login` 3, `public-website` 1 (1096 lines).
- Shared shell (`AppShell`) + module registry per role; modules lazy-loaded per tab. Principal fee module alone: `fees-structures-detail.tsx` 2644 lines.
- Client-side OCR (Marks Scan) via `tesseract.js`; its runtime assets are committed under `public/tesseract` (**19MB** — the bulk of `public/`).
- Document generation: `docx` + `jspdf`/`jspdf-autotable` for receipts/report cards/export.

### A.8 Mock/seed data architecture (verified)

- **Two parallel data universes**:
  1. **Real**: Prisma/SQLite + 188 API routes (auth, exams, marks, attendance, homework, messages, notifications, study materials, growth, rooms, timetable…).
  2. **Mock**: `src/lib/mock/*` (11 modules) + 36 Zustand stores consumed by **99 files** (52 principal components, 14 student components, login, shell, shared) — fees, salary/payroll, applications/admissions, inventory, library, transport, certificates, finance dashboards, bus tracking, school calendar.
- The fee business engine (structures, versions, transactions, settlements, audit log, capability guards) lives **client-side** in `src/lib/store/fee-store.ts` (**4918 lines**) with `localStorage` persistence — while a *separate* server fee surface exists (`/api/fees/*`, 16 routes). This is the single largest duplication of business logic (see C, M).
- `platform-subscription.ts` is a fully client-side "licensing engine" with a hardcoded UPI id (`scholario.platform@icici`), in-memory records and fabricated transaction refs.
- `auth-store.ts` still carries hardcoded mock identity profiles (`EMP-001`, `STU-58`, `T-014`) merged over server-authenticated identities.
- Students roster is synced DB→store once per session (`syncStudentsFromServer`) for principal/student roles only.

### A.9 Production/dev-only code split (verified)

- Dev-only but committed: `keepalive.mjs`, `warm-chunks.mjs`, `spawn-detached.mjs`, `Caddyfile`, `mini-services/*`, `examples/*`, custom `lazy-compilation` backend (referenced from `next.config.ts`), sandbox hostnames in `allowedDevOrigins` (`*.space-z.ai`, `*.chatglm.cn`, `*.z.ai`), absolute `ROOT='/home/z/my-project'` paths, `dev.log`/`server.log` tee pipelines in npm scripts.
- Production-gated (env detection, currently inert): Razorpay provider + webhook secret, `PAYMENTS_SANDBOX` mode.
- Dev bypasses in the product: demo credential cards on the login screen (no feature flag); session-token-in-response-body always enabled (not gated by `NODE_ENV`).

### A.10 Super Admin implementation (verified)

- **Accounts**: 2 real `SUPER_ADMIN` rows (`admin@erpsuite.io` from `prisma/seed.ts` with `hashPassword('admin123')`, and `admin@scholario.cloud` used by the login quick-access card), both `schoolId: null`.
- **Server surfaces (real data)**: `/api/superadmin/activity` (merged ActivityLog+Payment+Session feed, last 30, provenance labels, no tokens/IPs leaked), `/api/superadmin/settings` (single global `PlatformSetting.showDemoSchool` toggle, `SUPER_ADMIN`-gated POST), platform-wide branch of `/api/dashboard`.
- **Client surfaces (mock data)**: `superadmin-panel.tsx` + `modules/` (overview, schools, school-control, platform-controls, activity-feed, tenant-badges — 1397 lines). The Schools "Control Center" reads the **client tenant store**, not the DB; Platform Controls shows adapter seams (mock email outbox in `localStorage`) and a "Supabase Engine" marketing block on `platform-landing.tsx`.
- **Gaps**: no MFA, no per-superadmin audit trail (ActivityLog rows are school-scoped; platform actions like `showDemoSchool` changes are not logged), no school provisioning API (schools cannot be created/managed server-side), no billing.

### A.11 Email / payment / file-upload infrastructure (verified)

- **Email: none.** The only "email" is the mock `EmailAdapter` (`src/lib/platform/adapters.ts`) writing to a `localStorage` outbox for the Super Admin screen. No Resend/SMTP dependency exists anywhere (grep verified). In-app `Notification` model + announcement reads exist server-side.
- **Payments**: dual implementation —
  1. `src/lib/payments/provider.ts`: real `RazorpayProvider` (plain `fetch` to `api.razorpay.com`, env-gated `RAZORPAY_KEY_ID/SECRET`, never returns secrets) + `SandboxProvider` (`PAYMENTS_SANDBOX=1` + `PAYMENTS_SANDBOX_SECRET`); checkout success only flips `FeeTransaction→SUCCESS` after server-side HMAC verification (`/api/student/payments/verify`).
  2. **Legacy stub**: `/api/fees/orders` mints fake gateway order ids locally (`order_<random>`) with a code comment admitting the gateway call is stubbed — a second, divergent order path.
  3. `/api/webhooks/razorpay`: real HMAC-SHA256 signature verification with `timingSafeEqual`, DB-persisted idempotency (`WebhookEvent` unique eventId), auto-reconciliation of FeeTransaction/Settlement; returns 503 when `RAZORPAY_WEBHOOK_SECRET` is unset (correct fail-closed).
- **File uploads**: three local-disk routes (`admissions/upload` 5MB PDF/JPG/PNG with magic-byte sniffing; `teachers/upload` photo/signature with dimension validation; `study-materials` with safe file names) — all stored under `db/uploads/**` (ephemeral local disk, no object storage). Download routes validate opaque ids against strict regex (no path traversal) but `teachers/upload/[fileId]` GET/DELETE are **anonymous**.

### A.12 Observability (verified)

- `ActivityLog` (school-scoped action journal, 62 rows) surfaced through the Super Admin activity feed; `Session` sign-in events with device labels.
- `GET /api` version/heartbeat; Caddy branded error page with self-healing polling; in-app Asset Guard (`src/components/shared/asset-guard`) with JS-boot probe + watchdog script.
- **Absent**: structured logging, request IDs, metrics/APM, error tracking (no Sentry), alerting, uptime monitoring, audit logging for platform-level actions, dependency/CV scanning. `console.*` is permitted globally (`no-console: off` in ESLint). Logs go to `dev.log`/`server.log` via `tee`.

### A.13 Testing (verified)

- **Zero automated tests.** No test framework in `devDependencies`, no test scripts in `package.json`, no `tests/`/`__tests__/` directories (tsconfig excludes `tests` but none exists). QA artifacts are 156 committed screenshots under `qa-shots/` (17MB) referenced from `worklog.md`.

### A.14 CI/CD (verified)

- **None.** No `.github/` directory, no workflows, no pre-commit hooks, no lint/typecheck gates anywhere. The only "pipeline" is the sandbox-internal `.zscripts/*.sh` (not part of the repo import) and `start.sh` deployment notes inside the worklog for a packaged standalone build that bundles a copy of `db/custom.db` at `/app/db/custom.db`.

### A.15 Security controls (verified)

- **Present (good)**: scrypt + `timingSafeEqual` password verify; 32-byte random session tokens; HttpOnly cookie; session expiry + per-device revocation; webhook HMAC verification with DB idempotency; upload magic-byte validation + size limits + opaque ids + traversal-safe download ids; payment success requires server-side signature; no secret material committed (grep for key patterns returned nothing).
- **Absent / weak**: no `secure` cookie flag; session token duplicated into response body + `localStorage` (XSS ⇒ full account takeover, 7-day window); anonymous upload + anonymous media DELETE; no CSRF tokens (cookie flows rely only on `SameSite=Lax`); no rate limiting / lockout / MFA; `cors: '*'` + unauthenticated cross-tenant socket broadcast; raw `Error.message` surfaced to clients with 400-for-everything mapping (no 5xx semantics, info disclosure); no security headers/CSP; committed runtime DB containing session PII (IP/UA) and hashed demo passwords; demo credentials committed in source.

### A.16 Performance architecture (verified)

- Dev-mode memory engineering for a 4GB cgroup (lazyCompilation, watcher ignores, 1.8GB heap cap, warm-chunks walk, keepalive respawn) — all dev-only.
- `optimizePackageImports` for lucide/recharts/framer-motion/date-fns; `sharp` installed; `output: "standalone"`; panels + modules `dynamic()`-loaded.
- **Concerns**: 19MB `public/tesseract`; 4268 attendance rows / 686 exam marks / 152 students already in a 3.7MB SQLite (data growth in SQLite + localStorage-persisted stores will degrade both server and client); 4-second polling realtime; 233k LOC single-page bundle territory; `recharts` + `framer-motion` + `docx` + `jspdf` all client-weight; `fee-store.ts` (4918 lines) and multiple 1–2k-line components render inside one route.
- No HTTP caching layer (routes are `force-dynamic` / node runtime), no CDN usage, no pagination strategy audits.

### A.17 Technical debt inventory (verified, quantified)

1. **Dual data universes** — 99 files import `@/lib/mock`; 24 localStorage-persisted stores mirror/duplicate server entities (fees, salary, applications, library, transport, inventory, certificates…).
2. **Duplicated business logic** — fee workflow exists as client `fee-store.ts` (4918 lines, with its own audit log + permission guards) *and* server `/api/fees/*` (16 routes); payment order creation exists twice (`fees/orders` stub vs `payments/provider.ts`); homework policy both client and server.
3. **Legacy authorization fallback** — timetable `teacherName` case-insensitive match grants teacher scope (IQ3000 transition leftover).
4. **`typescript: { ignoreBuildErrors: true }`** in `next.config.ts` (currently 0 errors, but the safety net is off).
5. **ESLint**: ~30 rules disabled (`no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-console`, …).
6. **`tsconfig`**: `strict: true` but `noImplicitAny: false`, `allowJs: true`.
7. **`any` usage**: permitted by config; no grep ban.
8. **Hardcoded school/tenant/identity data** — 57 references to "greenwood/Greenwood" across 14 files; tenant registry with fabricated stats; `auth-store` mock profiles; login quick-access data.
9. **Dev infra committed + force-tracked against `.gitignore`** — `.env`, `db/custom.db`, `keepalive.mjs`.
10. **Repo hygiene** — 156 QA screenshots (17MB) and a 19MB tesseract runtime committed; git history carries DB blobs (54MB working tree).
11. **No README, no `docs/`** — the 2873-line `worklog.md` at root is the only architecture narrative.
12. **Sandbox coupling** — `z-ai-web-dev-sdk` (AI route), `allowedDevOrigins` sandbox hostnames, absolute `/home/z/my-project` paths, gateway query-param routing in client socket code.
13. **Free-string enums** — 68 models with 0 Prisma enums; role/plan/status vocabularies enforced only by convention.
14. **No migrations** — `db push --accept-data-loss` workflow; hand-rolled repair scripts as pseudo-migrations.

### A.18 Production blockers (summary — detailed in M)

Committed runtime DB with PII; SQLite + absolute-path committed `.env`; anonymous uploads/DELETE; auth transport hardening (secure cookie, token-in-body removal, CSRF, rate limit, MFA); realtime cross-tenant broadcast; mock-store business flows (fees/salary/applications); demo credentials in bundle; `ignoreBuildErrors`; zero tests/CI; no email provider; sandbox SDK in the AI path; ephemeral local-disk uploads; error-envelope information leakage.

---

## B. SECURITY FINDINGS

| # | Finding | Evidence | Severity |
|---|---|---|---|
| B-1 | `.env` committed to git (DATABASE_URL, absolute machine path) | `.env` tracked (`git ls-files -i -c`), content `file:/home/z/my-project/db/custom.db` | High |
| B-2 | Runtime SQLite DB committed with 519 session rows incl. IP + user-agent PII | `db/custom.db` tracked (3.7MB); queried during this phase | High |
| B-3 | Session cookie lacks `secure` flag | `src/lib/auth.ts` `setSessionCookie` | High |
| B-4 | Raw session token returned in login response and persisted in `localStorage`; fetch interceptor attaches Bearer everywhere | `src/app/api/auth/login/route.ts`, `src/lib/auth-session-token.ts` | High |
| B-5 | Anonymous file upload endpoints (admissions + teachers) — unauthenticated writes to server disk | `src/app/api/admissions/upload/route.ts`, `src/app/api/teachers/upload/route.ts` (no `withUser`) | High |
| B-6 | Anonymous GET **and DELETE** of teacher media by opaque id | `src/app/api/teachers/upload/[fileId]/route.ts` | High |
| B-7 | No rate limiting / lockout / captcha on login or any route | `src/app/api/auth/login/route.ts`; no middleware | Medium |
| B-8 | No CSRF protection (cookie sessions + state-changing POSTs; Bearer path exempt) | repo-wide grep for csrf: none | Medium |
| B-9 | socket.io service: `cors: { origin: '*' }`, unauthenticated, cross-tenant broadcast | `mini-services/event-stream/index.ts` | Medium |
| B-10 | API error envelope leaks internal `Error.message` with blanket 400 status (no 5xx) | `src/lib/api.ts` | Medium |
| B-11 | Demo plaintext credentials + one-click role login committed (incl. super admin) | `src/components/login/login-page/data.tsx`, `prisma/seed.ts`, `worklog.md` | High |
| B-12 | No MFA for SUPER_ADMIN; no platform-action audit trail | `src/app/api/superadmin/settings/route.ts` (POST not logged) | Medium |
| B-13 | Teacher-scope legacy fallback authorizes by case-insensitive teacher **name** match | `src/lib/teacher-scope.ts` (timetable fallback) | Low/Medium |
| B-14 | No security headers/CSP beyond Next defaults; `images.remotePatterns` broad but bounded | `next.config.ts` | Low |
| B-15 | No dependency vulnerability scanning anywhere | no CI, no audit script | Medium |
| B-16 | `qa-shots/` (17MB) + worklog reveal internal architecture & demo data in a public repo | `qa-shots/**`, `worklog.md` | Low |

**Positive controls verified**: scrypt hashing with salt + `timingSafeEqual`; 32-byte random tokens; timing-safe HMAC webhook verification with fail-closed 503; magic-byte upload sniffing; traversal-safe file id validation; payment success gated on server-side signature; no secret key material found in tree.

---

## C. TENANCY FINDINGS

- C-1 **Enforced server-side**: `schoolId` on all 68 models; `schoolScoped()` in route guards; `onDelete: Cascade` from School. Verified across teacher/exams/fees/student routes.
- C-2 **Realtime is not tenant-isolated**: event-stream broadcasts all schools' rows to every socket; filtering happens client-side only (explicit comment in `mini-services/event-stream/index.ts`).
- C-3 **Client "tenancy" is a mock registry** with exactly one tenant and fabricated stats (`src/lib/tenant/schools.ts`); store namespaces keyed by tenant id in `localStorage` (`tenant-storage.ts`) — a second, parallel tenancy system.
- C-4 **Super Admin crosses tenants by design** (activity feed, platform dashboard) — correct for a platform role, but platform-side mutation tooling is limited to one global boolean (`showDemoSchool`).
- C-5 **No tenant provisioning**: there is no API to create/suspend a school (only seed scripts); `PlatformSetting.showDemoSchool` merely filters demo rows from platform views.
- C-6 **Hardcoded school assumptions**: Greenwood identity/emails/stats duplicated across tenant registry, auth-store profiles, login page, mock school.ts, platform-subscription (57 references, 14 files) — a second school cannot be onboarded without code edits.

---

## D. DATABASE FINDINGS

- D-1 SQLite local-file database committed to the repository (`db/custom.db`, 3.7MB, force-tracked despite `db/*.db` ignore rule).
- D-2 Committed DB contains real user/session/PII rows (519 sessions with IP/UA; 350 users; student records) — privacy + "prod data in git" hazard; history carries multiple DB blobs.
- D-3 No `prisma/migrations/`; all schema evolution via `prisma db push --accept-data-loss` (`db:push` script; also auto-run by the sandbox `.zscripts/dev.sh` on every dev start) — destructive by default.
- D-4 `.env` uses an absolute path `file:/home/z/my-project/db/custom.db` — non-portable, machine-coupled.
- D-5 Data-repair-as-migration scripts (`prisma/backfill-payments.ts`, `migrate-iq3000.ts`, `repair-room-integrity.ts`, `spread-payments.ts`, `scripts/growth-migrate.ts`) — unversioned, non-idempotent-by-contract ad-hoc migrations.
- D-6 Second direct SQLite consumer (`bun:sqlite` in event-stream) reads the same file the Prisma server writes — coupling the mini-service to Prisma's on-disk epoch-millis convention.
- D-7 SQLite limitations for the target SaaS model: no row-level tenancy, no concurrent-writer story for multiple app instances, no managed backup/PITR, 3.7MB at 152 students/4268 attendance rows (linear growth risk with photoDataUrl-style BLOB columns).
- D-8 No DB-level enums/constraints for role/plan/status vocabularies (string columns, 0 enums in schema).
- D-9 Upload bytes live on local disk `db/uploads/**` (same volume as the DB and the Next build — ephemeral, unbacked-up, no retention/purge job; `archiveRetentionDays` exists only as a client-side config value with the purge documented as a "FUTURE SERVER JOB").

---

## E. AUTH FINDINGS

- E-1 Solid primitives (scrypt, timing-safe, random 32-byte tokens, 7-day TTL, device management, change-password) — custom, auditable, working.
- E-2 Cookie not `secure`; works over the sandbox's http preview but must be flagged before HTTPS production.
- E-3 Dual transport (cookie + Bearer-from-localStorage) is a permanent XSS-amplifier; the iframe workaround is not gated by `NODE_ENV`/feature flag.
- E-4 No rate limiting/lockout → credential stuffing and session-token brute force are unthrottled (tokens are 64-hex — strong — but verification is unthrottled).
- E-5 No MFA for any role; SUPER_ADMIN is the highest-value account (cross-school data).
- E-6 Demo credential cards render in the production bundle with no gating (login `data.tsx`).
- E-7 Session rows are never bulk-expired (lazy delete on access); 519 rows committed shows accumulation.
- E-8 `logout` endpoint unauthenticated (acceptable; token delete is idempotent) — listed for completeness.
- E-9 Role vocabulary is string-based and duplicated between client (`'principal'|'teacher'|'student'|'superadmin'` lowercase in `auth-store`) and server (`'PRINCIPAL'|…` uppercase in DB/routes) — mapping is ad hoc in the login flow.

---

## F. API FINDINGS

- F-1 188 handlers, consistent `withUser`/`schoolScoped` discipline on 176 of them (verified via grep sweep; the 12 exceptions are enumerated in A.6 — login/logout/health/version/public-site/rss/webhook are legitimately public; **admissions + teachers upload are not**).
- F-2 Uniform JSON envelope, but error semantics collapse to 400 for all non-mapped errors and echo `error.message` — internal messages (including Prisma errors) can reach clients.
- F-3 No input schema validation layer (no zod — removed from dependencies during the earlier import per worklog).
- F-4 Two divergent payment-order paths (`fees/orders` stub vs `payments/provider`) — see A.11.
- F-5 AI route binds the app to `z-ai-web-dev-sdk` (sandbox-only SDK) — a Vercel deployment cannot rely on it.
- F-6 Upload endpoints (once authenticated) still write to local disk — no storage abstraction except Super Admin's mock adapter seams.
- F-7 Webhook design (idempotency + HMAC + fail-closed) is production-grade; the only gap is the unset secret today.
- F-8 No OpenAPI/typed API contract; client types drift manually (`src/lib/api.ts` client wrapper).

---

## G. TESTING FINDINGS

- G-1 **No automated tests of any kind** (unit/integration/e2e) — zero test files, zero runners, zero scripts.
- G-2 QA process = manual browser sessions recorded as 156 committed screenshots (`qa-shots/`, 17MB) + narrative `worklog.md`.
- G-3 Validation available today: `tsc --noEmit` (passes, 0 errors — recorded in M.2), `eslint .` (passes due to disabled rules), `next build`, plus runtime smoke (dev server + `/api` probe). These are the "existing validation scripts" executed for this baseline (exact results in §M.2).
- G-4 Critical flows with zero regression safety: marks entry/lock/verify, attendance workflow, fee reconciliation, payment verify, auth guard coverage.

---

## H. OBSERVABILITY FINDINGS

- H-1 Real activity journal (ActivityLog, 62 rows) + sign-in events + platform activity feed — good domain audit seed, school-scoped only.
- H-2 Platform-level mutations (superadmin settings) are **not** logged.
- H-3 No request-level logging/correlation IDs, no metrics, no APM, no error tracking, no alerting.
- H-4 `console.log`/`console.error` are the only instrumentation (permitted by lint).
- H-5 Operational UX crutches exist (Caddy restart page, in-app Asset Guard, keepalive) — all dev-sandbox-specific.
- H-6 `/api` heartbeat + `app-version.ts` (2.14.0) is a usable deploy marker.

---

## I. PERFORMANCE FINDINGS

- I-1 Bundle weight: single route aggregates 619 components; principal panel alone 4.8MB of source; heavy deps (recharts, framer-motion, docx, jspdf, tesseract.js) all client-side.
- I-2 `public/tesseract` = 19MB static assets shipped to every cold visitor of the public site (loaded by the marks-scan module).
- I-3 localStorage as a database: 24 persisted stores (fee-store seeds, applications, salary…) — multi-MB quota risk and JSON.parse cost on boot.
- I-4 Realtime = 4s polling of the SQLite file with bounded scans — acceptable at 152 students, not a production strategy.
- I-5 SQLite under concurrent writers: Prisma writes + readonly bun:sqlite reader is fine, but multiple app instances would contend on the file lock.
- I-6 Dev-mode memory engineering (lazyCompilation, warm-chunks, 1.8GB cap) is not a production concern but currently lives in `next.config.ts`.
- I-7 No caching layer (all APIs dynamic), no pagination audit on list endpoints (`take` limits vary), 1000-row trend fetch in dashboard.
- I-8 Photo `photoDataUrl` (data-URL BLOB) column on Student — row bloat risk when populated (currently 0 populated).

---

## J. UI/UX FINDINGS

- J-1 Polished, consistent design system (teal/emerald brand, shadcn-style kit, dark mode via next-themes), branded loading skeletons, Asset Guard recovery UX.
- J-2 All-in-one client SPA: no deep links per module (hash-based view switching only `#portal`, `#platform`), no per-role routes — migration to real routes will be a structural change.
- J-3 Demo affordances are user-facing in the production bundle: quick-access credential chips, "Demo platform" copy, mock toppers/analytics with fabricated numbers in principal/student surfaces.
- J-4 Very large single-file components (2644-line fee structures detail, 1234-line marks section) — maintainability more than UX risk; date inputs standardized via shared DatePicker (per worklog).
- J-5 Accessibility/keyboard/ARIA coverage not audited in this phase; not evidenced either way.
- J-6 The public marketing website (`public-website.tsx`, 1096 lines) is bundled inside the app route and serves mock stats.

---

## K. MOCK DATA FINDINGS

- K-1 99 files import from `@/lib/mock` (52 principal components, 14 student, login/shell/shared) — the principal "finance", "library", "transport", "inventory", "certificates", "bus-tracking", "school-calendar" surfaces are mock-fueled.
- K-2 36 Zustand stores / 24 persisted — `fee-store.ts` (4918 lines), `applications-store.ts` (2184), `salary-store.ts` (1455) implement full business workflows client-side including audit logs and "permission guards".
- K-3 Fabricated analytics committed as mock exports (`examAnalytics`, `classToppers`, finance dashboards, bus tracking) with explicit "derived from existing ratios" comments.
- K-4 Hardcoded tenant identity + stats (1842 students / 96 teachers) vs real DB (152 / 4) — the Schools screen and tenant badges display fiction.
- K-5 Mock identity profiles in `auth-store.ts` (EMP-001, STU-58, T-014) still back the shell for edge cases.
- K-6 `platform-subscription.ts` — fake licensing engine with hardcoded UPI + fabricated transaction ref (`UPI/504912903481/OKICICI`).
- K-7 Mock email adapter with localStorage outbox presented on the Super Admin "Platform Controls" screen.
- K-8 Seeds define the canonical demo world (Greenwood + legacy Demo School users now re-pointed to Greenwood; `admin@erpsuite.io`/`admin123` super admin; `password123` for the demo school family) — credentials live in `prisma/seed.ts`, `worklog.md`, and the login UI simultaneously.

---

## L. SUPER ADMIN FINDINGS

- L-1 Real server-authenticated role with cross-school read surfaces (activity feed, platform dashboard, settings toggle) — honest provenance, no token/IP leakage in payloads.
- L-2 The Schools/Control Center UI is driven by the **client mock tenant registry**, not the DB — a super admin cannot actually provision, suspend, or configure a real school server-side.
- L-3 Only one platform setting exists (`showDemoSchool`); no plan/billing/capability server enforcement (the capability matrix is client-side only).
- L-4 No MFA, no platform-action audit trail, no IP allowlist, no session policy difference for SUPER_ADMIN.
- L-5 Two super-admin accounts exist in the committed DB (one from seed with a known password) — credential hygiene depends on operators changing seed passwords.
- L-6 `platform-landing.tsx` markets "Supabase Engine" — aspirational copy, not an integration (consistent with the Phase-0 "do not migrate yet" freeze rule).

---

## M. PRODUCTION BLOCKERS

### M.1 Blockers (must-fix before any production traffic)

1. **Committed runtime database with PII + committed `.env`** — remove from git + history, rotate everything inside (all demo passwords are public knowledge). *(B-1, B-2, B-11, D-1, D-2, D-4)*
2. **SQLite as the system of record with no migrations and a destructive push workflow** — replace per the planned Supabase phase; until then, no production deployment. *(D-3, D-7)*
3. **Anonymous upload endpoints + anonymous media DELETE** — authenticate and scope before launch. *(B-5, B-6)*
4. **Auth transport hardening** — `secure` cookie, remove/gate the token-in-body + localStorage bearer path for production, CSRF strategy for cookie flows, rate limiting/lockout on login, MFA for SUPER_ADMIN. *(B-3, B-4, B-7, B-8, E-2, E-3, L-4)*
5. **Realtime cross-tenant broadcast + `cors: '*'`** — enforce server-side tenant filtering and authenticated socket upgrade. *(B-9, C-2)*
6. **Business-critical flows on client mock stores** — fees/salary/applications must be server-authoritative before real money/PII flows. *(K-1, K-2, C-3)*
7. **Demo credentials + one-click role login in the production bundle** — feature-flag or remove. *(B-11, E-6)*
8. **No tests, no CI** — at minimum, gate `tsc` + `eslint` + build + auth-guard sweep in CI before launch. *(G-1, A.14)*
9. **`ignoreBuildErrors: true`** — remove once typecheck is clean (it currently is — 0 errors — so the flag can go first). *(A.17-4)*
10. **Error envelope leaks internal messages** — sanitize + proper 5xx semantics. *(B-10, F-2)*
11. **AI route depends on sandbox SDK** — abstract or remove for Vercel. *(F-5)*
12. **Uploads on ephemeral local disk** — object storage needed before real documents flow. *(A.11, D-9)*
13. **Email: no provider at all** — Resend integration is a later phase per instructions (explicitly not connected now); flagged as a launch dependency for admission/communication flows. *(A.11)*
14. **Super Admin cannot actually operate tenants server-side** (mock control plane) — provisioning/suspension APIs needed for a real SaaS posture. *(L-2, L-3, C-5)*

### M.2 Validation results recorded during this phase (exact)

Run after import + dependency install (`bun install` + `prisma generate`), before committing docs:

| Command | Result (exact) |
|---|---|
| `bunx tsc --noEmit` | **0 errors — exit code 0** (no output) |
| `bunx eslint .` | **0 warnings, 0 errors — exit code 0** (no output) |
| `bun run db:generate` (prisma generate) | success — client regenerated for the 68-model schema |
| `bun run build` | **succeeded** — `next build` completed with the standalone output + `static/`/`public/` copy steps; no type errors surfaced (consistent with clean `tsc`; `ignoreBuildErrors` flag remains on) |
| Dev server `bun run dev` | Ready in ~1.3s on :3000; `GET /` → 200; `GET /api` → `{"app":"SCHOLARIO-OS","status":"ok","version":"2.14.0"}`; `GET /api/schools/public?slug=demo-school` → 200 |
| Login smoke (4 roles) | `POST /api/auth/login` verified 200 for principal/teacher/student/superadmin demo accounts during Phase-0 verification (session tokens minted; cookie + bearer both honored) |
| `bun run lint` (npm script alias) | identical to `eslint .` — exit 0 |

No test suite exists to run (`bun test` is not configured; there are no test files).

### M.3 Recommended execution order (Phase 1+ proposal — not executed in Phase 0)

1. **Repo freeze hygiene** (no behavior change): untrack `.env`/`db/custom.db`/`keepalive.mjs` (history rewrite is a coordinated step — decide before public exposure), add `README.md`, move dev infra into an explicit dev-only path, keep everything working.
2. **Auth hardening** (secure cookie, gate bearer fallback behind `NODE_ENV !== 'production'` or a flag, login rate-limit, sanitize error envelope, CSRF review) — small, surgical, high value.
3. **Upload authentication** + storage seam behind env flag (local disk for dev, object storage later).
4. **Remove `ignoreBuildErrors`** + tighten ESLint gradually (start with `no-explicit-any` and `react-hooks/exhaustive-deps` as warnings).
5. **CI pipeline** (lint + tsc + build + a minimal route-guard regression script) before touching data architecture.
6. **Realtime tenant isolation + authenticated socket handshake.**
7. **Server-authoritative fees/salary/applications migration** (module-by-module removal of the mock universe) — largest workstream.
8. **Supabase migration** (per plan; explicitly deferred by Phase-0 instructions).
9. **Vercel + Resend + Razorpay live keys** (deferred by Phase-0 instructions).
10. **Super Admin real control plane** (provisioning, plans, capability enforcement server-side, platform audit log, MFA).

> **Phase 0 boundary**: none of the above was executed. The only changes committed are this baseline, the readiness checklist, and the session worklog entry.

---

*End of baseline. Companion document: `docs/PRODUCTION_READINESS_CHECKLIST.md` (per-item status, evidence, affected files, severity, verification method).*
