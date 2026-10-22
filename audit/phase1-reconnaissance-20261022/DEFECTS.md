# PHASE 1/9 — DEFECTS (confirmed vs suspected, severity, repro, impact, minimal fix)

Ledger discipline: every "Confirmed" row has reproduction evidence from this phase (code chain + deterministic repro + production read-only rows + local test runs). "Suspected/Observation" rows are explicitly labeled as such. No fixes were applied in Phase 1.

---

## D1 — CONFIRMED PRODUCT DEFECT (P1, display)

**"Grade 0" grouping swallows all wizard-created classes and miscounts their sections**

| | |
|---|---|
| Severity | **P1** — primary navigation surface (Classes) of a brand-new tenant shows one wrong "Grade 0" card with N duplicated-looking section chips instead of the real 12 classes; class pickers in Students/Exams/Certificates etc. inherit it. Currently affects 1 production school (SBS SHIKSHA NIKETAN) with zero dependent records. |
| Type | Display/mapping error (no data corruption) |
| Location | `src/lib/store/students-store/server-sync.ts` — `gradeFor` (null/non-numeric → 0), `groupKeyOf` (`G0`), `groupLabelOf` (`Grade 0`); trigger: `src/app/api/platform/schools/route.ts:1154` bootstrap never sets `gradeLevel`; also `src/app/api/classes/route.ts:57` (`''`), `src/app/api/timetable/publish/route.ts:83` (null) |
| Repro | (a) Production rows: 12 × `Class 1..12`, `gradeLevel NULL`, section 'A' (read 2026-10-22). (b) Deterministic: repo's own `mapRosterToRecords` on that payload → 1 group `name="Grade 0"`, 12 sections `[A×12]`; control (gradeLevel set) → 12 groups. |
| Impact | Blast radius ≈ 65 school-plane store consumers (Classes grid, Students, exam class pickers via academic resolver, certificates, transport, messaging, downloads). Pre-existing sibling: demo tenant's Nursery/LKG/IKG rows merge into "Grade 0 · 3 sections". |
| Minimal fix | Display-layer: derive grade/group/label from the class NAME when gradeLevel is missing; pre-primary labels form named groups (never 0). + regression test on the wizard payload shape. Optional secondary: persist gradeLevel at the three write paths. **No production data changes required.** |
| Detection gap | Shipped because no test covers wizard-created class display; CI green at every merge (the 785-line wizard API test asserts DB rows, not the roster mapping). |

## D2 — CONFIRMED TEST ROBUSTNESS DEFECT (P3, test-only)

**Directory sort test assumes JS `localeCompare` ≡ Postgres `ORDER BY` for every school name**

| | |
|---|---|
| Severity | P3 (latent; only bites a polluted corpus) |
| Location | `tests/api/schools-management-overhaul.test.ts:252` |
| Repro | Failed locally with leftover `Reliability Test 91259887-dcec08/-ef6911` schools in the shared DB: 2 rows ordered differently by Postgres collation vs `localeCompare`. Clean-corpus re-run: pass. CI green (CI corpora only carry names where the orders agree). |
| Impact | False-red potential in any environment with dashed/uppercase-mixed school names (e.g., a dev DB after aborted suite runs). |
| Minimal fix | Assert ordering against a DB-side ordering (e.g., compare with the same SQL collation) or restrict the assertion to the corpus tenants' names; keep the invariant intent. |

## D3 — OBSERVATION, NOT A PRODUCT DEFECT (environment class)

**Provisioning POSTs held 45–65 s during Next dev lazy-compilation restart windows (local 4 GB box)**

| | |
|---|---|
| Evidence | `POST /api/platform/schools 200 in 65s (compile: 2ms … render: 65s)` in service.log; "Hot Module Replacement is not enabled. Waiting for process restart…" and memory-guard restart lines adjacent; the held requests completed **correctly** (audit row + email + 200). One wizard test (45 s budget) timed out twice because of this hold. |
| Classification | Infrastructure (dev-server restart window), same family as CI's documented ECONNRESET flake ledger (fd14234 pack §5). Provisions are normally 57–170 ms (measured). |
| Follow-up | None product-side. Optionally record in the flake ledger; the test's 45 s budget is fine for CI-grade runners. |

## D4 — OBSERVATION (documentation mismatch, P4)

**`docs/SCHOOL_FACTORY.md` §2 describes a 6-step wizard; the shipped wizard is 7 steps** (Identity → Subscription → Academic → Branding → Address → Review → Create; step ids 1–6 + Create, per provision-wizard.tsx STEPS + fd14234 verification pack). The doc's step table also omits the subscription-terms step content and the precheck/prefix-preview behavior. Doc-only fix; code and tests are the authority.

## D5 — OBSERVATION (state fact, no action)

**Green Valley Public School has zero `Class` rows** (pre-wizard tenant; academic bootstrap was optional and empty at creation). Readiness filters already treat it as "incomplete". Not a defect; recorded because any Phase 2 click-through on Green Valley must create its academic backbone first (or use Hawkings/SSN).

## Suspected but NOT confirmed this phase (explicitly listed to avoid silent inflation)

- **Live Razorpay settlement reconciliation** — contract-verified via sandbox batteries; live money movement was not re-verified (no new evidence either way; remains the P1 user-side item prior audits already flag).
- **E2E journey failures** — all evidence points to the documented 4 GB box memory-guard class (7/25 pass when healthy, CI green at same SHA); no product signal. Would become a defect only if reproduced on a CI-grade environment.

## Urgent security issues found

**None.** Secrets-scan suite green; no credential values appear in this pack; the read-only production channel used the established Management API pipeline with SELECT-only discipline. No exposed reset tokens, webhook secrets or private student data were observed in any artifact this phase.
