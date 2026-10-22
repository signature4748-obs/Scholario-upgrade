# PHASE 1/9 — PHASE 2 EXECUTION PLAN (prioritized)

Standing constraints (inherited from Phase 1 mission): no redesign/rewrite, no production data surgery, no secret rotation without evidence, test tenants only, evidence-first. Every change rides the established PR + CI + Release pipeline.

## Step 1 — Fix the one confirmed product defect (D1: Grade-0 grouping)

1. **Reproduce in-UI** (2-minute warm-up): provision a `Wizard Academy *` test school locally through the wizard (Class 1–12 preset), sign in as its principal, screenshot the Classes module showing the "Grade 0 · 12 sections" card (TEST-MATRIX M2-02, status FAIL baseline).
2. **Display-layer fix** in `src/lib/store/students-store/server-sync.ts`: `gradeFor`/`groupKeyOf`/`groupLabelOf` derive grade and label from the class **name** when `gradeLevel` is null/empty/non-numeric (reuse the `(\d+)` name parse the store already uses in `createClass`; pre-primary labels Nursery/LKG/IKG form their own named groups; never numeric 0; label from the real name, not synthesized "Grade N").
3. **Regression tests**: unit-level `mapRosterToRecords` cases for (a) wizard payload shape (12 × gradeLevel NULL) → 12 named groups; (b) Nursery/LKG/IKG → named pre-primary group, not 0; (c) mixed corpus (Hawkings shape) unchanged. This closes the detection gap that let D1 ship.
4. **Secondary (same PR or follow-up, small)**: persist `gradeLevel` at the three write paths (wizard bootstrap, `POST /api/classes`, timetable-publish auto-create) so server-side ordering (`roster` orders by gradeLevel) is honest too. **No production backfill** — display fix is sufficient; revisit only with its own evidence gate.
5. Ship: PR → CI (all-green required) → Release on the merge SHA → verify both planes READY on that SHA (BASELINE §3 pattern). No DB migration involved.

## Step 2 — Prove the fix end-to-end on a safe tenant

Local wizard test tenant: re-run TEST-MATRIX M2-02 → PASS with 12 named class cards; spot-check Students module class picker + Exams create-exam picker (resolver path) + section chips. Then the same row against production SSN SHIKSHA NIKETAN **read-only via UI** (login as its principal is a sign-in, not a mutation — or defer to the owner's 2-minute spot-check per the established pattern). No production writes.

## Step 3 — Test-robustness fix (D2)

Sort-test assertion in `tests/api/schools-management-overhaul.test.ts:252`: replace the JS-`localeCompare` equality with a DB-collation-faithful assertion (or scope to corpus names). One-line-class change, test-only PR.

## Step 4 — UI walk of the onboarding spine (highest-value NOT TESTED rows)

Execute TEST-MATRIX rows M1-05 (full 7-step wizard walk), M1-06 (school record tabs incl. activate/flags/domains), M2-01 (tenant door + forced password change), capturing per-row evidence (screenshots + API/DB assertions) under `audit/phase2-*/`. This converts the biggest block of NOT TESTED rows to evidence-backed statuses and re-validates the wizard at the UI level (the fd14234 pack's sandbox limitation made this impossible then; it remains the same box constraint — if the local box OOM-cycles on the authed wizard walk, run it as the documented owner spot-check against production instead, per the fd14234 §7.1 recommendation).

## Step 5 — Principal module sweep

Rows M2-03 → M2-14 in order (Students & Classes first because D1's fix lands there; then Fees, Exams, Admissions — the money-and-records spine), each with: happy path, one validation error, one refresh/repeat check, one cross-tenant negative where the row specifies.

## Step 6 — Teacher & student sweeps + cross-cutting

M3-* (attendance two-phase, marks entry, class-teacher hub, relieved-staff restricted mode) and M4-* (dashboard, learning, student checkout sandbox, subscription claim), then M5-* leftovers (session-expiry UI, feature-flag honesty UI, 390 px spot checks on shells).

## Step 7 — Close the ledger

Update DEFECTS.md + TEST-MATRIX.md statuses with evidence links; produce the Phase 2 report (same artifact pattern: `audit/phase2-<date>/`), list anything still NOT TESTED with reasons. Carry the two standing P1 user-side items forward explicitly (live Razorpay settlement reconciliation; production principal spot-check of the fixed display).

## Sequencing & gates

- Steps 1–3 are code changes: each rides its own PR with CI all-green (the flake ledger distinguishes transport-class reds; the retry procedure from the repo's history applies unchanged).
- Steps 4–6 are test executions (no code changes) — artifacts only, no releases needed beyond Step 1's.
- Do not batch Step 1 with unrelated changes; keep the D1 PR minimal and revertible.
