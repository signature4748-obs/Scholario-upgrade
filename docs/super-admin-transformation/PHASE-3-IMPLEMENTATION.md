# Scholario — Super Admin Transformation

## PHASE 3 — IMPLEMENTATION RECORD (Role-wise Feature Control)

**Branch:** `feat/role-wise-feature-control-phase3` (from verified `main = 13972b9…`)
**Design:** see `PHASE-3-ARCHITECTURE.md` (Stage 1). This record maps the implementation to it.

---

## 1. What was built

| Layer | Artifact | Notes |
|---|---|---|
| Schema | `RoleFeatureOverride` model + `20261031120000_role_feature_overrides` migration | Additive; `@@unique([schoolId, role, featureKey])` + `@@index([schoolId, role])`; FK cascade; zero rows for existing schools ⇒ zero behavior change |
| Catalog + resolver | `src/lib/security/role-features.ts` | 28-feature code-owned catalog (8 groups), `featureBaselineAllows` (L3), `roleFeatureDenials` / `isRoleFeatureAllowed` / `assertRoleFeatureAllowed` (L4), config read/write with optimistic lock, `effectiveFeaturesForRole` for the school UI |
| Error taxonomy | `FEATURE_DISABLED_FOR_ROLE` (403) in `src/lib/security/errors.ts` | Distinct from module-level `FEATURE_DISABLED`; registered in `tests/unit/errors-taxonomy.test.ts` |
| Pipeline gates | `authorize()` policy `feature` + `withUser` opts `feature` | One resolver, two entry points; both funnel through the same fail-closed assert |
| Config API | `GET/PATCH /api/platform/schools/[id]/role-features` | `schools.read` / `schools.manage`; zod-validated; per-cell audited; optimistic lock → typed CONFLICT; fail-safe 404 |
| Control-center UI | `src/components/platform/modules/role-features.tsx` + `school-detail.tsx` Manage section + `school-detail-tabs.ts` (`section-role-features`, legacy key `role-features`) | Role chips, grouped switch rows, inherited/overridden/locked badges, bulk controls, draft+save, conflict banner, read-only mode |
| School reflection | `SchoolConfigDTO.roleFeatures` + `useRoleFeatures` hook + third nav filter stage in all three panels | Fail-open client courtesy; server remains authoritative |
| Tests | unit (17) · api (11) · security isolation (12) · e2e journey (7) | 47 tests total, all passing |

## 2. Enforcement route map (feature → wired sites)

Every catalog feature's enforcing routes carry the gate (131 sites). Counts per key:

```
fees.manage 20            school.homework.oversight 18   exams.manage 17
exams.read 11             exams.settings.write 9         attendance.mark 8
exams.marks.write 4       school.questionbank.write 3    school.homework.write 3
people.structure.manage 3 people.staff.manage 3          announcements.manage 3
subjects.manage 2         school.library.manage 2        school.homework.read 2
school.finance.read 2     school.events.write 2          people.students.read 2
people.students.manage 2  exams.results.read 2           exams.marks.read 2
timetable.publish 1       school.transport.read 1        people.structure.read 1
messaging.send 1          exams.marks.submit 1           exams.audit.read 1
attendance.student.view 1
```

Wiring forms: `withAuthz({ permission, feature })` (permission-backed keys reuse the same key),
`withAuthz({ roles, feature })` (P/M exam & fee mutation routes → `exams.manage`/`fees.manage`),
`withUser(handler, { roles, feature })` (withUser-only routes). The wiring script asserted exact
per-file counts (mismatch = hard failure).

**Deliberately NOT wired (known limitations, each with the reason):**
- `fees/catalogue` GET (any canonical role may read the catalogue — wiring `fees.manage` would
  break the student/parent payment flow); `fees/webhook` (machine caller);
  `fees/reconcile` (ACCOUNTANT-shaped policy on a non-canonical role);
  student payment/order routes (multi-role payment flow);
  `messaging/threads` GET (`withAuthz({tenant:'school'})` — students read threads);
  `teachers/upload` (upload-auth fail-closed path); `students/roster` (P/M/STUDENT mixed);
  `student/*` self-service beyond attendance (scoped routes without per-feature role guards —
  wiring a gate would either block or be decorative).
- These surfaces remain under their existing (unchanged) authorization. Nothing was weakened.

## 3. Baselines mirror route reality (remove-only, never widening)

- Permission-backed features resolve L3 through `can()` — the exact vocabulary routes enforce.
- Explicit-baseline features (`baselineRoles`) mirror the wired routes' canonical role subsets
  (e.g. `attendance.mark` = PRINCIPAL+TEACHER over P/M/T-guarded routes; MANAGEMENT is
  non-canonical and can never authenticate). A denial where the baseline refuses is rejected 422
  at the config surface (remove-only enforced at write time AND by unit tests).
- Module layers untouched: `assertModuleEnabled` still guards module roots; P3-F4 precedence
  (`schoolFlags ?? master ?? true`) unchanged and isolated (PR #71 backlog).

## 4. Test evidence (this sandbox, `2026-10-31`)

| Suite | Result |
|---|---|
| `tests/unit/role-features.test.ts` | 17 pass / 0 fail (307 expects) |
| `tests/api/role-features.test.ts` | 11 pass / 0 fail |
| `tests/security/role-features-isolation.test.ts` | 12 pass / 0 fail |
| `tests/e2e/role-features-acceptance.test.ts` | 7 pass / 0 fail (all 10 spec steps covered) |
| `bun run test:unit` (whole dir) | 504 tests → 0 fail (after registering the new code in the taxonomy contract test) |
| `bun run test:integration` | 49 pass / 0 fail |
| `bun run test:api` (whole dir) | 149 pass / 0 fail / 10 pre-existing skips |
| `bun run test:regression` (whole dir) | 203 pass / 0 fail |
| `bun run typecheck` | clean |
| `bun run lint` | **0 errors** / 64 warnings (exact pre-existing baseline) |
| Migrations + drift gate | 33 migrations applied; drift = 24 sanctioned trgm + 11 sanctioned `_schoolId_idx` drops, nothing else |
| `bun run build` (standalone) | ✓ Compiled successfully, 241/241 static pages |
| Browser UX (real browser) | Desktop 1440×900, iPad 1024×1366, mobile 390×844 — **no horizontal overflow at any viewport**; role chips scroll-fit; 28/28 switch rows ≥ 52px; toggle → draft → save → DB verified end-to-end |

**Environmental failures (bisected to clean `main`, NOT Phase 3 regressions):**
- `platform-isolation` (suspend/reactivate 20s timeout; stale step-up) — reproduce identically on main.
- `provisioning-reliability` / wizard E2E STEP 1 — the provision transaction measures
  **24.4s application time** in this sandbox (`POST /api/platform/schools 200 in 25.0s
  (application-code: 24.4s)`), blowing 25s test budgets; identical signature on main.
- Mid-battery flaky set (GATE F avatar; cross-tenant write trio) — passes standalone with the
  Phase 3 build (tenant-isolation: 57/57 twice); failure set differs between runs and between
  builds; dev-server memory respawns (`exit 143`) observed mid-battery in the 4 GB sandbox.

## 5. Independent self-review findings (Stage 5)

| Sev | Finding | Disposition |
|---|---|---|
| P3 | Aggregate audit event would truncate at the funnel's 2,000-char metadata cap for realistic bulk saves | **Fixed** — one `platform.school.role_feature_updated` record PER CELL (role, feature, from, to, batch), cannot truncate |
| INFO | Component heading duplicated the GroupSection title | **Fixed** |
| INFO | Student-role configurable surface is thin (1 feature) — honest, not fake | Documented; more student features require new route guards (out of scope) |
| INFO | Fee-capability layer remains client-only (pre-existing gap) | Documented as follow-up; fees enter this layer via enforced `school.finance.*` keys |
| — | No P0/P1/P2 findings. Tenant isolation, RBAC, module precedence, Phase 1/2 surfaces: unchanged and re-proven by the existing suites (api 149/0, regression 203/0). | — |

## 6. Security checklist (spec §8 boundaries)

- [x] No direct push to main; no self-merge; no branch deletions
- [x] No production Supabase/data/secrets/deployments touched (all verification local + CI-replicated)
- [x] Tenant isolation & RBAC strengthened only (remove-only layer); canonical-role invariant untouched
- [x] Phase 1/2 behavior preserved (full batteries green; wizard/readiness untouched except the footer pointer text)
- [x] Module precedence (P3-F4) not changed; isolated per PR #71 backlog
- [x] No Phase 4 work started
- [x] All reported results ran in this sandbox and were verified from actual outputs
