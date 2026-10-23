# PHASE 2/9 → PHASE 3 EXECUTION PLAN (prioritized; for review with the Phase 2 report)

Standing constraints inherited: no redesign/rewrite, no production data surgery, test tenants only, evidence-first, every code change rides the established PR + CI + Release pipeline, STOP for owner approval where behavior could change.

## Step 1 — Land the D1 fix (this phase's deliverable)

1. Review `fix/phase2-class-grouping-d1` (mapper fix + 21-test battery + this audit pack). PR open after gates (see TEST-RESULTS.md — typecheck/lint/unit/integration/regression/wizard/readiness/overhaul all green).
2. Merge → CI all-green → Release on the merge SHA → verify both Vercel planes READY on that SHA (BASELINE §3 pattern). No DB migration involved; **no production backfill**.
3. Production spot-check (owner's 2-minute path): sign in as SBS SHIKSHA NIKETAN's principal → Classes → expect 12 cards “Class 1…Class 12” (M2-02 on production). Read-only sign-in only.

## Step 2 — Close the remaining Phase 1/2 ledger items (small, separate PRs)

| Item | Change | Size |
|---|---|---|
| D2 sort-test robustness | fix the `localeCompare` ≡ SQL collation assumption in `tests/api/schools-management-overhaul.test.ts:252` (scope the assertion to corpus names or compare DB-side) | test-only, one-line class |
| D7 write-path hygiene | `POST /api/classes`: persist `null` instead of `''` when gradeLevel is omitted (+contract test). **No backfill** | one line + test |
| D6 display order | numerically order the grouped ClassRecords (mapper) or roster `orderBy` — pick ONE layer, with tests for both demo and wizard shapes | small, needs owner sign-off on expected order (pre-primary first or last) |
| D4 doc drift | update `docs/SCHOOL_FACTORY.md` §2 to the shipped 7-step wizard | docs only |
| Picker regex | extend `use-academic-allocation.ts` groupLabelOf with `ikg` (parity with the canonical mapper) | one regex token + test |
| Optional (owner decision) | persist `gradeLevel` at the wizard bootstrap + timetable-publish paths (data honesty for future ordering consumers; no display dependency) | small; no migration needed for new rows; any historical backfill stays forbidden without its own evidence gate |

## Step 3 — UI walk of the onboarding spine (TEST-MATRIX conversions)

Execute M1-05 (full 7-step wizard UI walk on a fresh throwaway tenant — this phase proved the post-provision surfaces; the wizard's own click-through with screenshots remains), M1-06 (school record tabs), M2-01 (tenant door + forced change — **API+UI verified this phase**, formalize the row with evidence links), and pin M2-02 as PASS with this pack's evidence.

## Step 4 — Principal module sweep (M2-03…M2-14)

Per TEST-MATRIX priority: Students & Classes first (Add Class flow M2-03 — note the D1-trigger-2 path now displays correctly; verify), then Fees, Exams (create-exam class picker now shows named classes — verify against a wizard tenant), Admissions. One validation error + one refresh/repeat + one cross-tenant negative per row where specified.

## Step 5 — Teacher & student sweeps + cross-cutting leftovers (M3-*, M4-*, M5-06 mobile)

## Step 6 — Close the ledger

Update DEFECTS.md/TEST-MATRIX.md with evidence links; produce the Phase 3 pack (`audit/phase3-…`); carry the standing user-side P1 (live Razorpay settlement reconciliation) forward explicitly.

## Gates

- Steps 1–2 are code changes: one PR each, CI all-green, minimal and revertible; no batching of unrelated changes.
- Steps 3–5 are test executions (artifacts only).
- Environment honesty: E2E journeys and heavy browser walks stay on the documented limitation list for this box; when the box OOM-cycles, run the affected row as the owner spot-check against production (read-only) per the fd14234 §7.1 pattern, or defer to CI.
