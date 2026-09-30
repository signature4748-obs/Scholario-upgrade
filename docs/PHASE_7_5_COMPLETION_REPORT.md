# PHASE 7.5 — Completion Report

**Status: `PHASE 7.5 COMPLETE`** (with evidence below)

Scope honored: product polish, settings architecture, school website CMS, UI
quality pass. **No** production Supabase/Vercel/Resend/payment-gateway
connection, no secrets, no per-school codebases, no Super Admin in school
login, no frontend-only tenant security, no deletion of legitimate
seed/fixture data, no "production ready" claims from UI alone.

---

## 1. What changed (by workstream)

### 1.1 Server foundation (orchestrator, Task 7.5-A)
- **Data model** (`prisma/schema.prisma` + migration
  `20260920100000_phase75_school_config_website_cms`, additive-only): School
  identity columns (`shortName`, `tagline`, `affiliation`, `website`,
  `principalName`, `established`, `faviconUrl`), `settings` JSON (config
  slices), `websiteContent` JSON (CMS document); `Notification` gained the
  real editorial lifecycle (`status DRAFT|PUBLISHED|ARCHIVED`, `publishAt`,
  `expiresAt`, `imageId`, `updatedById`); new `GalleryAlbum` / `GalleryImage`
  models (tenant-scoped, cascade).
- **Canonical configuration** — `src/lib/school-config.ts`: the ONE
  server-side reader/writer with validation (identity length caps, strict
  hex branding, **WCAG ≥ 3.5:1 contrast gate on white**, ≤16 KB/slice
  settings JSON, 30-key bound, shallow-deep merge).
- **Website CMS contract** — `src/lib/website-content.ts`: shared
  `WebsiteContent` type + `NEUTRAL_WEBSITE_CONTENT` claim-free fallbacks +
  `mergeWebsiteContent` (one type used by server, admin editors, renderer).
- **Tenant resolver** — `src/lib/tenant/resolution.ts`: Host domain →
  `?slug=` → single ACTIVE school → demo fallback; sandbox hosts never
  resolve; unknown slug fails-safe; exact domain match only (no suffix
  guessing).
- **Subscription access model** — `src/lib/access-policy.ts`
  (`evaluateSchoolAccess`, `planAllows`) enforced at login AND (added at
  close-out) inside **`withUser()` — every school API** (fail-closed on
  unknown/missing school status; `getCurrentUser` now carries
  `school.status`).
- **APIs**: `GET/PATCH /api/school-settings` (session-tenant, audited),
  `GET/PATCH /api/school/website`, gallery album CRUD + image
  add/reorder/remove, `POST /api/school/website/upload` (magic-byte
  JPG/PNG/WebP ≤4 MB, opaque ids, ownership registry),
  `GET /api/public/website/media/[fileId]` (privacy-by-default: serves bytes
  only for PUBLISHED gallery images / visible announcements / school
  branding), `PATCH/DELETE /api/announcements/[id]` (lifecycle transitions,
  cross-tenant id ⇒ 404), `/api/schools/public` rewritten as the
  tenant-resolved full CMS payload.
- **Visibility leak closed**: `notificationVisibilityWhere()` now spread in
  the bell feed, student notices, search, public payload, RSS, and media
  route (the audit's latent scheduled/expired announcement leak).
- **Fake paywall retired**: `StudentSubscriptionActivation.tsx` deleted;
  `platform-subscription.ts` is a compile-time tombstone. School-role access
  is a tenant-level domain decision.
- **Dashboard honesty**: finance/stats/exams hooks gained retry + refresh
  (`use-dashboard-finance` never caches failure); academic session derives
  from `School.academicYear`; identity cascade (server → local → neutral)
  replaced `lib/mock/school` across documents/letters/receipts/footers.

### 1.2 Settings architecture (agent 7.5-B)
School Settings became the **server-backed configuration center** (13 tabs):
new **Identity** (draft + Save → PATCH), **Branding** (color pickers + hex +
live WCAG pre-check via `lib/branding-contrast`, logo upload/preview), **Website**
(per-section CMS editors with per-section Save), **Modules** (effective
server module flags), plus reworked Attendance/Timetable (persisted
`settings` slices driving the real period ladder) and the honest-scope Fees
tab. Settings store hydrates once per session from
`/api/school-settings` (`server-sync.ts`, retryable, seed realignment).
Announcements got the full lifecycle UI (compose: Send Now / Save as Draft /
Schedule; rows: status chips, publish window, image thumbs, publish /
unpublish / archive / edit / delete). The fabricated communication seed
universe was un-seeded. ID-card preview fixed (server roster, not STU-58).

### 1.3 Public website + login (agent 7.5-C)
The public site renders the per-school CMS document (hero, pillars, journey,
facilities, principal message, admissions copy, contact, footer, SEO,
gallery groups, image-bearing notices) with per-school branding applied via
inert-fallback `school-brand-*` CSS token classes (dark/hover safe,
emerald/amber fallbacks), skeletons, honest section hiding, and neutral
degraded copy on failure. Login shows the resolved school's identity (one
deduplicated fetch) and zero platform/super-admin affordances.

### 1.4 Close-out QA fixes (this session, evidence-driven)
- **Cross-tenant UI content bug (found by browser QA)**: the public site and
  login dropped the URL's `?slug=` when fetching, so School B's link rendered
  School A's demo content. Both fetches now forward an explicit URL slug
  (production host resolution unchanged) — pinned by tests.
- **Fee donut legend truncation** in the 1/3-width card: long parenthetical
  legend names replaced with short labels + an honest semantics footnote
  ("Collected = recorded payments · Outstanding = billed − collected").
- **Trend chart axis overlap**: Y-axis labels moved into their own left
  gutter (plot wrapped in an offset container; DOM-geometry verified
  gutter x=312–352 vs first month label x=360).
- Floating hero stat chip: singularized at 1, hidden at 0 (no "0 Students
  enrolled").
- 17 lint errors (unused vars in Phase 7.5-touched files) → **0**.

---

## 2. Files / modules changed

62 modified + 22 new source files, 1 migration, 1 seed, 6 docs, 1 test
suite. Highlights: `prisma/schema.prisma` (+migration), `src/lib/`
(`school-config`, `website-content`, `branding-contrast`,
`access-policy`, `tenant/resolution`, `api.ts` gate, `auth.ts`,
`school-profile`, `academic-session`, `hooks/use-effective-module-flags`,
`notices`), `src/app/api/` (school-settings, school/website/*, public/website/*,
announcements +[id], schools/public, auth/login, dashboard, notifications-feed,
student/notices, public/notices/rss, search), `src/components/principal/modules/
school-settings/*` (7 new tabs), `dashboard/*`, `communication/*`,
`src/components/public-website/*`, `src/components/login/login-page/*`,
`src/components/student/student-panel.tsx`, `src/components/shell/app-shell.tsx`,
`src/components/shared/premium-charts.tsx`, `src/lib/store/*`
(school-settings-store + server-sync, communication-store un-seed,
students-store), `prisma/seed-website-cms.ts`,
`tests/security/phase75-product.test.ts`.

---

## 3. Verification (executed + results)

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` (whole repo) | **0 errors** (61 pre-existing warnings, unchanged classes) |
| `bun run test` (437 tests) | **436 pass / 1 fail** — the single failure is a 20 s cold-compile page timeout under full-suite load; that file re-run standalone: **45/45 pass** (documented flake class; server restarted cleanly, no new OOM entries) |
| `bun test tests/security/phase75-product.test.ts` | **14/14 pass** (the 10 required proofs) |
| `bunx prisma migrate status` | 6 migrations, schema up to date |
| Secrets scan (diff + suite `secrets-scan.test.ts`) | clean — no credentials, no Supabase/Vercel/Resend keys |
| Debug-code sweep on all changed files | clean (the audit `console.log` is the pre-existing structured audit pipeline) |
| Browser QA (agent-browser + VLM review) | see §4 |

### The 10 required proofs (tests/security/phase75-product.test.ts)
1. School A website content cannot resolve as School B — ✅ (A/B payload
   disjointness + neutral-fallback identity + unknown-slug 404 without oracle)
2. A announcements not returned for B — ✅ (public + authenticated feeds;
   drafts invisible even for A)
3. A gallery not returned for B — ✅ (+ image bytes private while
   unpublished → 200 only when published)
4. A settings do not affect B — ✅ (byte-identical B row; hostile
   client `schoolId` ignored)
5. Client-provided `schoolId` never switches tenant — ✅ (query + body
   probes on read and write routes; DB row attribution verified)
6. School login exposes no Super Admin — ✅ (payload carries one school,
   no platform keys; legacy superadmin identity cannot obtain a session)
7. Subscription policy enforced in the domain layer — ✅ (unit fail-closed
   proofs + LIVE: DB-suspended tenant B blocked on every school API with the
   policy reason, login blocked, public site dark, A unaffected, reactivation
   restores the SAME session with data preserved)
8. Empty datasets produce no fake dashboard values — ✅ (B's stats equal
   live DB aggregates; empty payments ⇒ empty trend)
9. Fee chart calculations correct — ✅ (billed/collected/overdue/trend
   recomputed exactly from DB; attendance rate formula + bounds; collected ≤
   billed)
10. Branding applied consistently — ✅ (one PATCH visible on settings,
    public site, and session identity; A untouched; unsafe low-contrast
    color rejected with an actionable message)

### Browser QA (all screens from §22)
- Public website (A demo + B neutral): VLM 9/10, no overflow at 1440/390/320.
- Login: VLM 9/10 — form complete, contrast good, **no Super Admin entry**,
  school-branded.
- Principal dashboard: KPIs aligned; chart fixes verified (VLM + DOM
  geometry); no overflow at 1440/390/320.
- School Settings: 13-tab center; **CMS save round-trip proven live**
  (hero edit → persisted via API → reverted); gallery manager complete
  (publish switch, per-photo captions, boundary-disabled reorder).
- Announcements: compose → Save as Draft → Drafts filter (count 0→1) → row
  actions → Delete with confirmation → clean removal (DB row gone).
- Admissions / Students & Classes / Teachers / Fee Management / Attendance /
  Examinations / Timetable: **no horizontal overflow at 390 px** (7/7 OK).
- 320 px extreme-width spot checks (dashboard + public): OK.

---

## 4. Remaining known issues (honest register)

1. **Fee-head catalogue dual system**: the settings-store local template
   list and the DB `MasterFeeHead` billing catalogue coexist by design;
   the Settings → Fees tab carries an honest scope banner. Full
   consolidation is a Fees-module refactor (structures/receipts/defaulters
   are Phase-7-hardened) — postponed deliberately.
2. **Dashboard finance cross-system semantics**: the donut's "collected"
   (Σ `Fee.paid`) and the trend (Payment rows) are two aggregate systems;
   they are now precisely labeled, the rate is clamped 0–100, and tests pin
   both — a single ledger unification remains future work (needs an
   expense/ledger model, register R3).
3. **Bluebell public site renders fixture-scale counts** ("1 Students
   Enrolled" style) — these are REAL DB values of the isolation-fixture
   tenant (honest, test-pinned), but the fixture tenant is not
   presentation-grade; a real school would show real counts.
4. **Suspended tenant's public website goes dark (404)** rather than a
   friendly "subscription lapsed" page — a deliberate documented decision.
5. **Calendar module still runs on a client mock store** (documented
   data-source register entry; out of this phase's critical path).
6. Environment: dev-server memory under sustained full-suite load in the
   4 GB sandbox (chronic OOM class, 76 kills machine-wide; the repo's
   detached-spawn pattern + sequential verification used; flake re-verified
   green).
7. Timetable right-edge truncation at narrow widths is the intended
   horizontal-scroll design (sticky period column).

## 5. Postponed to the Supabase/Vercel/Resend phase (by design)

- Real per-school domains/DNS + production host-based tenant resolution
  (the resolver seam is the only mapping point).
- Private object storage + signed URLs for website media (registry +
  publication-rule seam ready).
- Real billing/payment provider wired into `planAllows` (matrix is the seam;
  no billing exists today).
- Automated subscription expiry timers (status changes only via the
  platform control plane today).
- Transactional email (Resend) for announcements/communication.
- Per-school workspace theme skin beyond identity surfaces (public site +
  login + documents brand today; workspace keeps the Scholario theme,
  documented).
- Per-school favicon serving beyond the config field (field exists, wired
  into branding config; production CDN serving later).

## 6. Documentation shipped

- `docs/PHASE_7_5_UI_PRODUCT_AUDIT.md` (current-state audit + remediation map)
- `docs/SCHOOL_CONFIGURATION_MODEL.md` (actual implementation)
- `docs/SCHOOL_WEBSITE_CMS.md` (actual implementation)
- `docs/SCHOOL_SUBSCRIPTION_ACCESS_MODEL.md` (actual implementation)
- `docs/TENANT_AWARE_WEBSITE_MODEL.md` (actual implementation)
- `docs/PHASE_7_5_COMPLETION_REPORT.md` (this file)

---

**Final status: `PHASE 7.5 COMPLETE`** — audit → implementation → tests →
browser verification → documentation → commit. STOP. The
Supabase/Vercel/Resend production migration was NOT started (per §24).
