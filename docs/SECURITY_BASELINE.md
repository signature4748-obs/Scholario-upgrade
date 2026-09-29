# Scholario-OS — Security Baseline (Phase 1: Production Security Hardening)

> **Phase**: 1 — Production security hardening for a hostile internet environment.
> **Source of truth**: the Phase-0 baseline (`docs/PRODUCTION_READINESS_BASELINE.md`).
> **Scope rule**: NO Supabase / Vercel / Resend migration, NO mock-data removal. All controls are implemented **centrally** (one module per concern), not as scattered route patches.
> **Verification**: `bunx tsc --noEmit` (0 errors) · `bun run lint` (clean) · `bun run build` (succeeded) · `bun run test:security` (85/85 pass) · live API + browser verification (recorded in §11 and `worklog.md`).

---

## 0. Architecture of the security layer

Every control lives in **`src/lib/security/`** and is applied from one integration point per concern:

| Module | Responsibility | Applied from |
|---|---|---|
| `errors.ts` | `AppError` + error classification (Prisma mapping, unsafe-message heuristics, request IDs) | `src/lib/api.ts` envelope (all 188 routes inherit it) |
| `rate-limit.ts` | Central in-memory fixed-window limiter, account+IP aware, progressive backoff | Route entry points (see §2 table) |
| `validation.ts` | zod strategy: `parseJsonBody` (size-capped, strict), shared primitives (ids, enums, numbers, dates, phones, passwords) | Route bodies (see §3) |
| `audit.ts` | Single audit funnel → structured JSON log line + ActivityLog row, detail sanitizer | All sensitive events (see §8) |
| `upload.ts` | Magic-byte sniffing, extension↔MIME allowlists, traversal-proof stored ids, display-filename sanitizer, size ceilings | All upload routes |
| `file-signing.ts` | HMAC-SHA256 short-lived signed file URLs (scope + file + expiry bound, timing-safe) | File GET routes + access-mint endpoints |
| `headers.ts` | CSP / HSTS / XCTO / Referrer-Policy / Permissions-Policy / COOP / frame-ancestors, dev vs prod profiles | `next.config.ts` `headers()` (every route) |

**Development / production isolation** is enforced in code, not configuration: the bearer-token-in-body transport (`isDevSessionBearerEnabled()`) is hard-disabled when `NODE_ENV === 'production'` — no environment variable can re-enable it.

---

## 1. Authentication

| Surface | Control | Evidence |
|---|---|---|
| Login | Strict zod body (unknown fields → 422); per-IP (8/15 min) + per-account (5/15 min) buckets; account lockout 429 with `Retry-After`; generic `Invalid email or password` for wrong password AND inactive accounts (no status disclosure); anti-enumeration timing equalizer (`burnPasswordTiming` scrypt round when the user does not exist); audit rows for success/failure/lockout | `src/app/api/auth/login/route.ts` |
| Session creation | 32-byte random hex token, 7-day TTL, device metadata (UA/IP, bounded) — unchanged solid primitives | `src/lib/auth.ts` `createSession` |
| Session expiration | Lazy expiry check on every access (deleted when past TTL) | `getCurrentUser` / `getCurrentSession` |
| Session rotation | `rotateSession()` mints a fresh token after password change; the pre-rotation token dies immediately; Set-Cookie refreshed; dev-bearer clients receive the replacement only via the dev-gated path | `src/lib/auth.ts` + `change-password` route |
| Session revocation | Per-device revoke (Settings → Devices) + "sign out other sessions" (rate-limited, audited) + revoke-all-others on password change | `src/app/api/auth/sessions/route.ts` |
| Password change | 5/hour per-account throttle; new-password policy ≥8 chars + letter + digit + must differ; strict body; audit (`PASSWORD_CHANGED`, `SESSION_ROTATED`, `PASSWORD_CHANGE_FAILED`) | `change-password` route |
| Account status | Non-ACTIVE accounts are rejected at login AND on every authenticated request (`withUser`) with generic responses | `login`, `src/lib/api.ts` |
| Cookie transport | `HttpOnly; SameSite=Lax; Path=/` always; **`Secure` added when `NODE_ENV=production`** (HTTP dev preview stays functional) | `sessionCookieOptions()` + `setSessionCookie` |
| Dev preview workaround isolation | Session token in the login response body (for the cross-site preview iframe where browsers refuse the Lax cookie) is **dev-only and cannot be enabled in production**; the production session transport is the HttpOnly cookie alone — session credentials never reach browser JavaScript in production | `isDevSessionBearerEnabled()`, `getSessionToken()` Bearer branch |
| Unauthorized access | Every authenticated route funnels through `withUser`/`getCurrentUser` → 401 with safe message; CSRF defense-in-depth: cookie-authenticated requests with a cross-origin `Origin` header are rejected (403 `CSRF_REJECTED`); Bearer-authenticated requests are exempt (explicit header ≠ ambient credential) | `src/lib/auth.ts` `isCrossOriginRequest` + `getSessionToken` |
| Authentication errors | All failure paths return safe, generic copy; internal detail goes only to the server log with a request correlation id | `errors.ts` classification |

**Password reset / MFA**: no password-reset flow exists yet (no email provider — Phase-0 freeze), so rate-limited reset is N/A-with-evidence; MFA remains a documented gap (baseline E-5) — not weakened, not faked.

## 2. Brute-force protection (central)

`src/lib/security/rate-limit.ts` — one in-memory limiter (bounded to 50k keys, oldest-eviction), progressive window extension on repeated abuse, `Retry-After` headers on 429.

| Endpoint | Key | Policy |
|---|---|---|
| `POST /api/auth/login` | IP **and** account | 8/15 min per IP · 5/15 min per account (lockout) |
| `POST /api/auth/change-password` | account | 5/hour |
| `DELETE /api/auth/sessions` (revoke devices) | account | 10/hour |
| `POST /api/admissions/public` | IP | 10/hour |
| `POST /api/admissions/upload`, `POST /api/teachers/upload`, `POST /api/study-materials` | account | 30/hour |
| `POST /api/{teachers,admissions}/upload/access` (signed URL mint) | account | 120/hour |
| `POST /api/ai/generate-questions` | account | 12/hour |
| `POST /api/messages` | account | 40/hour |
| `POST /api/student/payments/order` / `verify`, `POST /api/fees/orders` | account | 20/hour |
| `POST /api/webhooks/razorpay` | IP | 120/min (HMAC remains the real gate) |
| `POST /api/superadmin/settings` | account | 10/hour |

Live-verified: 6th bad login → `429 ACCOUNT_LOCKED` (`Retry-After: 900`); 11th admission inquiry → `429` (see §11).

## 3. Input validation (one strategy)

- `parseJsonBody(req, schema)`: 256 KB default cap (2 MB absolute ceiling), JSON parse guard, **strict objects** (unexpected top-level fields rejected → 422 naming the field), zod validation with safe field-level messages.
- Shared primitives: `idSchema` (alphanumeric+`-_`, ≤64 — kills traversal/unicode/junk), `emailSchema`, `phoneSchema`, `safeText` (no control chars, bounded), `enumSchema`, `dateStringSchema` (invalid dates rejected), `boundedInt`/`amountSchema` (NaN/bounds rejected), `newPasswordSchema`.
- Applied to: **login**, **change-password**, **admissions/public** (full strict schema), **superadmin/settings** (strict), plus targeted validation on **messages** (recipient id + role enum), **payments** (amount bounds), **teachers/admissions upload access** (fileId shape), **export** (`type` enum allowlist).
- Upload inputs: size ceilings, magic bytes, extension allowlists, dimension decoding, server-minted filenames (see §5).

## 4. Security headers

`src/lib/security/headers.ts` → `next.config.ts` `headers()` → every route.

| Header | Dev profile | Production profile |
|---|---|---|
| CSP | `unsafe-eval` + `blob:` workers (React refresh, tesseract WASM), `connect-src` allows `http://localhost:*` (required by the custom lazy-compilation dev backend on :3777) | strict: no `unsafe-eval`, `wasm-unsafe-eval` only, `connect-src 'self'`, `upgrade-insecure-requests` |
| `frame-ancestors` | `'self'` + sandbox preview origins (`*.space-z.ai`, `*.z.ai`, `*.chatglm.cn`, localhost) | `'self'` + `SCHOOL_EMBED_ORIGINS` (comma-separated, scheme-validated — legitimate school-website embedding stays possible; junk schemes rejected) |
| HSTS | absent (http preview) | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | same |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | same |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | both | both |

Live-verified via curl on `/` (both profiles are unit-tested in `tests/security/headers.test.ts`).

## 5. File-upload security

Central policy in `src/lib/security/upload.ts`; signing in `file-signing.ts`.

| Requirement | Implementation |
|---|---|
| Server-side size limits | admissions 5 MB · teacher photo 2 MB · signature 1 MB · study-materials 20 MB (pre-existing, now central) |
| MIME verification + file signature | Magic bytes (PDF/JPEG/PNG/WebP) — declared MIME never trusted |
| Extension allowlist | `pdf|jpg|png` (admissions), `jpg|png|webp` (teachers) — enforced on both store and serve |
| Tenant isolation | School-scoped authorization on every upload/access/delete (PRINCIPAL/MANAGEMENT); local-disk storage has no per-file ownership registry yet (fileIds are unguessable server-minted) — registry arrives with the object-storage phase (documented limitation, audited access) |
| Authorization | **all upload POSTs, GETs and DELETEs now require PRINCIPAL/MANAGEMENT** (baseline B-5/B-6 remediation — they were anonymous) |
| Safe filenames | Stored names are server-minted opaque ids; client names pass `sanitizeDisplayFilename` (paths, control chars, shell metacharacters stripped, 120-char cap) |
| Signed access | `POST /api/{teachers,admissions}/upload/access` mints a 1-hour HMAC-SHA256 URL bound to one fileId+scope (timing-safe, tamper/replay-proof) so `<img>`/`<a>` can authorize without headers; every grant is audited |
| Deletion controls | DELETE requires auth + roles, rate-limited, audited; missing-file deletes remain idempotent |

Live-verified: anonymous upload/GET/DELETE → 401; signed URL mint → fetch 200 `image/png`; tampered token → 401; cross-file token replay → 401.

## 6. Sensitive data exposure paths — fixed

| Path (Phase-0 finding) | Fix |
|---|---|
| Session token in login response body + localStorage (B-4) | Dev-only (`isDevSessionBearerEnabled`, hard-off in production); production session credential never reaches JS |
| Anonymous media/document reads (B-6) | Auth + signed URLs (§5) |
| Realtime cross-tenant broadcast (B-9/C-2) | Handshake authentication + server-side rooms: `user:`, `school:`, `staff:`, `platform` — payments to staff+payer, messages to recipient only, announcements/timetable to school room; anonymous sockets refused (verified: `connect_error: unauthorized`) |
| Error envelope leaking internals (B-10/F-2) | Classification + sanitizer (§9) |
| Demo credentials in production bundle (B-11/E-6) | Build-time gating: production compiles the quick-access cards to `[]`; `NEXT_PUBLIC_DISABLE_DEMO_LOGIN=1` disables them in dev |
| Committed `.env` / runtime DB (B-1/B-2) | Untracked from git (files remain locally for the dev sandbox); `.gitignore` hardened; template `.env.example` committed |
| PII in URLs | No tokens/passwords in query strings; signed-URL tokens are scope+file+expiry-bound (contain no session material — unit-asserted) |
| Logs | Audit details pass `sanitizeAuditDetail` (64-hex tokens, `sk-` keys, `password=` assignments redacted); API errors log details server-side only |

## 7. Secrets

- `.env` **untracked** (was force-added); `db/custom.db` **untracked** (PII).
- `.env.example` documents every env var the app reads (unit-asserted).
- Dev/prod separation: dev-only transports gated by `NODE_ENV`; production-only settings (`FILE_SIGNING_SECRET`, `SCHOOL_EMBED_ORIGINS`, HSTS) documented in the template.
- Automated secrets scan as part of the test suite (`tests/security/secrets-scan.test.ts`): tracked files are swept for high-confidence secret material (API keys, private keys, live provider secrets) — passes.
- Git history still contains the old blobs — history rewrite remains a coordinated later step (as flagged in Phase 0; not silently attempted here).

## 8. Security logging (audit trail)

Central funnel `auditEvent()` → one JSON log line + one ActivityLog row (survives restarts; surfaces in the Super Admin activity feed). Canonical vocabulary (unit-asserted) includes: `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`, `LOGOUT`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED`, `SESSIONS_REVOKED`, `SESSION_ROTATED`, `PERMISSION_CHANGE`, `STUDENT_DATA_EXPORT`, `FEE_OPERATION`, `MARKS_CHANGE`, `ADMISSION_APPROVED`, `ACCOUNT_ACTIVATED`, `PLATFORM_SETTING_CHANGE`, `PAYMENT_VERIFIED`, `FILE_UPLOADED`, `FILE_DELETED`, `FILE_ACCESS_GRANTED`, `CSRF_REJECTED`, `RATE_LIMIT_BLOCKED`.

Wired events today: login success/failure/lockout, logout, password change (± failure, rotation), session revocation, class-teacher appointment changes (`PERMISSION_CHANGE`, principal/academic), student/fee/attendance/teacher CSV exports + payments ledger export (`STUDENT_DATA_EXPORT`), payment verification (`PAYMENT_VERIFIED`), marks submission (`MARKS_CHANGE`), platform setting changes (`PLATFORM_SETTING_CHANGE`), admission inquiries (pre-existing `ADMISSION_INQUIRY`), file upload/delete/signed-access.

N/A-with-evidence: **admission approval** and **account activation** have no server routes yet (client-mock flows — Phase-0 K-finding; they gain server routes in the mock-removal phase and inherit this funnel).

## 9. Error responses

`src/lib/api.ts` + `errors.ts`:

- Every failure carries `X-Request-Id` (correlation without disclosure); 429s carry `Retry-After`; bodies are `{ ok, error, code }` with **safe** messages only.
- Status semantics: 401/403/404/409/413/415/422/429/500 — Prisma engine errors map to 409/404/422/500-safe; route-authored human messages surface as 400 **only if** they pass unsafe-message heuristics (paths, Prisma internals, stack frames, constraint names, secrets → 500 generic).
- 500-class failures log full detail server-side (JSON line with request id).
- Raw `Response` passthrough (file streams) keeps `X-Request-Id` + `X-Content-Type-Options`.

## 10. Automated security tests

`bun run test:security` → **85 tests / 0 failures** across 9 files (`tests/security/`): rate-limit semantics (counting, windows, escalation, key isolation, Retry-After), validation (oversized/malformed/unknown-field/enums/ids/numbers/dates), error sanitization (status mapping, leak heuristics, request ids), auth core (scrypt, token shape, cookie Secure-flag gating, dev-bearer production lock-out, CSRF origin guard), file signing (roundtrip, expiry, scope/file binding, tamper), upload policy (magic bytes, traversal, sanitizers), headers (dev + prod profiles, embed-origin validation), audit (vocabulary + redaction), secrets scan (tracked-file sweep + env template coverage). No security rule was weakened to make tests pass — the two initial test failures were fixed by correcting the tests to the designed semantics (escalation windows; the signed-token MAC is 64-hex by design).

## 11. Verification record (exact)

| Command | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors — exit 0** |
| `bun run lint` (`eslint .`) | **0 warnings, 0 errors — exit 0** |
| `bun run build` | **succeeded** (ran with the dev server stopped; the first attempt was OOM-killed (exit 137) while dev + build shared the 4 GB cgroup — restarted clean and passed) |
| `bun run test:security` | **85 pass / 0 fail** (276→281 assertions) |
| Dev server | healthy on :3000; security headers confirmed on `/` (curl) |
| Event-stream service | :3003 healthy; **anonymous socket refused (`connect_error: unauthorized`), authenticated socket accepted** |
| Live API checks | login 200 + 64-hex dev bearer; wrong password → generic 401; 6th bad login → 429 ACCOUNT_LOCKED (Retry-After 900); unexpected login field → 422; anonymous upload/GET/DELETE (teachers + admissions) → 401; authenticated upload (real PNG, 256×256 header decode) → 200; signed-URL mint → GET 200 image/png; tampered + cross-file tokens → 401; admission inquiry 11th → 429; webhook without secret → 503 fail-closed; password change → other sessions revoked + token rotated (old token 401, new token 200); demo password restored |
| Browser (agent-browser) | public site renders (1440×900 and 390×844, no horizontal scroll); login page renders; principal login → panel with live dashboard data; logout → back to login; wrong password → generic error; no page errors. **Found + fixed a real regression during verification**: the first dev CSP blocked the custom lazy-compilation EventSource (`localhost:3777`) — the dev `connect-src` now allows localhost ports (production CSP remains strict; regression-covered by a dedicated test) |
| Audit trail | ActivityLog rows verified for `LOGIN_SUCCESS/FILED/LOCKED`, `PASSWORD_CHANGED/CHANGE_FAILED`, `SESSION_ROTATED`, `FILE_UPLOADED`, `FILE_ACCESS_GRANTED`, `ADMISSION_INQUIRY` |

## 12. Known residual risks (honest register)

1. **Local-disk uploads** with no ownership registry — access is role-gated + unguessable ids + audited; full fix lands with object storage (Phase-0 M.12).
2. **SQLite + committed git history** — files are untracked going forward, but past blobs remain in history until the coordinated history rewrite.
3. **MFA absent** (including SUPER_ADMIN) — unchanged Phase-0 gap; next auth phase.
4. **Mock client-side flows** (fees/salary/applications) remain — out of Phase-1 scope by instruction; their server migration inherits the central controls automatically.
5. **CSRF**: `SameSite=Lax` + Origin-check defense-in-depth (cookie path only); token-based CSRF is intentionally not added to all 188 routes in this phase.
6. **CSP `unsafe-inline` (scripts)**: nonce-based strict CSP requires per-response middleware — deferred deliberately; documented trade-off.
7. **Dev bearer fallback** remains necessary for the cross-site preview iframe in development; it is structurally isolated from production (hard `NODE_ENV` gate + tests).

## 13. Files changed (summary)

- **New**: `src/lib/security/{errors,rate-limit,validation,audit,upload,file-signing,headers}.ts`, `src/lib/secure-media.ts`, `src/components/principal/modules/teachers/secure-teacher-media.tsx`, `src/app/api/{teachers,admissions}/upload/access/route.ts`, `tests/security/*.test.ts` (9 files), `.env.example`, `docs/SECURITY_BASELINE.md`.
- **Hardened**: `src/lib/{api,auth}.ts`; auth routes (login/logout/change-password/sessions); upload routes (teachers ×3, admissions ×3); public admission; AI; messages; payments (order/verify); fees/orders; webhook; superadmin settings; exports (students + payments); marks submit; principal/academic (permission audit); study-materials; `next.config.ts` (headers); `mini-services/event-stream/index.ts` (auth + rooms); login demo gating; settings security components (token rotation persistence); teacher/admission media components (signed URLs); `package.json` (zod, test:security, typecheck scripts); `.gitignore`.

---

*End of Phase-1 security baseline. Companion documents: `docs/PRODUCTION_READINESS_BASELINE.md` (Phase 0), `docs/PRODUCTION_READINESS_CHECKLIST.md`, `worklog.md` (session record).*
