# Scholario — Super Admin Transformation

## PHASE 2 — FOLLOW-UP BACKLOG (Non-Blocking Observations)

**Status: OPEN — carried into the Phase 3 backlog.** None of the items below blocks the Phase 2
merge or current production behavior; every item must be either fixed or explicitly accepted
during Phase 3. They are recorded so they cannot be silently dismissed.

**Source:** PHASE 2 Independent Final Quality Audit of PR #70
(`feat/super-admin-school-setup-phase2` → `main`), verdict
**APPROVE WITH NON-BLOCKING OBSERVATIONS** — 0 × P0, 0 × P1, 0 × P2, **4 × P3**, 5 × INFO.

**Merge context (evidence these are quality observations, not regressions):**

| Field | Value |
|---|---|
| PR | [#70 — Simple School Setup Wizard](https://github.com/signature4748-obs/Scholario-upgrade/pull/70) |
| Reviewed head | `15379ec1ae6f5e71c1722f3f979aa50e9048fae4` |
| Merge commit | `13972b9190ac4f58888592d96d89813a4d8bc4d1` (merge commit; tree byte-identical to the reviewed head) |
| Merge method | GitHub PR merge mechanism — merge commit (no squash, no rebase, no direct push to `main`) |
| Pre-merge CI (PR head) | Unit 2116 pass / 27 skip / 0 fail · E2E 45/45 · typecheck clean · lint 0 errors / 64 warnings · 32 migrations applied · drift gate passed · build 241/241 pages (run [41181740145](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/41181740145)) |
| Post-merge CI (main) | Same battery green on the merge commit, first attempt (run [41205825203](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/41205825203)) |

All file locations below were re-verified against the merged tree
(`13972b9…`, identical to reviewed head `15379ec…`).

---

## P3 findings (must be dispositioned in Phase 3)

### P3-F1 — Identity email/phone/website lack format validation

| Field | Detail |
|---|---|
| Location | `src/app/api/platform/schools/[id]/route.ts:266,271-272` (`patchSchema`) |
| Finding | The wizard's identity step persists `email` / `phone` through `safeText(...)` and `website` through a plain trim + max-length — no format validation — although `emailSchema` (`src/lib/security/validation.ts:160`) and `phoneSchema` (`src/lib/security/validation.ts:178`) already exist and are used by `initial-staff`. |
| Evidence | `PATCH /api/platform/schools/<id>` with `{"email":"not-an-email"}` returns 200 and the identity step completes; verified in the independent review (audit §16) against reviewed head `15379ec`. |
| Impact | Invalid contact data can persist into the school dossier, documents and website presence. Data-quality only: platform-plane surface, no authorization or cross-tenant impact. |
| Recommended fix | Use `emailSchema` / `phoneSchema` (and a URL check for `website`) in the extended `patchSchema`. |
| Status | **OPEN** |

### P3-F2 — Examination seeding is non-transactional (partial state possible)

| Field | Detail |
|---|---|
| Location | `src/app/api/platform/schools/[id]/initial-exam-config/route.ts:109-114` |
| Finding | Per-grade-band validation (`minPct > maxPct`) throws **inside** the creation loop, after some exam types / earlier bands may already have been persisted. `academic-bootstrap` and `initial-staff` are transactional (all-or-nothing); this route is not. |
| Evidence | `POST examTypes=[A,B] + gradeScales=[invalid]` → exam types persisted, scales not; response is a typed 422; next GET honestly reports the mixed state; idempotent replay recovers fully (proven in the review). |
| Impact | Mixed partial state within one school's exam configuration; honestly reported and recoverable, but inconsistent with the all-or-nothing behavior of the sibling seeders. |
| Recommended fix | Wrap the two creation loops in `db.$transaction`, or validate all bands before creating anything. |
| Status | **OPEN** |

### P3-F3 — Activation read-then-write race (no conditional update)

| Field | Detail |
|---|---|
| Location | `src/app/api/platform/schools/[id]/activate/route.ts:83-89,130` |
| Finding | The route reads `school.status` (line 83, guards at 87/90) and later writes `status: 'ACTIVE'` unconditionally (line 130) — a non-transactional read-then-write. Two concurrent activations both succeed harmlessly (same end state, two audit rows); the theoretical TOCTOU is a suspend landing between check and write (SUSPENDED → ACTIVE). |
| Evidence | Established by code analysis of the write shape in the independent review (audit §10.5, §17.3). Not reachable through the UI; requires concurrent platform mutations on the same school. Pre-existing pattern — the PR added server-side revalidation but did not change the write shape. |
| Impact | Narrow TOCTOU window on a single row; no data loss beyond the audit trail duplicate. |
| Recommended fix | Switch to a conditional update — `db.school.updateMany({ where: { id, status: 'PENDING' } })` — and treat 0 updated rows as CONFLICT. |
| Status | **OPEN** |

### P3-F4 — School override can enable a module whose platform master switch is off

| Field | Detail |
|---|---|
| Location | `src/components/platform/modules/school-setup-wizard.tsx:1958,2020` (`ModulesEditor`) + resolver `src/lib/platform/module-flags.ts:56` (`isModuleEnabled`) |
| Finding | The wizard's Modules step lets a Super Admin set a **school override** that enables a module whose **platform master** switch is off; in the pre-existing resolver the school flag beats the master, so the module becomes effectively enabled. |
| Evidence | Wizard Modules step: flip a module labeled `source: platform master` + unavailable → PATCH accepted → effective true (verified in the independent review, audit §8/§16). The UI labels the source honestly. |
| Impact | Inherited Phase 7.5 product semantic, not a Phase 2 regression. School users cannot write these flags at all; only a platform Super Admin can produce the state. Product-intent question, not a defect. |
| Recommended fix | Decide whether the platform master should be a hard floor. If yes, change the resolver platform-wide (a Phase 3 candidate, touching every consumer of `isModuleEnabled`), not just the wizard. |
| Status | **OPEN** |

---

## INFO observations (recorded for completeness; no action forced)

| ID | Location | Observation | Recommendation |
|---|---|---|---|
| INFO-O1 | (cross-reference to P3-F4) | Module governance semantic documented above. | Fold into the P3-F4 decision. |
| INFO-O2 | `branding-logo/route.ts:117-121` | Replaced logo/favicon bytes are not deleted (old fileId kept in storage + registry; audit records `replaced`). Identical to the existing school-side upload pipeline. | Best-effort delete of the replaced fileId (platform-wide backlog). |
| INFO-O3 | `schools/[id]/route.ts:311-327` | Whole-column read-modify-write of the `settings` JSON outside a transaction — concurrent writers to different keys can drop one. Single-operator wizard surface; pattern shared with provisioning. | Move settings merges into a transaction or a `$command` JSONB merge (platform-wide). |
| INFO-O4 | Wizard UI | Action labels differ from the brief's letter: "Save" instead of "Save for Later"; accordion replaces a "Back" button. Data-preservation semantics verified (any step reopenable, refresh-safe). | None needed. |
| INFO-O5 | Step navigation | Steps are component state, not deep-link URLs (resume = first incomplete step on load). | Optional Phase 3 nicety; the Phase 1 route-promotion gate already covers future `/setup/*` deep links. |

---

*Created after the Phase 2 merge (PR #70, merge commit `13972b9190ac4f58888592d96d89813a4d8bc4d1`).
Item locations and impacts are quoted from the PHASE 2 independent review; line numbers were
re-verified against the merged tree. Do not close items without either a fix or an explicit,
documented acceptance decision.*
