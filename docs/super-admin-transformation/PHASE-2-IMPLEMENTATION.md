# Scholario — Super Admin Control Center Transformation

## PHASE 2 — Simple School Setup Wizard (Guided First-Time School Onboarding & Configuration)

Status: **Implemented — ready for review** · Branch: `feat/super-admin-school-setup-phase2` · Base: `main @ 5ff4d1e` (Phase 1 merge commit)
Companion documents: `PHASE-1-ARCHITECTURE.md` (foundation audit), `PHASE-1-INDEPENDENT-REVIEW.md` (independent review), `PHASE-1-IMPLEMENTATION.md`.

Scope: ONE guided, persistent, database-backed onboarding workflow inside the Setup destination of the school workspace (`/platform/schools/[id]?tab=setup`). No schema changes. No new permission system. No duplicate onboarding system — the wizard orchestrates the platform's EXISTING services and adds exactly the eight write paths the platform lacked.

---

## 1. Existing services reused (nothing rebuilt)

| Capability | Reused implementation | How the wizard uses it |
|---|---|---|
| Progress oracle | `computeSetupReadiness` (`src/lib/school/setup-readiness.ts`) — the ONE DB-computed readiness document shared by both planes | The wizard's step states derive from it (`deriveWizardSteps`); zero client-side counters |
| Metadata writer | `PATCH /api/platform/schools/[id]` (`schools.manage` + step-up, per-field audit) | Identity + Branding steps save through it — **extended additively** (see §4) |
| Principal credential | `POST …/reissue-credential` (step-up, one-time bootstrap, 48 h window, audited) | Principal step's "Re-issue one-time credential" |
| Lifecycle transition | `POST …/activate` (`schools.manage`) | The final **Activate School** action — **extended** with server-side revalidation (§6) |
| Module toggles | `feature-flags` PATCH + `validateFlagPatch` + `effectiveModuleFlags` (`FLAGGABLE_MODULES`) | Modules step — the SAME resolver (school override → platform master → default) |
| Admissions flag | `admissions-issuance` GET/PATCH (fail-closed + readiness) | Modules step switch |
| Custom domains | Existing `domains` routes (add ≤10 / TXT verify / delete) | Linked from the Website step — never duplicated |
| Upload pipeline | `WEBSITE_UPLOAD_POLICY` + `sniffFileType` (magic-byte) + `storageUpload` (Supabase `public-media`, `website/<schoolId>/<fileId>`) + `UploadedFile` ownership registry + `/api/public/website/media` privacy gate | New platform logo route uses the EXACT pipeline — no second asset system |
| Credential policy | `resolveProvisionedPassword` / `generateTempPassword` / `bootstrapCredentialExpiresAt` (`src/lib/account-provisioning.ts`) + `hashPassword` | Initial-staff onboarding follows the established convention |
| Subject codes | `subjectCodeOf` — **extracted** from the provisioning route into `src/lib/platform/subject-code.ts`, now imported by BOTH provisioning and the wizard (one vocabulary, zero drift) | Academic bootstrap |
| Website CMS | `School.websiteContent` + `WebsiteContent`/`mergeWebsiteContent` (`src/lib/website-content.ts`) + the school-side SECTION_KEYS/32 KB contract | Website step seeds hero/about/contact/seo as a fragment over the SAME document |
| Settings JSON vocabulary | The exact keys provisioning writes (`state`, `district`, `pincode`, `country`, `timezone`, `workingDays`, `websiteEnabled`) | Identity/Academic/Website steps write the SAME keys |
| Authz / audit / validation | `withPlatform({permission, stepUp?})`, `platformAuditEvent` (`platform.*` actions), `parseJsonBody`/`strictBody`/`safeText`/`emailSchema`/`phoneSchema`, `clientIpFromHeaders` | Every new route, unchanged posture |
| Provisioning patterns | server-side dedupe for classes/sections/subjects, P2002→typed CONFLICT, tempPassword-surfaced-once | Academic bootstrap + initial staff |

**Deliberately NOT rebuilt:** readiness engine, module registry/permission system, storage, identity-change-request workflow, domain verification, fee structures/publish, exam execution, rosters, invitation tokens (the `mustChangePassword` + 48 h bootstrap convention is reused, no new token table).

## 2. Wizard architecture

```
/platform/schools/[id]?tab=setup
  ├─ GroupSection #section-setup ────────── SchoolSetupWizard  (NEW, guided flow)
  │    1 identity   2 branding   3 academic   4 principal   5 people*
  │    6 fees*      7 exams*     8 website*  9 modules*     (* = optional)
  │    Review & Activate (strict server-validated activation)
  ├─ GroupSection #section-setup-readiness ─ SchoolSetupTab (readiness document, unchanged)
  └─ … existing governance editors (metadata · modules · identity · domains) — the
       single ongoing home for each domain after handover
```

- **One aggregate read**: `GET /api/platform/schools/[id]/setup-wizard` returns school snapshot + full readiness doc + derived 9-step state + activation verdicts + principal access state + module resolution + website slice + canonical doors. Everything is computed live; **the wizard has no progress table and no client-side state of record**.
- **Pure state model**: `src/lib/platform/setup-wizard-state.ts` (no DB, no React) — `WIZARD_STEP_IDS`, `deriveWizardSteps`, `computeActivationRequirements`, `identityCoreComplete`. One derivation consumed by the wizard UI (guidance), the setup-wizard route (reporting) and the activate route (enforcement) — a client can never assert completion.
- **Step statuses**: `not_started | in_progress | completed`, derived from persisted data only. Required steps (identity, academic, principal) are the wizard's activation checklist; branding/people/fees/exams/website/modules are explicitly optional (school-owned routine work after handover).
- **Overview**: `NextActionsCard` gains a "Continue guided setup" action for `PENDING_ACTIVATION` schools with incomplete required readiness; the workspace reloads after every wizard save (`onChanged → reload`), so Overview/Manage always show the live configuration (they already read the same DB-derived dossier — no copied state).

## 3. Step-by-step workflow

| # | Step | UI collects | Writes through |
|---|---|---|---|
| 1 | School identity (REQUIRED) | official name, display name, board, address, city, district, state, postal code, country, phone, email, website, established year | `PATCH /api/platform/schools/[id]` (columns + `settings` fragment) |
| 2 | Branding (optional) | logo upload + preview, favicon, primary/secondary colors, display name, tagline | `POST …/branding-logo` + `PATCH /api/platform/schools/[id]` |
| 3 | Academic configuration (REQUIRED) | academic year (`YYYY-YYYY`), working days, classes + sections + optional streams (preset chips, per-school selection), subjects | `POST …/academic-bootstrap` |
| 4 | Principal account (REQUIRED) | confirm name/mobile; re-issue one-time credential; shows credential state, invite delivery, school door URL | `PATCH …/principal` + existing `reissue-credential` |
| 5 | Teachers & staff (optional) | batch teacher rows (name, email, phone, department, subjects) | `POST …/initial-staff` |
| 6 | Fees configuration (optional) | fee-head catalogue rows (name, category, frequency, amount, mandatory) | `POST …/initial-fee-catalogue` |
| 7 | Examination configuration (optional) | exam types (name, code) + grade bands (grade, min %, max %) | `POST …/initial-exam-config` |
| 8 | Website & presence (optional) | website on/off, headline/accent/description, about, contact; links to the domains governance section | `PATCH …/website-presence` |
| 9 | Modules & initial access (optional) | the 5 flaggable modules with source badges (school override / platform master / default) + server-issued admissions switch | existing `feature-flags` + `admissions-issuance` routes |
| — | Review & Activate | all 9 persisted states + strict checklist with exact fixes | `POST …/activate` `{requireComplete: true}` |

UX: step list with 44 px touch targets, per-step Required/Optional chips, honest empty states, save indicators via toasts + refreshed server state, `Save and continue` / `Save` / `Back` (state persists server-side on save; reopening a step re-reads the server truth — refreshing or navigating away loses nothing saved), confirm dialog before the irreversible activation, mobile-responsive single-column forms, iPad/desktop grids.

## 4. Database and API mapping

**Schema changes: NONE. Zero migrations.** Every wizard write lands in existing columns/JSON slices (`School.*`, `School.settings`, `School.websiteContent`, `Class`, `Subject`, `User`, `Teacher`, `MasterFeeHead`, `ExamTypeConfig`, `GradeScale`). The drift gate and migration chain are untouched (CI: 32 migrations, deploy + raw-SQL-index drift gate).

| Route (all under `/api/platform/schools/[id]`) | Method | Permission | Purpose |
|---|---|---|---|
| `setup-wizard` | GET | `schools.read` | Aggregate wizard state (read-only) |
| `branding-logo` | POST | `schools.manage` | Logo/favicon upload through the existing pipeline; sets `School.logoUrl`/`faviconUrl` in the same audited operation |
| `academic-bootstrap` | POST | `schools.manage` | Session year + working days + classes/sections/streams + subjects (idempotent, transactional) |
| `initial-staff` | POST | `schools.manage` | Teacher onboarding (all-or-nothing batch, forced-change credentials) |
| `initial-fee-catalogue` | POST | `schools.manage` | MasterFeeHead seeding (idempotent) |
| `initial-exam-config` | POST | `schools.manage` | ExamTypeConfig + GradeScale seeding (idempotent) |
| `website-presence` | PATCH | `schools.manage` | websiteContent fragment (hero/about/contact/seo) + `settings.websiteEnabled`; preserves all other CMS sections; 32 KB cap |
| `principal` | PATCH | `schools.manage` | Founding principal name/phone (email deliberately not writable) |
| `activate` (extended) | POST | `schools.manage` | Server-side revalidation + opt-in strict mode (§6) |
| `schools/[id]` (extended PATCH) | PATCH | `schools.manage` + step-up | + `shortName`, `tagline`, `website`, `established`, `settings{state,district,pincode,country,timezone}` — additive; per-field audit now covers `settings.*` |

New audit actions: `platform.school.academic_configured`, `platform.school.staff_onboarded`, `platform.school.fee_catalogue_seeded`, `platform.school.exam_config_seeded`, `platform.school.website_presence_updated`, `platform.school.branding_updated`, `platform.school.principal_updated`; the existing `platform.school.updated` / `platform.school.activated` gained richer metadata.

## 5. Save/resume implementation

- Every save is a server write → the UI re-fetches the wizard state → step status flips **only when the data is actually persisted** (the readiness engine recomputes from counts). Clicking Next alone never completes a section.
- Resume: reopening the Setup tab auto-opens the first incomplete step; every form initializes from the server truth.
- Idempotency by construction: academic bootstrap and the catalogue/exam seeders dedupe against the tenant's persisted rows (and in-batch duplicates) and report `skipped/duplicates`; staff onboarding reports duplicate emails instead of re-creating; activation is state-idempotent (`CONFLICT` on already-active).
- Transactions: academic bootstrap and staff onboarding run in one `db.$transaction` each (all-or-nothing, P2002→typed CONFLICT); no long-running or external I/O inside transactions (uploads write storage BEFORE the registry row + school update, mirroring the existing pipeline).

## 6. Readiness and activation rules

- **Progress** = the shared readiness document (5 required sections: identity, principal, academic, people, fees) + wizard-specific counts. `usable` semantics unchanged (ACTIVE + all required) — the wizard never redefines readiness.
- **Activation revalidation (new)**: every `activate` call recomputes the readiness document + principal presence from the live DB. The result is ALWAYS returned (`activation.missing`) and audited (`missingAtActivation`, readiness snapshot, `wizardStrict` flag).
- **Strict mode (opt-in)**: the wizard sends `{requireComplete: true}`; the server then hard-blocks (422, exact remaining list) until: a principal exists (always enforced), the identity core block (address+city+phone+email) is saved, and the academic structure (session year + ≥1 class) is persisted. People/fees/website/branding etc. never block activation (school-owned routine work, per the product's ownership model).
- **Lifecycle invariant preserved**: a bodyless `activate` (danger zone, existing journeys, all current tests) keeps the exact historical behavior — activation remains the sign-in unlock; strictness is an explicit wizard contract, not a new lifecycle state. Duplicate activation stays a typed `CONFLICT`.

## 7. Principal provisioning flow

Provisioning still creates the founding principal (role `PRINCIPAL`, forced password change, 48 h bootstrap window, invite email best-effort). The wizard: displays credential state (`BOOTSTRAP_PENDING`/`OWNED`) + invite delivery + last login; corrects name/phone (`principal` PATCH — email is the identity anchor, refused); re-issues the one-time credential through the existing step-up route when delivery failed or expired (fresh 48 h window, sessions revoked, tempPassword shown once in a dialog, never stored/emailed/audited in plaintext). Handover completes when the principal signs in and sets a personal password (existing `withUser` gate).

## 8. Security and tenant isolation

- Every route: `withPlatform({permission})` (+ step-up where the platform policy already requires it for metadata), rate-limited mutations, `platformAuditEvent`, fail-safe 404 for unknown school ids (no existence oracle, no client-supplied `schoolId` anywhere).
- The wizard is **platform-plane only**: school sessions (bearer/erp cookie) are never consulted on `/api/platform/*` (middleware guarantee, re-tested in the new isolation suite).
- Upload: magic-byte sniffing (client MIME never trusted), 4 MB cap, early 413, JPG/PNG/WebP only, `public-media` bucket path `website/<schoolId>/<fileId>`, `UploadedFile` registry row with `uploadedById: platform:<adminId>` (ownership traceable; bytes deleted if the registry insert fails).
- No plaintext secrets: staff `tempPassword` returned once per member (same convention as provisioning/credential-reset); never logged, never emailed, never in audit metadata. No weakening of any existing check; no parallel permission/module/template system; module availability stays a product toggle — role-wise authorization remains Phase 3.

## 9. School handover behaviour

After activation the wizard's success panel hands over explicitly: principal sign-in door (server-computed URL), the school owns people/fees/exams/timetable/website routine work, branding and profile remain school-editable within platform governance (legal identity via the request workflow), and the Super Admin keeps Overview/Manage visibility. No school-profile field is locked by the wizard; the ongoing editors below the wizard remain the single home for every domain (no duplicate ownership).

## 10. Tests and results

| Suite | File | Coverage |
|---|---|---|
| Unit (pure) | `tests/unit/setup-wizard-state.test.ts` — **15/15 pass** | 9-step catalogue/order, required-vs-optional classification, honest zero-progress, partial-contact `in_progress`, academic year+classes rule, catalogue/exam/override completion, activation requirements (non-strict blocks only on missing principal; strict = identity+academic+principal; people/fees never block) |
| API workflow | `tests/api/setup-wizard.test.ts` (live HTTP; CI) | Fresh honest state → identity save (+settings fragment) → strict activation 422 with exact missing item → academic bootstrap + replay (zero duplicates) → invalid input 422 → principal patch (email refused) → staff (tempPassword once, duplicate retry, 409 batch abort) → fee/exam idempotent seeding (+422 on inverted grade band) → website fragment preserving school-owned CMS sections → module override + refusal → strict activation 200 + audited + duplicate 409 → honest post-activation `usable=false` |
| Security/isolation | `tests/security/setup-wizard-isolation.test.ts` (live HTTP; CI) | School session refused (401) on read AND every write; anonymous 401; `schools.read`-only platform admin: read 200 / every write 403; unknown school id → 404 on all routes; upload magic-byte 415 + missing-file 400; junk activate body → 422 |
| E2E journey | `tests/e2e/setup-wizard-acceptance.test.ts` (live HTTP; CI) | Provision → honest wizard state → strict-activation refusal → operator saves identity+academics → strict activation (audited) → principal login + forced password change → school-plane readiness through the SCHOOL transport → dossier reflects ACTIVE + readiness progression |
| Regression (existing, untouched) | provisioning/replay/readiness-parity/control-center-tabs/route-inventory suites | Activate-without-body behavior unchanged (platform-provisioning, provisioning-reliability, provisioning-acceptance journeys unaffected); Phase 1 tabs vocabulary additive-only |

**Local verification (this sandbox, no Postgres — the documented boundary):**
- TypeScript: **clean** (`tsc --noEmit`)
- Lint: **0 errors / 64 warnings** (exactly the pre-existing baseline; zero new)
- Unit: **486/486 pass** (was 471; +15 new wizard tests)
- Route inventory: **11/11 pass** (hermetic; all 8 new routes resolve)
- Production build: **success** (`SCHOLARIO_PLANE=platform` — same env CI uses; 241/241 pages)

**CI (Postgres 16 + live dev server) owns the DB-backed battery** — the wizard API/security/E2E suites plus the full 2000+ test regression and the migration deploy + drift gate, exactly as Phase 1 documented.

## 11. Known limitations

1. **Streams have no school-side management surface** (pre-existing); the wizard can SET the initial stream per class (schema-supported vocabulary), but later stream edits remain a school-plane gap.
2. **Students are not onboarded by the wizard** — by design: admissions are school-owned (direct admits or the flag-gated server-issued workflow). `people` readiness still requires teachers AND students for `usable`.
3. **Fees stop at the catalogue** — per-class structures, versions and publishing remain the principal's routine work (the publish flow stays fail-closed on the session year the wizard sets).
4. **Principal email is immutable in the wizard** — it is the global-unique identity anchor; changing it needs a deliberate future flow (invite/credential semantics).
5. **Website step is a seed, not a builder** — full CMS remains the school's Website Management module; domain verification stays in its existing platform workflow.
6. **Wizard progress has no standalone table** — deliberate: progress is always derived from persisted data; a "clicked but not saved" step honestly shows `in_progress`/`not_started`.
7. **Step URLs are component state** (resume = first incomplete step). If deep-linkable step URLs are ever needed, the Phase 1 route-promotion gate (`/setup/*` handles already exist and redirect) covers it.

## 12. Remaining work for Phase 3 / Phase 4

- Phase 3: feature registry (registry-driven module coverage + role-wise feature view), people & roles read-only governance inventory, document/template registry (§9 of Phase 1 architecture), admission-wizard-config server persistence, timetable settings consumption decision, `school-subscription.tsx` decomposition.
- Phase 4: configuration change history (field-diff surfacing — the wizard already emits per-field audit diffs), announcement-signal unification, security close-out (TOTP posture, media hardening), docs sweep, `school-detail.tsx` per-destination decomposition.
- Candidate Phase-3 backlog items FROM this phase: initial-staff CSV import (none exists platform-side today); optional principal email rotation flow; streams management surface.
