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

---

# FINAL-REVIEW FOLLOW-UP (2026-10-23, PR #57 @ 74f9e43 → follow-up commit on the same branch)

## D1a — Number-bearing pre-primary names merged into academic-grade groups (P2, display; found by the final-review unusual-name battery) — **FIXED THIS FOLLOW-UP**

| | |
|---|---|
| Observation | With gradeLevel absent, `"Nursery 2"` parsed as **grade 2** (`G2`) under rule-2-first ordering — so a tenant holding both a pre-primary `"Nursery 2"` and a real `"Class 2"` rendered ONE merged card (pre-primary stage swallowed as a section of an academic grade). Same defect family as D1 (unrelated classes merged into one group) |
| Reproduction | Test-first, deterministic: the 4 new reds pre-correction were exactly this family (`"Nursery 2"` resolves pre-primary / never merges with `"Class 2"` / `"LKG 2","UKG 2","KG 2","Pre-Primary 1"` / student-resolution corpus) — `bun test tests/unit/students-store-class-grouping.test.ts` → **35 pass / 4 fail**, all four failures in this family, all other new cases green. No live/UI repro needed: the mapper is deterministic and the defect is fully specified at that level |
| Why it is a real defect, not a guess | The adopted policy's own §2 invariant says “never merging unrelated classes into one group” (a nursery stage is not grade 2); and the allocation picker — the implementation whose pre-primary regex this mapper adopted — checks its regex BEFORE any number parse (`groupLabelOf`: regex first, `gradeNumberOf` second), i.e. the repository's own established semantics classify `"Nursery 2"` as pre-primary |
| Fix (smallest scoped) | ONE branch inserted in `resolveGroupOf` (canonical mapper only): consult `PRE_PRIMARY_NAME_RE` before the name-number parse. Rule 1 (valid stored grade wins) untouched — pinned by a dedicated test (`"Nursery 2"` + stored `'2'` → `G2 "Grade 2"`). 39-test battery green; repro-mapper cases A–K,X,Y byte-identical to the committed POSTFIX evidence (the correction touches only the number-bearing pre-primary sub-family, which A–K never covered) |
| Verification | Targeted 39/0 · typecheck 0 · lint 0e/57w (baseline) · unit 295/0 (277+18 new) · integration 49/0 · regression 178/0 · repro-mapper all-cases pass (TEST-RESULTS.md §8–§9) |
| Status | **FIXED on branch `fix/phase2-class-grouping-d1` (pending review/merge/deploy)**. Display-layer only; no production data involved |
| Residuals | None for this sub-family. The picker itself keeps its own (now-parity) regex+ordering; its missing `ikg` token remains the separate observation above |

## Unresolved decisions from the final review (documented ambiguities — deliberately NOT guessed)

1. **`"Class 0"` level**: could be pre-primary in some curricula; the pre-primary regex does not recognize it and was NOT extended on a guess. Current: own named group `N:class 0`, level = the established unknown-grade bucket (Primary). Owner decision if a real tenant ever uses this name.
2. **Year-in-name (`"Batch 2026"` → grade 2026, level Senior-Secondary via the ladder's else-bucket)**: accepted edge. Isolated group + real-name label mean no D1-family symptom is possible; a parse cap was REJECTED (any cap would merge the batch into a real grade group). If an owner wants year-named batches displayed differently, that is a Phase 3 UX decision, not a defect.
3. **Mixed-data group label**: a tenant holding both legacy rows (label “Grade 6”) and wizard rows (label “Class 6”) for the same grade shares ONE group whose label follows the first row the API returns (stored grades sort before NULLs → “Grade 6” in practice). Deterministic per order; both labels truthful. Pinned in tests both ways; no change.
4. **Empty/whitespace class names**: API-FORBIDDEN on all three write paths (wizard zod `safeText(40).min(1)` → 422; `/api/classes` throws; timetable-publish `.filter(Boolean)`). The mapper's defensive no-crash pin documents the unreachable shape. If a future write path ever permits empty names, a display-fallback decision will be needed THEN, not guessed now.

## Suspected-but-unconfirmed (unchanged from Phase 1)

- Live Razorpay settlement reconciliation (user-side P1; no new evidence this phase — out of scope here).
- No urgent security issue found this phase. No secrets/PII in any artifact (grep + review discipline; re-verified on the follow-up diff).
