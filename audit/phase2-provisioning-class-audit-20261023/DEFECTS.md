# PHASE 2/9 — DEFECTS (Phase 2 ledger update; Phase 1 rows carried with status changes)

Ledger discipline unchanged: every row carries reproduction evidence and its current status. Phase 1 evidence lives in `audit/phase1-reconnaissance-20261022/` (not modified). This phase's evidence lives in this directory.

---

## D1 — Grade-0 grouping (P1, display) — **FIXED THIS PHASE** (code change landed on the Phase 2 branch; NOT yet merged/deployed)

**“Grade 0” grouping swallowed all wizard-created classes and miscounted their sections.**

| | |
|---|---|
| Root cause | `src/lib/store/students-store/server-sync.ts` pre-fix `gradeFor`: `Number(null|''|'Nursery')` → 0 for every row whose stored `gradeLevel` was null/empty/non-numeric (the wizard bootstrap never writes `gradeLevel`; `/api/classes` writes `''` when omitted; timetable-publish writes nothing) → one shared `G0` group labeled “Grade 0” whose `sections[]` absorbed all real classes |
| Reproduction | Three levels this phase: deterministic mapper (L1), live API chain on throwaway tenants (L2), live browser UI (L3 — “TOTAL CLASSES 1”, single “View Grade 0” card, “12 sections”). See REPRODUCTION-RESULTS.md; pre/post evidence files in this directory |
| Fix (this phase) | Canonical mapper only: `resolveGroupOf` implements the CLASS-GROUPING-POLICY (stored valid grade authoritative → unchanged “Grade N” groups; missing/invalid → grade from the class NAME with the real name as label; numberless names → own named group, pre-primary → 'Pre-Primary' level; never numeric 0). 21 regression tests pin the contract incl. all three write-path shapes |
| Verification | Battery red→green (3/17 → 21/0); live chain pre→post (1 “Grade 0” group → 12 named groups); UI pre→post (M2-02 FAIL→PASS with screenshots); all targeted suites green (TEST-RESULTS.md §2–§3) |
| Status | **FIXED on branch `fix/phase2-class-grouping-d1` (pending review/merge/deploy)**. Production display (SBS SHIKSHA NIKETAN) will heal when the fix ships — **no production data change is required or performed** |
| Residuals | Display-order quirk (roster orders `gradeLevel` as string; the Classes grid renders insertion order) — pre-existing, now tracked as **D6** |

## D2 — Sort-test collation assumption (P3, test-only) — **UNFIXED this phase (by design)**

Phase 1 finding stands: `tests/api/schools-management-overhaul.test.ts:252`'s ordering assertion assumes JS `localeCompare` ≡ Postgres `ORDER BY` for every name. Not touched this phase (out of scope; the suite is green on a clean corpus — verified again this session, TEST-RESULTS.md §3 row 9). Remains the small test-only PR proposed for Phase 3.

## D3 — Dev-server restart windows hold in-flight requests (environment class) — re-observed

One new instance this phase, with a sharper signature: a kernel OOM kill of `next-server` (anon-rss ≈ 3.2 GB) during the browser walk — the documented 4 GB-box class (Phase 1 BASELINE §5/§6, fd14234 §7.1). The supervision loop recovered it; the interrupted walk completed after one retry. Captured in `ui-01-mid-oom-restart-window.png` + REPRODUCTION-RESULTS.md. Classification unchanged: infrastructure, not product.

## D4 — `docs/SCHOOL_FACTORY.md` 6-vs-7 step drift (P4, docs) — **UNFIXED this phase**

Doc-only fix, deferred (no code dependency; the wizard code + tests are the authority). Carried to Phase 3.

## D5 — Green Valley has zero Class rows (state fact) — unchanged

No action. (This phase's wizard walks used fresh throwaway tenants, never Green Valley.)

---

## NEW this phase

## D6 — Class-grid display order is string-collation of `gradeLevel` (P4, display; pre-existing)

| | |
|---|---|
| Observation | `GET /api/students/roster` orders classes by `gradeLevel` **as a string** and the Classes grid renders insertion order — so the demo tenant lists “Grade 1, Grade 10, Grade 11, Grade 12, Grade 2, …” and NULL-grade (wizard) tenants render payload/bootstrap order. Numeric rows were never numerically sorted on the school plane (the exam picker's resolver sorts numerically for its own list) |
| Evidence | roster/route.ts:106 `orderBy: [{gradeLevel:'asc'},{section:'asc'}]`; live L2 CASE K group order in evidence-repro-live-PRE-FIX.txt/POSTFIX.txt |
| Severity | P4 display polish; NOT the D1 defect (D1 was wrong grouping/labels; this is only ordering) |
| Candidate fix (Phase 3 option) | order grouped ClassRecords numerically in the mapper (grade asc, named groups first), or add `orderBy` on name in the roster query. Deliberately NOT bundled with D1 to keep that PR minimal and revertible |

## D7 — `/api/classes` persists `gradeLevel: ''` when the caller omits it (P4, write-path hygiene; pre-existing)

| | |
|---|---|
| Observation | `String(body.gradeLevel || '')` writes `''` instead of NULL for the school-plane Add Class route. Harmless post-D1-fix (the mapper treats `''` exactly like NULL), but the persisted value is dishonest about being “unset” |
| Evidence | classes/route.ts:57; live L2 CASE I1 (persisted `""`) |
| Candidate fix | write `null` when omitted/empty (one line + one contract test). Phase 3 option — **no backfill** (display layer is correct without it) |

## Observation (not a defect): allocation-picker regex misses “IKG”

`use-academic-allocation.ts` groupLabelOf buckets a class named “IKG” as 'Other' (`\bkg\b` needs a word boundary “IKG” lacks). The canonical mapper now handles IKG as pre-primary (regex extended). The picker's own bucketing is out of this phase's scope; noted for a future teacher-module polish pass.

## Suspected-but-unconfirmed (unchanged from Phase 1)

- Live Razorpay settlement reconciliation (user-side P1; no new evidence this phase — out of scope here).
- No urgent security issue found this phase. No secrets/PII in any artifact (grep + review discipline).
