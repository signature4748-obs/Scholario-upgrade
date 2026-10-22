# PHASE 2/9 — CLASS-GROUPING-POLICY (canonical semantics, adopted this phase)

Decision date: 2026-10-22/23 · Applies to: the school-plane class grouping (roster → students-store ClassRecord universe) implemented in `src/lib/store/students-store/server-sync.ts` (`resolveGroupOf`, introduced this phase).

---

## 1. Implementation census (STEP D search — every grouping/parse implementation)

| Implementation | Location | Input | Fallback policy | Consumers |
|---|---|---|---|---|
| **CANONICAL roster mapper** | `src/lib/store/students-store/server-sync.ts` — `mapRosterToRecords` + `resolveGroupOf`/`gradeFromStored`/`gradeFromClassName`/`PRE_PRIMARY_NAME_RE`/`levelFor` | roster Class rows (name, gradeLevel, section, stream) | **this policy** | the students store (`useStudentsStore`) → **53 files** across principal/student planes (Classes grid, student pickers, exam class pickers via `src/lib/mock/academic/resolver.ts`, certificates, transport, messaging, downloads, student panel) |
| Teacher allocation picker | `src/components/principal/modules/teachers/use-academic-allocation.ts` — `gradeNumberOf` (`/(\d{1,2})/`), `groupLabelOf` (pre-primary regex → buckets, else 'Other') | class NAME only (its API carries no gradeLevel) | name-parse + bucket | teacher allocation modal only |
| Store-side createClass | `src/lib/store/students-store/store.ts:609-612` — `/(\d+)/` name parse, default grade **1** (never 0), ladder `≤2 Pre-Primary · ≤5 Primary · ≤8 Middle · ≤10 Secondary · else Senior` | NAME | name-parse, default 1 | locally added classes (pre-sync) |
| Seed corpus | `prisma/seed.ts` / `seed-identity.ts` (`numericLevel`: 1..12 else null; `DEMO_CLASS_LEVELS` gradeLevel always set) | seed data | seeds are authoritative for the demo tenant | demo corpus |
| Percentage-grade converters (unrelated, name-collision only) | `gradeFor(pct)` in student-results-store, results API, marks grid, certificates, report cards | marks % | letter banding | out of scope — NOT class grouping |

**Conclusion: one canonical mapper exists** (`mapRosterToRecords`); the fix landed there and nowhere else, so all 53 store consumers inherit it with zero duplicated fallback logic. The allocation picker keeps its own name-based grouping (its API contract has no gradeLevel); its regex is the origin of the pre-primary name recognition, extended here with `ikg` (see §4).

## 2. Source-of-truth policy (the rule the canonical mapper now implements)

For each roster Class row, resolve in this order:

| Priority | Condition | Grade | Group key | Group label | Level |
|---|---|---|---|---|---|
| 1 | stored `gradeLevel` is a valid number > 0 (`''`, null, `'0'`, `'abc'`, `'6x'` are NOT) | the stored value | `G{grade}` (+`-SCI`/`-COM` stream suffix) | `Grade {n}` (+ stream suffix) — **unchanged legacy behavior** | `levelFor(grade)` ladder (unchanged) |
| 2 | stored value invalid/absent AND the class NAME contains a number | parsed from the name (first number, ≥1; `"Class 6"→6`, `"6-A"→6`, `"Grade 9 - A"→9`) | `G{grade}` (+stream) | **the real class name** (+ stream suffix) — never a synthesized “Grade 0” | `levelFor(grade)` |
| 3 | no valid stored grade AND no number in the name | 0 (internal only) | `N:{normalized name}` (+stream) | **the real class name** (+ stream suffix) | `Pre-Primary` when the name matches the pre-primary regex, else the established unknown-grade bucket (Primary) |

**Never:** numeric 0 as a group key, a synthesized “Grade 0” label, or merging unrelated classes into one group. **Never:** letting the name override a VALID stored grade (a disagreeing valid `gradeLevel` wins — pinned by test; matches the mission's “do not assume the class name is authoritative when an explicitly stored valid grade conflicts with it”).

## 3. Case table (each mission STEP D case)

| Case | Rule | Example → result |
|---|---|---|
| Numeric classes 1–12 | rule 2 (wizard rows, gradeLevel NULL) | “Class 1..12” → 12 groups `G1..G12`, labels = real names |
| Nursery / LKG / UKG | rule 3 | each name its own group `N:nursery|lkg|ukg`, level Pre-Primary |
| Legacy names (IKG) | rule 3 (regex extended with `ikg`) | “IKG”/“IKG-A” → own group, level Pre-Primary (the allocation picker's own regex misses IKG — `\bkg\b` needs a boundary “IKG” doesn't have; the seed corpus and store ladder both treat IKG as pre-primary, so the canonical regex includes it) |
| Missing/null gradeLevel | rule 2 then 3 | wizard/`''`/publish rows |
| Valid gradeLevel disagreeing with name | rule 1 — stored wins | name “Class 9”, gradeLevel '7' → `G7 “Grade 7”` |
| Arbitrary/custom names | rule 3 | “Diploma” → own group `N:diploma` (not merged, not Grade 0) |
| Multiple sections of one class | sections of rows sharing a group key merge (unchanged semantic) | “Class 5” A/B/C → one group, sections [A,B,C]; case-variant names of one class merge (`Nursery`/`nursery`) |
| 11–12 stream/group metadata | stream suffix preserved on key and label for ALL rule paths | wizard “Class 11”+Science → `G11-SCI “Class 11 (Science)”` (same convention as legacy “Grade 11 (Science)”) |

## 4. Backward-compatibility analysis (what intentionally changes vs what cannot)

**Unchanged (byte-identical) for every row with a valid stored gradeLevel:**
- key `G{grade}`(+stream), label `Grade N`(+stream), level ladder, sections aggregation, student className. The demo tenant's numeric rows render exactly as before. CI suites (exam resolver ordering, certificates, etc.) untouched — verified by the full unit/integration/regression re-run (TEST-RESULTS.md).

**Changed (intentionally — all previously broken displays):**
| Surface | Before | After |
|---|---|---|
| Wizard-created classes (gradeLevel NULL) | one “Grade 0” card with N sections | N cards named after the real classes |
| Add-Class rows (gradeLevel '') | merged into “Grade 0” | named groups by their name |
| Timetable-publish auto-created rows | “Grade 0” | named groups by their label |
| Demo pre-primary trio (Nursery-A/LKG-A/IKG-A) | one “Grade 0 · 3 sections” card | three named Pre-Primary cards |
| Any numberless custom class | “Grade 0” | its own named card |

**Known display-order quirk (pre-existing, intentionally NOT changed this phase):** the roster API orders by `gradeLevel` as a STRING ('1','10','11','12','2'…, NULLS LAST) and the Classes grid renders insertion order, so the demo tenant's grid lists Grade 1, 10, 11, 12, 2… — unchanged by this fix (wizard tenants: NULL rows keep payload order = bootstrap order, i.e. Class 1…12 as provisioned). Sorting the grid numerically is a candidate follow-up (PHASE3-PLAN), deliberately out of the minimal fix.

**Mixed-label edge case (documented):** a tenant holding BOTH legacy rows (valid gradeLevel, label “Grade 6”) and wizard rows (NULL, label “Class 6”) for the same grade shares ONE group whose label follows the first row the API returns (stored grades sort before NULL) → “Grade 6”. Deterministic; noted in tests.

**Section-null rows:** the `section ?? 'A'` default chip is a store-wide convention (student matching, seed universe, createClass) — kept as-is; documented.

## 5. Alternatives considered and rejected (minimal-fix rationale)

1. **Always label from the real name (also for valid grades)** — rejected: changes the demo tenant's established “Grade N” labels and every dependent screenshot/test for cosmetic gain; not required to fix D1. Revisit only with owner approval.
2. **Persist gradeLevel at the three write paths (bootstrap, /api/classes, timetable-publish)** — deferred (was already optional in the Phase 1 plan): a data-shape change with no additional user-visible symptom once the display layer is fixed; no production backfill is required or authorized. Kept as a Phase 3 option.
3. **Sort the Classes grid numerically** — deferred (display-order quirk above; orthogonal to the defect).
4. **Extending `ClassRecord['level']` union with 'Other'** — rejected: level is display/filter-only and the union is shared; the established bucket keeps the type closed.

## 6. Affected consumers (quantified)

- `useStudentsStore` consumers: **53 files** (grep census 2026-10-23) — principal (Classes grid/cards/details, Students, Exams via resolver, Certificates, Transport, Messaging, Fees, Downloads, Settings), student panel, cross-cutting stores (fee/messaging/certificates/transport/library/rooms/class-responsibility).
- All inherit the fix through the single canonical mapper; no per-consumer changes; no consumer pattern-matches the `G*` id format (grep-verified) so the new `N:*` keys are safe.
- Platform plane (schools directory, wizard success panel, readiness, audit): does NOT read the store — unaffected.
