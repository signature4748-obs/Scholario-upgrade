# Scholario — Super Admin Transformation

## PHASE 3 — ARCHITECTURE: ROLE-WISE FEATURE CONTROL

**Status: Stage 1 deliverable (architecture audit + design). Implementation follows in Stages 2–6.**
Base verified live: `main = 13972b9190ac4f58888592d96d89813a4d8bc4d1` (Phase 2 merge). PR #71
(docs-only P3 backlog) is **open, NOT merged** — its contents are not part of this design's base.

Evidence method: every claim below was verified against actual source at `13972b9…` (file:line
cited). Sections marked [VERIFIED] were read in the repository; the design sections are proposals.

---

## 1. Existing architecture (as found)

### 1.1 Planes and identity

| Plane | Identity source | Pipeline | Files |
|---|---|---|---|
| Platform | `PlatformAdmin` + `PlatformAdminSession` (DB permissions via `PlatformPermission` rows) | `withPlatform({permission, stepUp})` — fail-closed `permissions.has()`, per-admin mutation rate limit | `src/lib/platform/authz.ts:59-108`, `src/lib/platform/permissions.ts:18-40` |
| School | `User` + `Session` (school bearer / `erp_session`) | `withUser` → `authorize()` → resource-scope guards | `src/lib/api.ts:146+`, `src/lib/security/authz.ts:123-185` |

### 1.2 School roles — the canonical model [VERIFIED]

- `CANONICAL_SCHOOL_ROLES = ['PRINCIPAL', 'TEACHER', 'STUDENT']` — `src/lib/security/permissions.ts:54`.
  **Exactly three school roles exist.** Enforced fail-closed in `withUser`
  (`src/lib/api.ts:168`): any other `User.role` value (PARENT, MANAGEMENT, ACCOUNTANT, DRIVER,
  SUPER_ADMIN, stray) is refused school-plane authorization. `Role` still lists the legacy
  vocabulary (`permissions.ts:24-32`) because historical rows and the matrix reference it —
  "residue documentation, not granted roles" (`permissions.ts:35-53`).
- **"Class Teacher" is a scope, not a role**: a TEACHER appointed via `Class.classTeacherId`
  (`prisma/schema.prisma:485`, `src/lib/teacher-scope.ts:17,120`). The teacher panel renders a
  Class Teacher Hub only from a server-derived appointment (`GET /api/teacher/role`;
  `nav-registry.tsx:75-82`). Phase 3 therefore configures the three canonical roles and treats
  class-teacher features as TEACHER features whose *resource scoping* is already handled by
  `teacher-scope.ts` (a role-feature flag can remove access, never widen it to other classes).
- **The spec's "additional roles" question, answered from code**: Accountant, Office Staff
  (MANAGEMENT), Librarian, Parent and Driver exist only as legacy data rows / matrix residue and
  **cannot authenticate to the school application** (`api.ts:168` invariant). They are NOT
  configurable roles; inventing a UI for them would imply authorization that does not exist.
  PARENT is explicitly rejected as an identity ("a separate parent identity system must never
  exist", `permissions.ts:39-42`).

### 1.3 Module availability (Level 1–2) [VERIFIED]

- `FLAGGABLE_MODULES = ['exams','fees','homework','library','transport']` —
  `src/lib/platform/module-flags.ts:24`.
- Effective switch: `School.featureFlags[key] ?? PlatformSetting.modules[key] ?? true`
  (`module-flags.ts:56-71`, `:77-95`) — school override → platform master → on. Deliberately
  fail-open: "product availability toggles, NOT security boundaries" (`module-flags.ts:11-13`).
- Route guard `assertModuleEnabled` throws typed `FEATURE_DISABLED` (403) — applied on the five
  module ROOT routes only (`/api/fees:27, /api/exams:12, /api/homework:18, /api/library:24,
  /api/transport:21`). Sub-routes rely on the root guard contract.
- Platform writer: `PATCH /api/platform/schools/[id]/feature-flags`
  (`withPlatform({permission:'schools.manage'})`, audited `platform.school.feature_flags_updated`).
- The Phase 2 wizard's Modules step explicitly defers to this work:
  "Role-wise feature management and individual permissions are separate, stronger systems —
  detailed role-wise control arrives in Phase 3" (`school-setup-wizard.tsx:2056-2059`).

### 1.4 Static RBAC (Level 3) [VERIFIED]

- `PERMISSIONS: Record<string, readonly Role[]>` — `src/lib/security/permissions.ts:69-125`;
  `can(role, permission)` fails CLOSED on unknown keys (`:131-135`); `rolesWith` (`:138-140`).
- Central school-plane authorization: `authorize(user, policy)` — `src/lib/security/authz.ts:123-163`
  — resolves identity → role gate (`policy.roles`) → permission gate (`policy.permission` → `can`)
  → tenant gate (school-scoped routes refuse SUPER_ADMIN) → returns `Authz{user, role, schoolId,
  isPlatform, tenant}`. `withAuthz(policy, handler)` composes it with `withUser`
  (`authz.ts:177-185`). Resource scoping (`assertTenantRow`, `assertSameTenant`, `assertFkInTenant`,
  `assertStudentInTenant`, `scopedId/scopedWhere`, `stripClientSchoolId`) enforces the no-existence-
  oracle tenant invariant (`authz.ts:192-328`).
- **Pipeline coverage** (measured at `13972b9`): 88 route files use `withAuthz` (all funnel through
  `authorize()`); 131 use `withUser` (127 school-plane files call `withUser` WITHOUT `authorize()` —
  e.g. `/api/teacher/**`, `/api/student/**`, `/api/attendance*`, `/api/fees/structures/**`,
  `/api/fees/catalogue`, `/api/school-settings`); 87 platform files use `withPlatform`.
  Distinct policies: `roles:['PRINCIPAL','MANAGEMENT']` ×26, `permission:'school.homework.oversight'`
  ×18, `roles:['PRINCIPAL']` ×11, `permission:'exams.read'` ×11, `permission:'exams.settings.write'` ×9, …
- No Next.js server actions exist anywhere (`"use server"` → 0 hits). All mutations are API routes.

### 1.5 The fee-capability layer — client-only today [VERIFIED — important gap]

- `getEffectivePermissions(role, config)` (`src/lib/permissions.ts:90-106`) resolves 6 fee
  `CapabilityKey`s with **remove-only** semantics: `base && caps[key] !== false` — school config can
  remove a principal capability, never grant one; `fee_structure_delete` is platform-reserved false.
- **Every consumer is client-side** (zustand store `src/lib/tenant/store.ts:249-305`, fee-store
  action guards `src/lib/store/fee-store.ts:103-116`, three fee components). **No DB column, no
  settings slice, no API, no server route reads it.** Consequence: a school whose Super Admin
  "disabled" `fee_structure_publish` in the client store still allows `POST /api/fees/structures/[id]/publish`
  server-side (roles only). Phase 3 does NOT silently adopt this layer (see §5.7), but its
  remove-only philosophy is the precedent the new layer follows.

### 1.6 Navigation and UI gating [VERIFIED]

- School shell is a client SPA (`src/app/page.tsx:327-345` mounts Principal/Teacher/Student panels).
- Single nav choke point: `filterNavForRole(groups, role)` — `src/lib/nav/role-nav.ts:48-58` —
  filters nav groups/items by `can(matrixRole, item.permission)`; header comment: "UI COURTESY
  only … the role comes from the server session". Unknown permission ⇒ item hidden.
- Per-panel catalogs: principal (`principal-panel.tsx:86-212` — permission filter ∩ module-flag
  filter via `PRINCIPAL_NAV_MODULE_KEYS` in `src/lib/tenant/registry.ts:174-192` and
  `useEffectiveModuleFlags` fed by `GET /api/school-settings` → `getSchoolConfig().moduleFlags`,
  `src/lib/school-config.ts:93-103`), teacher (`nav-registry.tsx:31-113` — includes the
  class-teacher group from the server appointment), student (`student-panel.tsx:81-287`).
- Module flags fail OPEN client-side while loading (`use-effective-module-flags.ts:71-76`).

### 1.7 Platform Control Center surfaces [VERIFIED]

- School workspace `/platform/schools/[id]` — `src/components/platform/modules/school-detail.tsx`
  (client, 3,155 lines) driven by `?tab=` with three groups (Overview · Setup · Manage).
  Tab IA is a pure data module: `school-detail-tabs.ts` (`CONTROL_CENTER_GROUPS:26`,
  `SUBSECTION_IDS:33-49`, `LEGACY_TAB_REDIRECT:63-87`, `availableControlCenterGroups:102-113`,
  unit-tested in `tests/unit/school-control-center-tabs.test.ts`). Sections render as anchored
  `GroupSection`s; the Manage group appears when the viewer holds `schools.manage` /
  `billing.manage` / `support.access` / `audit.read`.
- Design system: shadcn/ui primitives (`src/components/ui/*`), Tailwind v4, sonner toasts,
  lucide icons, `FormError` + optimistic-toggle-rollback pattern (`toggleFlag`,
  `school-detail.tsx:1812-1832`; `school-setup-wizard.tsx:1974-1992`), horizontal-scroll
  `TabsList` (`overflow-x-auto no-scrollbar`), mobile drawers. Phase 1's architecture doc already
  planned "Phase 3: feature registry view (searchable, role-wise)" (`PHASE-1-ARCHITECTURE.md:204,269`).

### 1.8 Audit [VERIFIED]

- School plane: `auditEvent` → `ActivityLog` (`src/lib/security/audit.ts:151-215`; closed
  `AUDIT_ACTIONS` vocabulary `:26-147`).
- Platform plane: `platformAuditEvent` → `PlatformAuditLog` (dot-namespace actions, JSON metadata
  clipped to 2,000 chars, `src/lib/platform/audit.ts:43-112`). Control-plane config changes
  (e.g. `platform.school.feature_flags_updated`) are platform-plane records.
- Read-back UI exists for both planes (`/platform/audit`, school dossier `recentActivity`).

### 1.9 Readiness engine [VERIFIED safe to extend around]

`computeSetupReadiness` (`src/lib/school/setup-readiness.ts:56-242`) reads only named School
columns + 12 row counts; the wizard derivation is pure (`setup-wizard-state.ts:152-260`). New
tables/columns cannot affect it unless its select list changes.

---

## 2. Current permission-resolution flow (as found)

School request → `withUser` (session → active identity → canonical-role invariant →
mustChangePassword → subscription entitlement → per-student entitlement → `roles` option) →
[withAuthz path only] `authorize()` (role gate → `can()` permission gate → tenant gate) →
route handler with `Authz` (tenant-scoped queries + resource-scope guards) → Prisma `where`
always carries `schoolId`.

Module gate (`assertModuleEnabled`) is a separate, parallel layer invoked inside ~5 root routes.
Fee capabilities are a client-only parallel layer. **There is no per-school, per-role,
DB-backed feature configuration anywhere in the server pipeline.** That is the Phase 3 gap.

## 3. Existing role ↔ module ↔ feature relationships (as found)

- Roles: 3 canonical (PRINCIPAL/TEACHER/STUDENT); class teacher = TEACHER + appointment.
- Modules: 5 flaggable (exams/fees/homework/library/transport); 17 ModuleKeys in the legacy
  tenant registry (decorative client-side; `registry.ts:10-14` admits the server flags are truth).
- Features: none configurable. The nearest artifacts are (a) the static `PERMISSIONS` matrix
  (~30 school-plane capabilities), (b) the client-only fee capabilities, (c) explicit role lists
  on routes without permission keys (attendance: `roles:['PRINCIPAL','MANAGEMENT','TEACHER']`).

## 4. Gaps in the current system

1. **No school-level role-feature configuration exists** — permission behavior is identical for
   every school; a school wanting "teachers cannot see fees" has no supported way to express it.
2. **127 school-plane routes bypass `authorize()`** (bare `withUser`) — any new gate that lives
   only in `authorize()` misses them; enforcement must be reachable from `withUser` as well.
3. **The fee-capability layer is client-only** (§1.5) — a real server-enforcement gap, but fixing
   it wholesale is outside Phase 3 scope (§5.7 documents the boundary).
4. **No UI anywhere** for role-wise control (the wizard step only defers to it).
5. **No per-school config storage** for role features (School JSON columns exist but a JSON
   read-modify-write would recreate the INFO-O3 concurrent-writer hazard and is unauditable
   per cell).

## 5. Proposed architecture

### 5.1 Principle: extend, never compete

Phase 3 adds exactly ONE new layer — a **per-school role-feature override** — and composes it
with the existing layers. It does not replace `PERMISSIONS`, does not fork `can()`, does not
touch the module resolver, and does not introduce a second vocabulary. Feature keys ARE the
existing capability vocabulary (`PERMISSIONS` keys) plus explicit role-baseline features for
surfaces that guard by role list (attendance). This satisfies "if the existing permission
architecture already supports the behaviour, extend it".

### 5.2 The four-layer resolution model (deterministic, fail-closed)

```
effectiveAccess(school, role, feature) =
      L1  platformModuleMaster                        \  existing
    ∧ L2  schoolModuleOverride          (module-flags) /  unchanged
    ∧ L3  staticRbacBaseline(role, feature)  =  can(role, feature.permission)
                                             or role ∈ feature.baselineRoles
    ∧ L4  NOT roleFeatureDenied(school, role, feature)      ← NEW (DB-backed)
```

- **L4 is remove-only.** An override row can only DENY a feature the L3 baseline grants.
  It can never grant access the RBAC baseline refuses (spec: "a role-level feature flag must
  not bypass existing RBAC permissions") and never re-enables a disabled module ("a role must
  never gain access to a disabled school module merely because a role-level feature flag is
  enabled" — the module layers stay upstream and untouched).
- **Missing rows ⇒ inherit L3.** Existing schools behave EXACTLY as after Phase 2. The default
  is NOT "everything enabled" — it is "the application's intended existing security model",
  preserved verbatim (spec §5).
- **Unknown feature key ⇒ fail closed** (mirrors `can()`'s unknown-permission rule).
- **P3-F4 (platform-master-as-default) reviewed as required**: this design does NOT change the
  `schoolFlags[key] ?? master[key] ?? true` precedence. The Phase 2 observation is recorded in
  PR #71's backlog; any product decision there is isolated from Phase 3 (the module layers are
  consumed unchanged through `assertModuleEnabled`/`effectiveModuleFlags`).

### 5.3 Feature catalog (code-owned, typed, enforced)

`src/lib/security/role-features.ts` exports:

```ts
interface FeatureDef {
  key: string                 // = the PERMISSIONS key, or a namespaced explicit feature
  module: ModuleGroupKey      // UI grouping; mirrors school modules/nav
  permission?: string         // L3 baseline via can(); exactly one of permission/baselineRoles
  baselineRoles?: readonly CanonicalSchoolRole[]  // L3 baseline for role-list-guarded surfaces
  label: string               // human title (no raw keys in UI)
  description: string         // one-line plain-language description
  lock?: 'PLATFORM_RESERVED'  // never configurable (none today; hook for reserved caps)
}
export const ROLE_FEATURE_CATALOG: readonly FeatureDef[]
export const FEATURE_KEYS: Set<string>          // fail-closed membership
export function featureDef(key: string): FeatureDef | null
```

Catalog derivation rule (spec §4B: "derive the actual modules and features from the repository;
a feature must only be configurable if it has a real corresponding implementation or a clearly
defined authorization capability"): every catalog entry maps 1:1 onto an existing enforced
authorization point — either a `PERMISSIONS` key that routes actually check, or a documented
role-list guard (attendance) — verified in the Stage 2 route map before the entry ships.
A unit test (`tests/unit/role-features.test.ts`) asserts catalog integrity: unique keys, known
module groups, exactly one baseline kind, every `permission` key exists in `PERMISSIONS`,
baseline roles ⊆ canonical roles.

Initial catalog (illustrative grouping; final list fixed after the Stage 2 route audit):
Dashboard (`school.dashboard.read`), People (students/staff/master-data read/write), Academics
(timetable publish, question bank), Attendance (mark/view — explicit baseline
PRINCIPAL+TEACHER), Exams (read, marks read/write/submit, results read/manage, settings,
audit), Homework (read/write/oversight), Fees (`school.finance.read/write/export/reconcile`),
Communication (announcements read/publish, messages send), Operations (events, library manage,
transport read, rooms).

### 5.4 Database changes (the only schema change)

```prisma
/// PHASE 3 — per-school role-feature denials (remove-only overrides).
/// A row = "this school explicitly disabled this feature for this role".
/// No row = inherit the static RBAC baseline (backward-compatible default).
model RoleFeatureOverride {
  id         String   @id @default(cuid())
  schoolId   String
  school     School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  role       String   // canonical school role (PRINCIPAL | TEACHER | STUDENT)
  featureKey String   // ROLE_FEATURE_CATALOG key (validated server-side)
  denied     Boolean  @default(true) // explicit; rows are only ever created denied
  createdBy  String?  // platform admin id (display/trace; actor also in audit)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([schoolId, role, featureKey])
  @@index([schoolId, role])
}
```

- Additive only: no existing column/table is touched; no data statements. Existing schools have
  zero rows ⇒ zero behavior change (spec §5's critical requirement).
- A dedicated TABLE (not School JSON) because: per-cell auditability, per-row concurrent updates
  (no whole-column read-modify-write race — avoids the INFO-O3 pattern), unique constraint as a
  race backstop, cheap indexed reads. DB-level check of role/feature values is enforced in the
  service layer (fail-closed validation before any write), matching how `featureFlags` JSON is
  validated today.
- Migration: `prisma/migrations/<ts>_role_feature_overrides/migration.sql` — `CREATE TABLE` +
  FK + unique + index, following the documented additive style (`20261030140000_staff_role_coverage`
  is the model). Drift gate unaffected (no raw-SQL index families introduced).

### 5.5 Server-side enforcement wiring (the security core)

One resolver, one assert, two entry points — no duplication:

```ts
// src/lib/security/role-features.ts (new)
export async function roleFeatureDenials(schoolId, role): Promise<ReadonlySet<string>>
export async function isRoleFeatureAllowed(schoolId, role, featureKey): Promise<boolean>
   //  featureDef(key) must exist (else false — fail closed)
   //  ∧ (permission ? can(role, permission) : baselineRoles.includes(role))
   //  ∧ !denials.has(key)
export async function assertRoleFeatureAllowed(schoolId, role, featureKey): Promise<void>
   //  throws AppError('FEATURE_DISABLED_FOR_ROLE') — new 403 code, same taxonomy
```

Wiring:

1. **`authorize()` gains `feature?: string`** (`AuthzPolicy`) — after the existing role and
   permission gates, `await assertRoleFeatureAllowed(ctx.schoolId, role, policy.feature)`.
   Every `withAuthz` route that declares a feature inherits the gate automatically (88 files
   funnels through here). `withAuthz` forwards `feature` to `withUser` opts as well so BOTH
   pipelines check once (see 2) — actual check executes once per request.
2. **`withUser` gains `opts.feature`** — for the 127 school-plane routes that never call
   `authorize()`. Same `assertRoleFeatureAllowed` call, so a gate declared at either level
   cannot be bypassed by pipeline choice.
3. **Route map (Stage 2 deliverable)**: for EVERY catalog feature, enumerate its enforcing
   routes and add the gate: `withAuthz({permission/roles, feature})` where the route already
   uses `withAuthz`; `withUser(handler, {roles, feature})` where it uses `withUser`. Bare
   `withUser(handler)` reads that belong to a catalog feature get `{feature}` (and, where the
   route is school business data, an explicit `roles` is left untouched — Phase 3 adds a gate,
   it does not retighten unrelated policies).
4. **Module gates stay where they are** — `assertModuleEnabled` continues to run on the module
   roots; the feature gate composes AFTER it in effect (both must pass). No precedence change.
5. **Platform plane untouched**: `withPlatform` routes and `authorizePlatform` are unaffected
   (Super Admin keeps full access; the new layer only ever narrows SCHOOL roles).
6. Error surface: new typed code `FEATURE_DISABLED_FOR_ROLE` (403) in `src/lib/security/errors.ts`
   with an actionable publicMessage ("Your school administrator has restricted <feature> for your
   role"). Distinct from `FEATURE_DISABLED` (module-level) so logs/UI can tell the layers apart.

Coverage honesty rule (spec §4D): the PR must include a table feature → enforcing routes →
pipeline; any route that cannot take the gate safely is listed as a known limitation rather
than silently skipped.

### 5.6 Configuration API (platform plane)

Following the `plan/route.ts` scaffold exactly (`withPlatform` + zod + fail-safe 404 +
`platformAuditEvent` + per-admin rate limit):

- `GET /api/platform/schools/[id]/role-features` — `withPlatform({permission:'schools.read'})`
  → `{ roles: [{role, features: [{key, enabled, inherited, overridden, locked}]}], updatedAt }`
  (enabled = effective; inherited vs explicitly-overridden badges; locked = L3 baseline refuses
  the role — shown read-only, never configurable).
- `PATCH /api/platform/schools/[id]/role-features` — `withPlatform({permission:'schools.manage'})`.
  Body: `{ baseUpdatedAt, changes: [{role, featureKey, denied}] }` — validated against the
  catalog (unknown key ⇒ 422), roles against canonical set, per-cell diff computed server-side.
  Writes: per-row upsert/delete in ONE transaction; **optimistic concurrency**: if the school's
  current overrides' `max(updatedAt)` ≠ `baseUpdatedAt` ⇒ typed CONFLICT ("configuration changed
  by someone else — reload and reapply"), satisfying "concurrent updates do not silently
  overwrite each other". Emits `platform.school.role_features_updated` with metadata
  `{changes:[{role, feature, from, to}]}` (previous/new values per cell — spec §4G) and no
  secrets. Per-cell failures are atomic (transaction rollback), per the fee-seeding P3 lesson
  applied to our own code.

### 5.7 Explicit scope boundary (what Phase 3 does NOT do)

- Does NOT migrate the client-only fee-capability layer into the server (§1.5 gap). The new
  feature catalog covers fees through the `school.finance.*` PERMISSIONS keys that ARE enforced
  server-side. Migrating `CapabilityKey` is a separate, backward-compatibility-sensitive change
  recorded as follow-up, not smuggled in (spec §8.10 discipline).
- Does NOT close the module-guard "root routes only" observation (§1.3) — pre-existing, recorded.
- Does NOT change module precedence (P3-F4) — isolated per spec.
- Does NOT add roles (no PARENT/ACCOUNTANT UI — §1.2) and does NOT weaken any existing
  permission, tenant check or RBAC rule.

### 5.8 Super Admin UI (Control Center)

Placement: **Manage tab** of the school workspace — ongoing governance, `canManage`-gated —
as a new anchored section `roleFeatures: 'section-role-features'` in `school-detail-tabs.ts`
(+ `LEGACY_TAB_REDIRECT` entry `role-features`, + unit-test updates, Manage visibility via
existing `availableControlCenterGroups`).

UI structure (reusing the flag-row + GroupSection patterns; no raw keys):
- Role selector: three chips (Principal · Teacher · Student) — mobile-safe.
- Per module group: card with feature rows (label + description + state + `Switch`).
  States: **On · inherited** (baseline grants, no override) / **Off · overridden** (deny row) /
  **Not available to this role** (locked — L3 baseline refuses; disabled control + explanation:
  "the role's base permissions do not include this").
- Bulk controls per role: Enable all configurable · Disable all configurable · Reset to defaults
  (delete all deny rows) · Copy from another role (copies deny rows intersected with the target
  role's baseline; preview before apply).
- Draft model: switches mutate a local draft; dirty state shown ("Modified — N changes");
  explicit **Save** → PATCH with `baseUpdatedAt`; 409 renders an actionable reload banner
  (no silent overwrite); success toast + refreshed server state (effective summary + badges).
- Summary strip: "N of M features restricted" per role; honest loading (`Skeleton`) and error
  (`FormError`) states; read-only notice when viewer lacks `schools.manage`.
- Responsive: role chips scroll horizontally; cards stack single-column at 390px (the
  `min-h-[52px]` switch-row pattern from the wizard); no wide desktop table on mobile
  (spec §6 responsive requirement). A desktop-only "matrix" view is NOT forced on small screens.

### 5.9 School-side reflection (navigation/UI courtesy — server remains authority)

- `GET /api/school-settings` (`getSchoolConfig`) additionally returns
  `roleFeatures: Record<featureKey, boolean>` for the CALLER's own role (effective map, one
  indexed read; schoolId always session-derived — no new tenant surface).
- Panels add a THIRD nav filter stage (after permission ∩ module): feature gate via a
  NAV-key→feature mapping for catalog-covered items only; fail-open while config loads
  (consistent with module flags), fail-closed server-side. Deep-link guard mirrors the module
  fallback (active module → dashboard when feature removed).
- Nothing else changes in the school UX; dashboards and workflows keep functioning for
  unaffected features (spec §4E "do not break existing role dashboards").

### 5.10 Audit history

`platformAuditEvent` (Platform plane, where all control-plane config lives) with
`action: 'platform.school.role_features_updated'`, `targetType:'SCHOOL'`, `schoolId`,
per-change metadata `{role, feature, from, to}` (previous value / new value / actor / timestamp /
optional `reason` field in the body, max 400 chars — same bound as `plan/route.ts`). No secrets
by construction (feature keys + booleans only). Visible in the existing `/platform/audit` viewer
and school dossier activity feed via the existing `recentActivity` join.

## 6. Authorization & tenant-isolation strategy

- The config routes are platform-plane (`withPlatform`), so school sessions get 401 by plane
  isolation and cross-tenant access is impossible by construction (no school bearer can reach
  them); unknown school id ⇒ fail-safe 404 (no existence oracle), matching the wizard family.
- The enforcement gate consumes ONLY session-derived identity (`user.role`, `user.schoolId`)
  and the school's own rows — never client input. `stripClientSchoolId` discipline unchanged.
- The gate itself is tenant-safe: `roleFeatureDenials(schoolId, …)` queries by the session
  tenant; a forged/stale schoolId cannot be injected (not accepted from any client surface).
- Existing invariants preserved verbatim: canonical-role fail-closed gate, canonical-plane
  middleware separation, resource-scope guards, `can()` unknown-key fail-closed, no client
  authorization inputs. Tests re-assert all of them (§8).

## 7. Migration & backward-compatibility plan

1. Additive migration creates `RoleFeatureOverride` (§5.4). Deploy order-safe: old code ignores
   the table; new code with zero rows behaves identically to Phase 2 (inherit L3).
2. Resolver + routes + UI ship together; the feature gate activates per route as its gate is
   declared, so partial coverage degrades to "Phase 2 behavior", never to "more restrictive".
3. No backfill: absence of rows IS the inheritance state. No default-on migration risk.
4. CI gates: typecheck, lint, `prisma migrate deploy` on fresh Postgres, drift gate, full unit/
   integration/security suites, E2E journeys (all existing suites must stay green — any
   intentional behavior change surfaces as a reviewed, justified test update, never a weakened
   assertion).

## 8. Test strategy (maps to spec §6)

- **Unit** (`tests/unit/role-features.test.ts` + `school-control-center-tabs.test.ts` update):
  catalog integrity (unique keys, real permissions, canonical roles, no invented features);
  resolver truth table (baseline grant + no row ⇒ allowed; grant + deny row ⇒ denied; baseline
  refusal ⇒ locked/allowed=false even with no rows; unknown key ⇒ false; module layers out of
  scope for the resolver); copy/reset/bulk diff computation; optimistic-lock predicate.
- **API / integration** (`tests/api/role-features.test.ts`, `tests/security/role-features-isolation.test.ts`):
  platform authz matrix (root full-perms admin read/write; `schools.read`-only admin 403 on
  PATCH; anonymous 401; school bearer 401; unknown school 404; unknown feature key 422; invalid
  role 422; junk body 422); persistence after re-read; conflict (PATCH with stale `baseUpdatedAt`
  ⇒ 409, no partial writes); audit row with per-change metadata; **enforcement on real school
  routes**: teacher with denied homework feature ⇒ `FEATURE_DISABLED_FOR_ROLE` on the enforcing
  route, still 200 for principal; disabled module still wins (`FEATURE_DISABLED` even when the
  feature is allowed); other tenants unaffected (Green Valley teacher untouched by Hawkings
  config); existing suites stay green (no regression in the 2,116-test battery).
- **E2E** (`tests/e2e/role-features-acceptance.test.ts`): the spec's 10-step journey — platform
  login → open school → open Role-wise Feature Control → select role → change a feature → save →
  refresh preserves → the role's own session reflects the restriction (nav payload + direct API
  denial) → another tenant's user unaffected → existing flows (dashboard/homework) intact for
  unaffected features.
- **Responsive UI** (local verification during Stage 4, reported with evidence like the Phase 2
  audit): desktop 1440×900, iPad 1024×1366, mobile 390×844 — no horizontal overflow, switch rows
  ≥ 40px, cards single-column on mobile.

## 9. Risks and decisions (explicit)

| # | Risk / decision | Mitigation |
|---|---|---|
| R1 | Deny-only semantics might be read as "cannot enable anything" | Locked cells are shown honestly as baseline-refused; enabling = clearing an override. Grant-beyond-RBAC is prohibited by spec §4C and stays prohibited. |
| R2 | Enforcement coverage gaps (127 `withUser` routes) | Feature→route map is a reviewed PR artifact; every catalog feature's primary routes take the gate; residual routes listed as known limitations, never hidden. |
| R3 | Extra DB read per gated request | One indexed `findMany` per gated request (same order as existing entitlement reads); no TTL cache (immediate effect beats latency here); revisit if profiling demands. |
| R4 | Concurrency on saves | `baseUpdatedAt` optimistic lock + single transaction + typed CONFLICT (§5.6). |
| R5 | Module-flag interplay confusion | Layers documented (§5.2); distinct error codes (`FEATURE_DISABLED` vs `FEATURE_DISABLED_FOR_ROLE`); module precedence untouched (P3-F4 isolated). |
| R6 | Breaking Phase 1/2 surfaces | New section + new routes + additive schema only; tabs unit test extended; full existing battery must stay green; wizard/readiness engine untouched (§1.9). |
| R7 | Role proliferation temptation | Exactly the 3 canonical roles are configurable; class-teacher is scope; legacy roles excluded with the code-level rationale (§1.2). |
| R8 | Fee capability duplication | Explicitly out of scope (§5.7); fees enter the catalog via enforced `school.finance.*` keys only. |

## 10. Affected components (Stage 1 identification)

**New**: `prisma/migrations/<ts>_role_feature_overrides/`; `src/lib/security/role-features.ts`;
`src/app/api/platform/schools/[id]/role-features/route.ts`;
`src/components/platform/modules/role-features.tsx`; `tests/unit/role-features.test.ts`;
`tests/api/role-features.test.ts`; `tests/security/role-features-isolation.test.ts`;
`tests/e2e/role-features-acceptance.test.ts`.

**Modified (expected)**: `prisma/schema.prisma` (+model, School back-relation);
`src/lib/security/errors.ts` (+`FEATURE_DISABLED_FOR_ROLE`); `src/lib/security/authz.ts`
(`AuthzPolicy.feature` + gate); `src/lib/api.ts` (`withUser` opts.feature + gate);
`src/lib/school-config.ts` (+`roleFeatures` in DTO); targeted school routes per the Stage 2
route map (feature gates); `src/lib/nav/role-nav.ts` or panel filters (third nav stage);
`src/components/platform/modules/school-detail-tabs.ts` (+section); `school-detail.tsx` (render
section); `tests/unit/school-control-center-tabs.test.ts`; docs.

**Not modified**: module-flags resolver, platform authz, tenant-isolation guards, Phase 2 wizard
logic, readiness engine, subscription/entitlement gates.
