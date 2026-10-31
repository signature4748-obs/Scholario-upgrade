# Scholario — Super Admin Control Center Transformation

## PHASE 1 — System Audit, Information Architecture & Foundation

Status: **Implemented (Phase 1 foundation)** · Branch: `feat/super-admin-control-center-phase1` · Base: `main @ e8aca39`
Scope of this document: the Super Admin ("platform console") school control plane. Phase 1 = audit + information architecture + safe navigation foundation. No schema changes, no API contract changes, no authorization changes.

---

## 1. Existing Super Admin architecture

### 1.1 Two planes, one codebase

The repo builds **two Vercel projects from one codebase**, selected by `SCHOLARIO_PLANE` (`src/lib/plane.ts:43`, fail-closed in production):

| Plane | Pages | APIs | Identity space |
|---|---|---|---|
| `platform` (Super Admin) | `/platform/*` — console under `src/app/platform/(console)/` | `/api/platform/*` (93 route files) | `PlatformAdmin` + `PlatformAdminSession` (disjoint tables, sha256-hashed tokens, 4 h TTL) |
| `school` (tenant) | `/s/[slug]` door → `/?tenant=<slug>` renderer; principal/teacher/student panels | ~243 school API route files | `User` (canonical roles `PRINCIPAL | TEACHER | STUDENT`) + `Session` (`erp_session`) |

`src/middleware.ts:205-235` makes each plane 404 the other's routes; `:272-290` guarantees only the platform cookie/header satisfies `/api/platform/*` (a school session is never consulted), and `:292-315` redirects unauthenticated console pages to `/platform/login` in production. Support sessions (`SupportSession`, read-only, time-boxed) are a third token space.

### 1.2 Console shell and navigation

- Layout chain: `(console)/layout.tsx` → `console-root.tsx` → `src/components/platform/console-shell.tsx` (734 LOC).
- Sidebar nav is a hardcoded `NAV_GROUPS` array (`console-shell.tsx:97-137`): Overview, Schools, Subscriptions, Plans & Pricing, Payments & Gateways, Access Codes, Users & Access, Support, Announcements, Reports & Audit, Audit Log, Settings, My Sessions, Operations — each with an optional platform permission used for UX-only filtering (`:560-584`).
- Responsive: 260 px/72 px collapsible sidebar on desktop, hand-rolled drawer `<lg` (`:627-661`), pinned header, single content scroller (`[data-console-scroll]`).
- Every console page is a thin wrapper (9–17 LOC); real modules live in `src/components/platform/modules/*`.

### 1.3 The school control plane today (pre-Phase 1)

`/platform/schools/[id]` rendered **`school-detail.tsx` (3,071 LOC)** — a `?tab=`-driven Radix workspace with **6 operator groups** (§7 IA) over **12 anchored sub-sections**:

| §7 group | Sub-sections | Key children |
|---|---|---|
| Overview | next actions · profile · activity | `NextActionsCard` |
| Configuration | setup & readiness · profile & metadata · modules & admissions · identity & branding · custom domains | `school-setup.tsx` (347), `school-identity-requests.tsx` (485), `school-domains.tsx` (407) + inline editors |
| Access & users | access & sign-in · users | `AccessCard`, `SessionsCard`, `StudentAccessCard`, `school-users.tsx` (411) |
| Subscription | subscription (5 nested sub-tabs) · fee gateway | `school-subscription.tsx` (**3,108**), `school-payment-gateway.tsx` (173) |
| Support & audit | one task-focused surface | `support-audit.tsx` (1,208) |
| Advanced | danger zone | inline (activate / suspend / typed-confirmation delete) |

Supporting machinery: URL `?tab=` state with legacy-key healing (`school-detail.tsx` URL→state effect), `LEGACY_TAB_REDIRECT` for every historical tab key, `GroupSection` anchored sub-sections, `useStepUpGate` on destructive ops, `platformApi` envelope client.

School creation is a separate **7-step full-page wizard** (`provision-wizard.tsx`, 2,815 LOC) at `/platform/schools/new` performing **one atomic `POST /api/platform/schools`** (school + subscription + principal + optional bootstrap classes/subjects/rooms + optional domain, all-or-nothing).

### 1.4 What already works well (kept as the foundation)

- `computeSetupReadiness` (`src/lib/school/setup-readiness.ts`) — ONE DB-computed readiness document (11 sections, required/optional, `usable` verdict) served to both planes (`/api/platform/schools/[id]/setup-readiness`, `/api/school/setup-readiness`) with a parity test (`tests/api/school-setup-readiness.test.ts`).
- Module gating vocabulary: `school.featureFlags[key] ?? PlatformSetting.modules[key] ?? true` (`src/lib/platform/module-flags.ts`), server gate `assertModuleEnabled`.
- `withPlatform({permission})` single platform authz pipeline + `PLATFORM_PERMISSION_KEYS` registry + step-up policy hook + per-admin mutation rate limit (`src/lib/platform/authz.ts`).
- Audit funnels: `platformAuditEvent` (no-FK `PlatformAuditLog`, survives tenant deletion) and school-plane `auditEvent` (sanitized).
- Tenant isolation: DB default-deny RLS + 32 same-school tenant-guard triggers + deep live-HTTP isolation suites.
- Honest data culture: no mock data in operator surfaces; degradation states (schema-pending banners, honest-empty states) are explicit.

### 1.5 What is fragmented / duplicated / hardcoded (audit findings)

| Finding | Evidence | Impact |
|---|---|---|
| "Configuration" was a catch-all mixing first-time setup with ongoing governance | `school-detail.tsx` configuration group ≈ 890 inline LOC + 3 children | onboarding feels like enterprise configuration |
| Tab-in-tab violation | `school-subscription.tsx:206` renders 5 nested tabs inside a group despite the workspace's "never tab-in-tab" rule | IA inconsistency |
| Duplicated unexported helpers | `timeAgo` ×5, `StatusBadge` ×4, `EmptyState` ×2 across modules | drift risk |
| `FLAGGABLE_MODULES` vocabulary duplicated | `school-detail.tsx` vs `settings.tsx` MODULE_LABELS; school-side `modules-tab.tsx` labels 10 modules while only 5 are flaggable | confusing module story |
| Oversized modules | school-subscription 3,108 · school-detail 3,071 · provision-wizard 2,815 LOC | maintainability |
| Three announcement universes | `Notification` (internal), `WebsiteNotice` (public CMS), `PlatformAnnouncement` (platform) | readiness "website" signal counts the wrong one |
| Fee-head catalogues ×2 | DB `MasterFeeHead` vs client-store `fees.feeHeads` (documented, honest) | dual source for the same concept |
| Branding editors ×2 with different validation strength | school path enforces WCAG contrast ≥ 3.5:1 (`school-config.ts:151-159`); platform `PATCH /api/platform/schools/[id]` checks hex only | gap, pre-existing |
| Timetable settings write-only | `settings.timetable` slice never consumed; ladder hardcoded (`src/lib/timetable/config.ts:54-64`) | config theater |
| Admission wizard config client-only | field rules / seat capacity / doc policy live in the client store only | lost on device switch |
| Certificates/documents are demo-tier | templates + generated docs live in localStorage; no DB model, no versioning | Phase 3 target |
| Plan-driven module entitlements dormant | `SubscriptionPlan.modules` stored/edited but never read by the resolver | Phase 3 decision |

---

## 2. Complete inventory of existing configuration features

Status legend: ✅ complete · 🟡 partial · 🔴 client-only / demo-tier. "Controller" = who can actually change it today.

| # | Feature | UI (platform console) | UI (school app) | Controller | Status |
|---|---|---|---|---|---|
| 1 | School identity (name, code, slug, board, academic year, record prefix) | Setup → School profile & metadata (inline editor) | read-only; changes via request workflow | Platform (legal identity); principal requests | ✅ |
| 2 | Contact & location (address, city, district, state, pincode, country, timezone, phone, email) | Setup → metadata editor (state/district/pincode/country/timezone persisted in `School.settings` JSON) | Settings → School Profile | Platform (this editor); principal via `/api/school-settings` | ✅ |
| 3 | Principal account & credentials | Manage → Access & sign-in (re-issue, access/reset) | login door; forced first change | Platform issues; school owns the account after | ✅ |
| 4 | Branding (theme/accent colors, short name, tagline) | Setup → metadata color fields | Settings → Branding (contrast-checked, logo/favicon via scoped upload) | Both (school path is the stronger validator) | 🟡 duplicated validation |
| 5 | Logo / favicon | — (via school settings upload) | Settings → Branding | School | ✅ |
| 6 | Academic structure (classes, sections, subjects, class teachers) | read-only counts only | Classes module + `/api/principal/academic` | School principal | ✅ |
| 7 | Streams (`Class.stream`) | — | — (no write path; seed-only) | — | 🔴 no management surface |
| 8 | Rooms | read-only counts | Settings → Rooms; Classes rooms manager | School principal | ✅ |
| 9 | Fee configuration (catalogue, structures + versioned publish, discounts) | — | Fee Management module | School principal | ✅ |
| 10 | Fee gateway (per-school Razorpay vault) | Manage → Fee gateway | — | Platform | ✅ |
| 11 | Examination configuration (types, grade scales, rules, admit/report card config) | — | Exams → Settings | School principal | ✅ |
| 12 | Timetable (period ladder, publish) | — | Timetable module + Settings slice (write-only) | School principal | 🟡 ladder hardcoded |
| 13 | Website CMS (12 sections, notices, gallery, admissions card, social links, media) | — | Website Management module | School | ✅ |
| 14 | Platform announcements | Announcements (console) | shown on school login pages | Platform | ✅ |
| 15 | Custom domains (add ≤10, TXT verification, delete) | Setup → Custom domains | read-only status card | Platform only | ✅ |
| 16 | Module availability (5 flaggable modules, override/master resolution) | Setup → Modules & admissions | read-only preferences | Platform (override) + platform master | 🟡 partial coverage |
| 17 | Admissions server-issued workflow flag + readiness | Setup → Modules & admissions (fail-closed, step-up) | Admission module operations | Platform enables; school operates | 🟡 wizard config client-only |
| 18 | Identity change requests (legal name/code/affiliation) | Setup → Identity & branding (approve/reject) | Settings → request ledger | Principal requests → Platform applies | ✅ |
| 19 | Access codes / subscriptions (plans, batch codes, entitlements, ledger) | Manage → Subscription (+ console-wide Subscriptions/Codes) | Subscription module (redeem) | Platform issues; school redeems | ✅ |
| 20 | People roster (teachers, staff, students) | Manage → Users (read-only) + staff entitlements | Teachers / Students modules | School writes; platform observes + credential lifecycle | ✅ |
| 21 | Student access pause/resume | Manage → Access & sign-in (step-up) | — | Platform | ✅ |
| 22 | Support sessions (read-only oversight) | Manage → Support & audit + console Support | visible marker to school | Platform | ✅ |
| 23 | School lifecycle (activate / suspend / reactivate / delete) | Manage → Danger zone | — | Platform (step-up) | ✅ |
| 24 | Setup readiness (11 sections, required/optional, usable verdict) | Setup → Setup & readiness + Overview summary | read-only document | derived (read-only) | ✅ |
| 25 | Document/certificate templates | — | Certificates module (client-store, Demo tag) | School (browser-local) | 🔴 no platform control, no persistence |
| 26 | Website domain verification cron / re-check | — | — | — | 🔴 manual only |

---

## 3. Route / API / database mapping (school control plane)

| Configuration surface | Route handler(s) | Prisma models |
|---|---|---|
| School CRUD + metadata PATCH + delete | `src/app/api/platform/schools/route.ts`, `schools/[id]/route.ts` (zod patch, per-field audit diffs, typed-name delete) | `School`, `PlatformAuditLog` |
| Provisioning (wizard submit) | `POST /api/platform/schools` (`provisionSchema` with cross-field `superRefine`) | `School`, `SchoolSubscription`, `User`, `TenantDomain`, `Class`, `Subject`, `Room` (one tx) |
| Setup readiness | `schools/[id]/setup-readiness` + school-plane `/api/school/setup-readiness` | reads counts across ~15 models via `computeSetupReadiness` |
| Feature flags (school overrides) | `schools/[id]/feature-flags` (validateFlagPatch) | `School.featureFlags` JSON |
| Platform module master | `/api/platform/settings` | `PlatformSetting.modules` |
| Admissions issuance flag | `schools/[id]/admissions-issuance` (readiness-gated) | `School.settings` + `FeeStructure` counts |
| Identity change requests | school `/api/school-settings/profile-change-request` → platform `schools/[id]/profile-change-requests[/requestId]` (transactional apply) | `SchoolProfileChangeRequest` |
| Custom domains | `schools/[id]/domains[/domainId][/verify]` (TXT `_scholario-verify.<host>`) | `TenantDomain` |
| Users / staff / student roster | `schools/[id]/users` (read-only), `/staff`, `/students` | `User`, `Teacher`, `Student`, `StaffEntitlement` |
| Credential lifecycle | `schools/[id]/reissue-credential`, `access/reset-credentials`, `student-access` | `User.mustChangePassword`, `credentialExpiresAt`, `subscriptionStatus` |
| Subscription & entitlements | `schools/[id]/subscription[/terms][/payments]`, `/api/platform/subscriptions/*` | `SchoolSubscription`, `SubscriptionPlan`, `PlatformPayment`, `ActivationCode(+Event)`, `StudentEntitlement`, `StaffEntitlement` |
| Fee gateway | `schools/[id]/payment-gateway`, `/api/platform/payments/gateway` | `SchoolPaymentGateway`, `PlatformGatewayConfig` (AES-256-GCM) |
| Support & audit | `/api/platform/support/*`, `school-sessions/*`, `/api/platform/audit` | `SupportSession`, `Session`, `PlatformAuditLog`, `ActivityLog` |
| School settings (school-side writes) | `/api/school-settings` (identity/branding/settings fragments, contrast check, audit) | `School` columns + `School.settings` JSON |

Schema facts any future phase must respect: **135 models**, 100 with `schoolId`; additive-only versioned migrations (`prisma/migrations`, Postgres); `db:push`/`db:reset` are guarded scripts that refuse production; raw-SQL index families (`_trgm` ×24, `_schoolId_idx` ×11) are counted by the CI drift gate.

---

## 4. Existing role and permission architecture

**Platform plane** (Super Admin): capability registry `PLATFORM_PERMISSION_KEYS` (`src/lib/platform/permissions.ts:18-40`) — `schools.read/manage/provision`, `billing.manage`, `billing.complimentary`, `announcements.manage`, `settings.manage`, `audit.read`, `support.access`, `admins.manage`, `ops.read`; root grants all. Enforcement: `withPlatform({permission, stepUp?})` wraps every non-public platform route (99 usages); destructive actions are policy-tabled in `DESTRUCTIVE_ACTIONS` and require step-up + reason. MFA/step-up currently **stood down** behind `PLATFORM_TOTP_ENABLED` (`mfa-config.ts:26-28`) — the gate is dormant, not removed.

**School plane**: canonical roles only — `PRINCIPAL | TEACHER | STUDENT` (`CANONICAL_SCHOOL_ROLES`, legacy vocabulary refused at login); central server matrix `PERMISSIONS` (`src/lib/security/permissions.ts:69-125`, fail-closed `can()`); helpers `withUser` (session + tenant + forced-password + entitlement gates) and `withAuthz` (adds permission + tenant assertions). Client mirrors (`usePlatformSession().can`, `src/lib/permissions.ts`, `src/lib/nav/role-nav.ts`) are UX-only — **hiding a button is not authorization**; every restricted operation is enforced server-side.

**Module flags are product toggles, not a security boundary** (`PLATFORM_SECURITY_MODEL.md §11`): fail-open resolution, enforced at 5 module root routes via `assertModuleEnabled`. Entitlement (subscription state) IS security: `evaluateTenantEntitlement` in `withUser` is fail-closed with an explicit exempt-prefix list.

---

## 5. Ownership and control matrix (proposed vs actual)

The task's proposed ownership table, checked against the code. Where reality differs, **reality wins in Phase 1** and the delta is queued for later phases.

| Configuration | Initial setup | Routine management (proposed) | Actual today (verified) | Delta / action |
|---|---|---|---|---|
| School identity (legal name/code/affiliation) | Super Admin | School, with governance restrictions | ✅ matches: platform sets at provisioning; principal can only file `SchoolProfileChangeRequest`; platform approves transactionally | none — keep |
| Contact & location | Super Admin | School | Platform metadata editor writes directly; school can write the same fields via `/api/school-settings` | align validation strength (contrast gap); Phase 2: single source |
| Logo and branding | Super Admin | School | School owns (contrast-checked, scoped uploads); platform can edit colors with weaker validation | add contrast check to platform PATCH (small fix) |
| Academic structure | Super Admin | Principal / school staff | School principal owns fully; platform is read-only (counts) | matches "school operates" principle — platform stays read-only |
| Teachers and students | Initial setup | School | School owns rosters; platform holds credential/lifecycle + read-only roster | keep |
| Role assignments | Initial configuration | Authorized school administrators | School principal assigns class-teacher/subject-teacher (CSA); canonical roles only | keep; Phase 3 documents role registry |
| Platform master modules | Platform Admin | Platform Admin | `PlatformSetting.modules` via console Settings | matches |
| School module overrides | Super Admin | Authorized platform/school controls | Platform-only toggles (`schools.manage`) on `School.featureFlags` | matches; expand coverage in Phase 3 registry |
| Document templates | Platform Admin | Platform Admin; school-specific choices where supported | **No platform or DB template system exists** (client-store, demo-tier) | Phase 3 introduces the template registry (see §9) |
| School website content | Initial configuration | School | School owns Website Management; platform only provisions the toggle/slug | matches |
| Domain verification | Platform/Super Admin | Authorized domain workflow | Platform-only add/verify/delete; school read-only | matches |

Per-field governance metadata (owner / view / edit / platform lock / school override / step-up / audited): the platform paths already audit every mutation (`platformAuditEvent`, 118 call sites) and gate destructive ops with step-up; school paths audit via `auditEvent`. Platform-level **locking** of school-editable fields exists only for legal identity (request workflow); branding locks do not exist (documented as a Phase 3 option, not built now).

**Guardrail honored:** no existing check was weakened, moved client-side, or bypassed. The Phase 1 regroup is presentational only.

---

## 6. Proposed Overview / Setup / Manage navigation (implemented in Phase 1)

The school workspace (`/platform/schools/[id]`) now presents exactly **three primary destinations**:

```
/platform/schools/[id]                      ← workspace (default → Overview)
  ├─ ?tab=overview   OVERVIEW   read-only dashboard
  ├─ ?tab=setup      SETUP      first-time configuration + identity governance
  └─ ?tab=manage     MANAGE     ongoing operation & oversight

Stable route handles (307 → canonical ?tab= destinations):
  /platform/schools/[id]/overview
  /platform/schools/[id]/setup
  /platform/schools/[id]/manage
```

| Destination | Responsibility | Sub-sections (anchors, unchanged ids) |
|---|---|---|
| **Overview** | DB-backed dashboard: status & provisioning state, setup completion (required X/Y from the readiness document), effective module availability, school profile, recent tenant activity, next actions (deep-links to the acting section) | next actions · setup & modules summary · profile · recent activity |
| **Setup** | "Setting up a school, not configuring enterprise software": guided readiness progress, editable record, module/admission governance, identity protection, domains | `section-setup` (readiness) · `section-metadata` · `section-modules` · `section-identity` · `section-domains` |
| **Manage** | Centralized ongoing control beside Overview | `section-access` (doors, credentials, live sessions, student-access pause) · `section-users` (read-only roster) · `section-subscription` · `section-gateway` · `section-support`/`section-audit` (one surface) · `section-danger` |

Implementation notes:
- Destination keys are canonical `?tab=` values; **every** historical key (§7 groups + pre-§7 12-tab keys) still resolves via `LEGACY_TAB_REDIRECT` in the new pure module `src/components/platform/modules/school-detail-tabs.ts`, landing on the exact owning sub-section. Cross-module callers (`subscriptions.tsx`, `reports.tsx`, `school-subscription.tsx`, `school-setup.tsx`, NextActionsCard) keep working unchanged.
- Visibility: Overview + Setup always (server still authorizes every action inside); Manage appears only when the viewer holds at least one of `billing.manage` / `support.access` / `audit.read` / `schools.manage` (`availableControlCenterGroups`).
- PURE REGROUPING rule preserved: every capability, permission check, step-up gate and audit hook survived unchanged; nothing was deleted; children render as titled anchored sub-sections (never tab-in-tab at the top level — the pre-existing nested tabs inside `school-subscription.tsx` are untouched and queued for Phase 3).
- Overview's two new summary cards read the SAME facts already served by `GET /api/platform/schools/[id]` (`provisioning.readiness`) and `School.featureFlags` — **zero new API calls, no mock data**, honest "unavailable" state when the readiness summary is absent.

## 7. Proposed Manage sub-section hierarchy (target, phased)

Phase 1 ships the Manage sections that exist today. The target structure below maps every group from the task brief onto reality — with the explicit rule that **the school owns routine operations**; the Super Admin governs and observes, and never receives a duplicate control surface for school-owned daily work.

| Target group (task brief) | Reality today | Phase 1 state | Later phase |
|---|---|---|---|
| 1. School Profile & Identity | metadata editor + identity requests + domains + branding | Setup owns these (identity governance belongs with setup; avoids duplicate editors) | Phase 2 may add read-only summary links from Manage |
| 2. Academic Management | school-owned (Classes/Subjects/`principal/academic`) | **not duplicated** — platform stays read-only | Phase 3: read-only academic inventory card (classes/sections/subjects/rooms counts + links into the school app) |
| 3. People & Roles | read-only roster + credential lifecycle | ✅ `section-access` + `section-users` | Phase 3: role-assignment inventory (who holds what), still read-only |
| 4. Access & Feature Controls | module toggles + admissions flag | Setup → `section-modules` (single home) | Phase 3: feature registry view (searchable, role-wise) |
| 5. School Modules | fees/exams/timetable/homework/library/transport operate school-side; platform gates availability | availability toggles only (5 flaggable) | Phase 3: registry-driven coverage of the full module catalogue |
| 6. Documents & Templates | client-store only (demo) | not present (honest) | Phase 3: template registry + lifecycle (§9) |
| 7. Website & Domains | domains = platform; content = school | ✅ domains in Setup; website toggle in Access card | Phase 3: website health summary (published notices, gallery, domain status) |
| 8. Platform Governance | audit + support sessions + danger zone | ✅ `section-support`/`section-audit` + `section-danger` | Phase 4: configuration change history (field-level diffs already in audit metadata) |

## 8. Feature registry architecture (design, not built in Phase 1)

Goal (Phase 3): one searchable registry answering "which role sees which feature, and why".

- **Stable identifiers**: extend the existing vocabulary in `src/lib/platform/module-flags.ts` (`FLAGGABLE_MODULES`) into a `FEATURE_REGISTRY` of `{ id, label, plane, module, defaultEnabled, roles[], docs }`. No new authorization mechanism: the registry is **metadata about existing checks** (`can()`, `assertModuleEnabled`, entitlement evaluation), not a parallel one.
- **Resolution order (unchanged semantics, documented)**: school override → plan declaration (currently dormant — `SubscriptionPlan.modules` exists but is unread) → platform master → default. Locks vs disables: a *locked* feature renders read-only with the reason (platform master or plan), a *disabled* one is off for the school; both remain server-enforced.
- **Server enforcement**: `assertModuleEnabled` stays the gate; the registry adds coverage (sub-routes currently unguarded) and an audited admin API for overrides — reusing `withPlatform({permission})` + `platformAuditEvent`.
- **UI**: a searchable Manage view (id, label, state, source of truth, per-role availability) rendering the registry — plus per-role route maps derived from `src/lib/nav/role-nav.ts` and the school-panel nav configs.
- **Non-goal**: hiding server checks behind the registry, or making UI visibility authoritative.

## 9. Template management architecture (audit + design, not built in Phase 1)

Current state (verified): every document is rendered client-side (jsPDF or HTML print). Marksheet/report-card/admit-card **section toggles** are DB-backed (`ReportCardConfig`, `AdmitCardConfig` — per-school singletons); certificate/TC/ID-card/bonafide layouts are **hardcoded in TS** with client-store variants (`certificates-store.ts`, localStorage, `Demo` tag); generated documents are **not persisted** and reference no template version; the only version stamp anywhere is `BLANK_FORM_VERSION = 'AF-2026.3'` printed on admission forms; receipt numbering is client-side.

Proposed lifecycle (Phase 3, additive schema, reviewed migrations):

```
DocumentTemplate(id, schoolId?, type, version, status DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED,
                 payload JSON, createdBy, activatedAt, retiredAt)
GeneratedDocument(id, schoolId, type, templateId, templateVersion, payloadHash, fileRef?, createdAt)
```

- **Publish is immutable**: activating a version repoints the per-(school,type) Active pointer; editing never mutates a published version; rollback = repoint. Retired versions stay resolvable so **previously generated documents keep their original template/version reference**.
- **Validate**: schema check + required-field probe against a sample school payload; **Preview**: server-side render of the sample before publish.
- Rendering stays the existing engines in Phase 3 (no new template engine unless a blocking defect appears); the registry adds persistence, versioning, audit (`platform.*` events) and platform-master vs school-variant scoping (`schoolId` null = platform master).

## 10. Required future schema / API changes

**Phase 1: none.** No migration, no API contract change, no new endpoint. Future (each additive + reviewed, in dependency order):

1. Phase 2 — none expected (reuse readiness + metadata + flags APIs); optional: platform branding PATCH contrast check (validation-only tightening).
2. Phase 3 — `DocumentTemplate` + `GeneratedDocument` models; `FEATURE_REGISTRY` (table or `PlatformSetting` JSON — decision gate); server persistence for admission wizard configuration (`School.settings` or dedicated model); optional timetable settings consumption decision (consume the slice or remove it honestly).
3. Phase 4 — optional consolidation of the three announcement universes (keep all three APIs; unify the *readiness* signal); audit-viewer field-diff surfacing.

## 11. Security risks and mitigations

| # | Risk (all pre-existing unless noted) | Mitigation |
|---|---|---|
| 1 | MFA/step-up **stood down** (`PLATFORM_TOTP_ENABLED` unset): destructive-action step-up gate is dormant | Do not remove gates while simplifying UI (Phase 1 kept every `gate()` call); re-enabling TOTP is an operator decision, documented |
| 2 | Module flags fail-open and shallow (5 root routes gated; sub-routes not re-gated) | Phase 3 registry extends coverage; until then treat flags as UX, entitlement as the real boundary |
| 3 | Platform branding PATCH skips the contrast validation the school path enforces | Queued small fix (Phase 2); does not block Phase 1 |
| 4 | Central tenant scope helpers nearly unused; isolation enforced by per-route convention (~174 hand-rolled `findFirst({schoolId})`) | Keep new code on the convention (`withPlatform` + server-fetched `School` row); DB triggers + RLS backstop; never trust client `schoolId` |
| 5 | Pre-existing non-transactional three-step writes in `platform/auth/change-password` (F1) and recovery confirm (F2) — from the PR #68 independent review (P3, non-blocking) | Out of Phase 1 scope; tracked for a dedicated fix |
| 6 | Public website media bucket is public; gate route decides who *learns* URLs | Documented tradeoff; hardening option (private bucket + signed gating) in Phase 4 |
| 7 | Dev-only bearer/`x-platform-token` transports active in any non-production env (previews) | Keep prod-only page boundary; never relax plane gates |
| 8 | Docs drift (PLATFORM_CONTROL_PLANE §2/§3 "mandatory TOTP", PLATFORM_SECURITY_MODEL §1 raw tokens, CUSTOM_DOMAINS school-side flow, TENANT_AWARE_WEBSITE_MODEL fallbacks, DATA_SOURCE_MAP SQLite) | Phase 4 documentation sweep; this document states verified reality |
| 9 | Client-side stores (`school-settings-store`) can masquerade as state of record | Server is authority (`school-config.ts` validators); UI re-hydrates from `GET /api/school-settings` |

## 12. Phase 2 implementation plan — Overview & Setup experience

1. **Overview as the operator's landing truth**: unify metric sources (counts, readiness, entitlement, attention reasons) into the existing detail GET (extend, don't add, endpoints); alerts from `OperationalError`/`PlatformAlert` where school-relevant; honest empty states.
2. **Setup as a guided flow**: wizard-style stepper *view* over the existing readiness sections (same document both planes already share): identity → principal → academic → people → financial → appearance → modules; each step deep-links to the single owning editor (no duplicated forms).
3. Single-source alignment for contact/branding editors (one writer per field; platform PATCH gains the contrast check).
4. Route promotion decision gate: move Setup content to `/platform/schools/[id]/setup/*` real routes once step-level URLs are needed (handles already exist and redirect).
5. Searchable section index for Setup (client-side filter over sub-sections).
6. Acceptance: readiness parity tests extended; E2E "first 30 minutes of a new school" journey; no schema change.

## 13. Phase 3 implementation plan — Manage depth (registry, people, templates)

1. **Feature registry** (§8): registry data + admin override API + Manage registry view (searchable, role-wise, state-source badges); extend module-flag coverage to sub-routes; decide plan-modules wiring (activate `SubscriptionPlan.modules` in the resolver or remove the field honestly).
2. **People & Roles governance**: read-only role-assignment inventory (CSA appointments, class teachers, staff coverage roles), credential-state views; still zero school-operation duplication.
3. **Documents & Templates**: implement §9 (models, lifecycle APIs, Manage registry UI, preview, publish/retire/rollback, generated-document persistence with version references); certificates module migrates from localStorage behind a flag; admission settings server persistence.
4. **Website & domains health**: read-only CMS status card; domain re-verification cron (reuses ops center patterns).
5. Decompose `school-subscription.tsx` (3,108 LOC) nested tabs into Manage sub-sections (removes the tab-in-tab violation); extract shared `EmptyState`/`StatusBadge`/`timeAgo`.
6. Acceptance: registry unit + isolation tests; template lifecycle tests (immutability, rollback, version references); UI render tests.

## 14. Phase 4 implementation plan — Platform governance & consolidation

1. **Configuration change history**: field-level diff view over `PlatformAuditLog.metadata` (already recorded per-field); per-school governance timeline joining platform + school audit surfaces.
2. **Announcement signal unification** (readiness counts the right universe; APIs unchanged).
3. **Security close-out**: re-evaluate TOTP enablement; public-media hardening decision; docs sweep (§8-listed stale docs rewritten to verified reality).
4. **Console IA alignment**: school-list/directory entries adopt the Overview|Setup|Manage deep links; breadcrumb reflects destinations; legacy `/platform/audit` alias re-audited.
5. **Decomposition debt**: school-detail.tsx split per destination (each ≤ ~800 LOC) using the stable route handles.
6. Acceptance: full battery (unit + security + tenant isolation + E2E) green; migration drift gate clean; docs updated.

## 15. Known limitations and unresolved questions

1. **MFA stand-down** — step-up gates are dormant; re-enabling is an operator decision (env), not a code change.
2. **Module flag coverage** — only 5 modules flaggable; client labels advertise 10; registry (Phase 3) resolves the vocabulary, not Phase 1.
3. **`SubscriptionPlan.modules` dormant** — stored, editable, unread; activate-or-remove decision deferred to Phase 3.
4. **Streams have no management surface** (seed/read-only `Class.stream`).
5. **Admission wizard configuration is client-store only** until Phase 3 persistence.
6. **Certificates module is demo-tier** (localStorage, client counters, `CERT_YEAR='2026'`) until the Phase 3 registry.
7. **Timetable settings slice is write-only** (hardcoded ladder); consume-or-remove decision in Phase 3.
8. **Three announcement universes coexist** by design; readiness counts `Notification`, not `WebsiteNotice`.
9. **Two-project topology**: in `unified` preview deployments both planes share one origin — the console's page-level auth boundary is dev-only by design; production is always two planes.
10. **Unresolved questions for the owner**: (a) should platform master module defaults live in code or `PlatformSetting` only? (b) should school-side routine branding changes require platform *notification* (audit-only) or approval for legal fields only (current)? (c) target hosting for template files (DB JSON vs Supabase Storage objects) at Phase 3 build time.
11. **Local verification boundary**: the full DB-backed security/E2E battery runs in CI (Postgres 16 service + live dev server); this branch's local run covered typecheck, lint, unit (incl. new suite), route-inventory, and the production build.
