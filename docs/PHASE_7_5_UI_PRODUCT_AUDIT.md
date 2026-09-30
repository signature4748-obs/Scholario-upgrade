# PHASE 7.5 — UI Product Audit (Current State)

> Evidence-based inspection of the Scholario-OS repository **before** Phase 7.5 changes.
> Post-Phase-7 state (mock-data elimination, see `docs/DATA_SOURCE_MAP.md` register R1–R20).
> DB fact: **two schools** exist — `Greenwood Public School` (slug `demo-school`, isDemo, ENTERPRISE, AY 2026-2027, themeColor `#0f766e`, logoUrl null) and `Bluebell International Academy` (slug `bluebell-academy`, STANDARD, AY 2025-2026). The product behaves as if only the first exists.

---

## 1. Current UI problems (summary)

The workspace UI is polished (Phases 5–7), but the **product architecture** around school-specific configuration is single-tenant:

- School Settings is 100% browser-localStorage — nothing except Facilities (rooms) and My Account persists to the DB.
- The public website and login hardcode `?slug=demo-school`; School B is unreachable; `School.domain` is stored but never routed.
- All website content (hero, pillars, stages, facilities, gallery, admissions copy, "since 1995") is component constants.
- Branding colors are triple-hardwired (CSS vars + 1,801 raw `emerald-*` classes + oklch literals); `School.themeColor/accentColor/logoUrl` are fetched but consumed by nothing.
- Announcements: draft/schedule are client-store fiction; the announcements tabs render fabricated seed rows; no edit/delete/image.
- Every student is hard-gated behind a fabricated in-memory UPI paywall (lost on every reload).

## 2. Broken components

| Component | Problem |
|---|---|
| `school-settings/id-card-tab.tsx` | "Live Preview" permanently stuck at "Loading preview…" — depends on `DEMO_STUDENT_ID = 'STU-58'`, which no longer resolves in the server-synced roster (Phase 7) |
| `student-panel.tsx` paywall | `platform-subscription.ts` in-memory record; non-seeded students blocked forever; "paid" state lost on reload |
| Public admissions form | initial `grade: 'Grade 1'` matches no select option (`primary/middle/senior` values) — silent invalid submit |
| Public hero badge | fallback "Admissions open for 2025–26" — stale vs DB AY 2026-2027 |
| Platform console branding caption | "Colors apply to the school workspace" — false; nothing consumes the fields |

## 3. Misleading / faulty charts

- **Fee donut** (`charts-row.tsx`): "Outstanding" is a client-side subtraction of two aggregate systems (Σ`Fee.amount` − Σ`Fee.paid`) while the trend line uses `Payment` rows — the two can disagree; no drill-down.
- `use-dashboard-finance.ts` / `use-school-stats.ts`: module-level one-fetch-per-session cache — **no retry, no invalidation**; an error sticks until full reload.
- No expense series (register R3) — the title honestly avoids it, but "Revenue vs Expenses" remains impossible.
- Chart colors are hardcoded oklch literals, not tokens.

## 4. Hardcoded colors

- `globals.css` `--primary: oklch(0.55 0.14 162)` (green) + ring/chart/sidebar variants.
- **1,801 raw `emerald-*` utility classes across 364 files** + 157 `teal`.
- Raw oklch literals inside chart components (`charts-row.tsx:96,130`).
- `School.themeColor` / `School.accentColor` / settings `general.brandColor` (defined in types) are consumed by **nothing**.

## 5. Hardcoded school content (identity universes)

Three divergent school-identity universes:
1. **DB `School` row** (name/slug/code/contact/themeColor/academicYear/board).
2. **Client settings-store seed** (`initial-state.ts`: Greenwood contact block, tagline, affiliation, 21 fee heads, 4 discounts, payroll grades, uniforms, houses with fabricated captains, admission seat matrix…).
3. **`lib/mock/school` fallback** (Greenwood/Dr. Ananya Iyer/1842 students — 29 runtime importers via `school-profile.ts` for payslips, receipts, letters, certificates, timetables PDFs, comm-compose, app-shell footer…).

Plus `lib/tenant/schools.ts` hardcoded one-entry registry (`t-dsg-gur-01`, 1842 students) that scopes every "tenant-scoped" localStorage family — **shared by every school on the same browser**.

## 6. Hardcoded website text

All in `public-website.tsx`: hero H2 "Empowering Minds, / Inspiring Excellence"; hero paragraph; 4 pillars; 3 journey stages; 4 facilities (incl. "30,000+ titles", "Olympic-sized pool… 400m track"); 4 gallery tiles; admission highlights (fabricated operational facts: Saturday tours, February assessments, "1:12 teacher ratio", "capped at 30"); admissions copy + office hours; footer "…since 1995."; "Powered by Scholario". Identity fallbacks `'Our School'`, `shortName = schoolName.split(' ')[0]`.

## 7. Weak / incomplete settings

- Only Facilities (rooms → real API) and My Account (session API) are server-backed.
- Academics tab: read-only stale seed grid (real management lives in Classes module via `/api/principal/academic`).
- Timetable tab: `store.timetable` has **zero consumers** — the Timetable module uses its own '08:30 AM' defaults.
- Library tab: decorative — `/api/library` enforces none of the rules.
- Fees tab: client catalogue of 21 seeded heads; the **DB `MasterFeeHead` API (`/api/fees/catalogue`) has zero consumers**.
- Uniforms tab: no consumers bill from it.
- ID Cards: drives the student ID card, but preview broken (§2).

## 8. Duplicated settings

- feeHeads: client settings-store ↔ DB `MasterFeeHead`
- grading: `results.gradeScale` (store) ↔ DB `GradeScale` (`/api/exams/settings/grades`)
- subjects: `academics.subjects` (store) ↔ DB `Subject` + `/api/principal/academic`
- classes: `academics.classes` (store) ↔ DB `Class`
- payroll grades: store ↔ salary-store structures
- academic session: client localStorage + hardcoded `'2026-2027'` fallback (`academic-session.ts:26`) — **ignores `School.academicYear`** (Bluebell would show the wrong year)

## 9. Components using mock / fallback data

Per `docs/DATA_SOURCE_MAP.md` register + audit: `lib/mock/school` (29 importers), `lib/tenant/schools.ts` registry, `school-settings-store/initial-state.ts` seeds, `communication-store.ts` SEED_ANNOUNCEMENTS/CIRCULARS/AUDIT (fabricated 1842-recipient announcements with fake authors), `platform-subscription.ts`, `fee-store-data.ts` constants, public-website copy, client module-registry flags, student fee-store ledger, exams workspace mock marks (documented R-entries).

## 10. Responsive problems

Generally strong (Phase 5 verified 320→1920 zero-overflow). Known: QuickStats fee-tile copy truncates at 3-up tile widths (by design); settings tab strip wraps heavily on mobile (usable); ID-card preview broken regardless of width.

## 11. Accessibility issues

Core a11y solid (Phase 5: skip link, focus trap, aria-current, roles). Gaps: color pickers are plain text inputs (no labels/contrast feedback); notice-board priority chips rely on color alone for urgency (also labeled); gallery has no keyboard-lightbox (n/a — no gallery yet).

## 12. Tenant-specific configuration gaps

No per-school: branding application, website content, gallery, announcements management persistence, settings persistence, login context, session-derived academic year, module flags propagation (server flags ≠ client registry vocabulary `exams` vs `examinations`; flags never reach the client nav).

## 13. Website CMS gaps

No CMS at all: no content model, no management UI, no image pipeline for public assets, no SEO metadata per school, no per-school hero/logo/favicon, no gallery, no social links.

## 14. Subscription / access-gating gaps

`School.plan` has **no runtime semantics** (displayed, never gates). `School.status` gates only login. The fake student paywall (register R13) is the single most product-breaking item for a second tenant. No domain abstraction for subscription→access policy.

## 15. Technical debt relevant to this phase

- `notificationVisibilityWhere()` exists but is NOT spread in the bell feed and `/api/schools/public` notifications include — latent leak once scheduling becomes real.
- Dashboard finance hooks never retry.
- `/api/schools/[id]` PATCH is SUPER_ADMIN-only (dead for school users post-Phase-6); no principal-accessible school-profile write route exists.
- Dead APIs: `/api/fees/catalogue` (zero consumers), `/api/events` POST/DELETE (no UI writer — the Calendar module runs on a client mock store).
- Client tenant registry `switchTenant()` has zero callers; tenant-storage namespaces collapse all schools to one id.

---

## TOP-20 ranked problems (drivers for this phase)

1. Student workspace hard-gated by fabricated in-memory paywall (blocks all non-demo tenants; state lost on reload).
2. Client tenant registry is a hardcoded single-tenant mock — all "tenant-scoped" localStorage shared across schools.
3. School Settings is 100% localStorage (R19) — no API, no DB write, misleading "saved automatically" copy.
4. Three divergent school-identity universes — fresh tenant renders Greenwood letterheads everywhere.
5. Public website + login hardcode `slug=demo-school` — no tenant resolution; `School.domain` never routed.
6. No website/CMS content storage — per-school websites impossible without code changes.
7. Green theme triple-hardwired; `School.themeColor/accentColor` consumed by nothing; platform promise false.
8. `logoUrl` has no lifecycle (no upload UI, null in DB, unused in login/public).
9. Announcement schedule/draft are client fiction; tabs render fabricated seeds; no edit/delete/image; channels cosmetic.
10. Client module gating decorative + disconnected from server flags (vocab mismatch, never propagated).
11. Two fee-catalogue universes (client store vs zero-consumer DB API).
12. ID-card settings preview permanently broken (STU-58).
13. Academic session from localStorage + hardcoded fallback — ignores `School.academicYear`.
14. Timetable & Library settings tabs decorative (no consumers).
15. `notificationVisibilityWhere` not spread in bell feed + public route (latent leak).
16. Student Fees module reads client fee-store while the office writes server Fees (two fee truths).
17. Dashboard finance hooks: one fetch per session, no retry/invalidation; donut cross-system subtraction.
18. Public-site unverifiable marketing claims presented as school facts + admission form grade bug + stale AY fallback.
19. `School.plan` has no runtime semantics; subscription story split between dead mock engine and status-only gate.
20. `SchoolEvent` has APIs but no management UI (Calendar module runs on client mock store).

---

## Phase 7.5 remediation targets (mapped)

| # | Problem | Phase 7.5 fix |
|---|---|---|
| 1 | Fake paywall | Remove; `School.status`-derived access policy in a domain layer (`lib/access-policy.ts`) + tests |
| 2 | Tenant registry mock | Server-side tenant resolution (host/slug → School row) in public APIs; client fetches resolved school |
| 3 | Settings localStorage | DB columns + `settings` JSON on School + `/api/school-settings` + store hydration (teachers-store pattern) |
| 4 | Identity universes | DB School row = canonical identity; settings store hydrates from server; documents/public/login read server identity |
| 5 | Hardcoded slug | Tenant resolver in `/api/schools/public` (host → slug → isDemo fallback) |
| 6 | No CMS | `School.websiteContent` JSON + Website settings tab (hero/sections/gallery/SEO/social) + public site renders it |
| 7 | Hardwired colors | Branding config (primary/accent/logo/favicon) applied to public site + login + documents via CSS vars (contrast-validated); workspace keeps default Scholario theme (documented) |
| 8 | No logo lifecycle | Logo upload in Branding tab (scoped upload) + login/public/documents consumption |
| 9 | Announcement fiction | Real lifecycle: status/publishAt/expiresAt/image + PATCH/DELETE + composer wiring + un-seed store |
| 10 | Module gating | Effective flags API → client nav gating (server vocabulary) |
| 11 | Fee catalogue dup | Settings Fees tab reads/writes DB `MasterFeeHead` catalogue |
| 12 | ID preview bug | Server roster-based preview (real student) |
| 13 | Session fallback | `academic-session` hydrates from `School.academicYear` via session |
| 14 | Decorative tabs | Timetable settings drive the module defaults; Library rules persisted (honest "not yet enforced" where true) |
| 15 | Visibility leak | Spread `notificationVisibilityWhere` in feeds + public route |
| 16 | Student fee truth | (Partially addressed in Phase 7/14 — student fees banner is server-truth; module ledger documented R-entry) |
| 17 | Dashboard hooks | Retry/refresh capability + donut semantics fixed |
| 18 | Marketing claims | Copy moves to per-school CMS content; unverifiable defaults neutralized for non-configured schools |
| 19 | Plan semantics | Plan feature-matrix abstraction in access-policy (not billing — postponed per §24) |
| 20 | Events UI | (Documented as remaining; Calendar mock store is a data-honest register entry — out of this phase's critical path) |

**Do-not-do guardrails honored:** no Supabase/Vercel/Resend/payment-gateway connection, no secrets, no per-school codebases, Super Admin stays out of school login (Phase 5/6 — verify), no frontend-only tenant security (all new public surfaces resolve tenant server-side).
