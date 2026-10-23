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
| 2 | stored value invalid/absent AND the class NAME matches an EXPLICIT academic pattern — keyword-anchored (`Class`/`Grade`/`Std`/`Standard` as a whole word + number), section-first (`6-A`, 1–2 digits + dash family + marker), or a pure 1–2-digit number — AND the name does NOT match the pre-primary regex *(condition tightened twice: final-review amendment §7, final refinement §8)* | parsed from the name's declared grade (≥1; `"Class 6"→6`, `"6-A"→6`, `"Grade 9 - A"→9`, `"Std 8"→8`, `"6"→6`) | `G{grade}` (+stream) | **the real class name** (+ stream suffix) — never a synthesized “Grade 0” | `levelFor(grade)` |
| 3 | no valid stored grade AND (no explicit academic pattern in the name OR the name matches the pre-primary regex) — years (`"Batch 2026"`, `"2026"`), rooms (`"Room 12"`), custom group numbers (`"Group 3"`) live here, by design | 0 (internal only) | `N:{normalized name}` (+stream) | **the real class name** (+ stream suffix) | `Pre-Primary` when the name matches the pre-primary regex, else the established unknown-grade bucket (Primary) |

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

---

## 7. FINAL-REVIEW AMENDMENT (2026-10-23, PR #57 follow-up on the same branch) — number-bearing pre-primary names

**Finding (D1a):** the rule-2-first ordering parsed `"Nursery 2"` as grade 2 (`G2`) — so a tenant holding both a pre-primary `"Nursery 2"` and a real `"Class 2"` rendered ONE merged card (pre-primary stage swallowed as a section of an academic grade). That violates this policy's own §2 invariant ("never merging unrelated classes into one group") and diverges from the allocation picker — the implementation whose regex this mapper adopted — which checks its pre-primary regex BEFORE any number parse (`use-academic-allocation.ts groupLabelOf`: regex line first, `gradeNumberOf` second).

**Amendment (smallest scoped correction, same canonical mapper):** in `resolveGroupOf`, the pre-primary regex is now consulted BEFORE the name-number parse (stored valid grades remain rule 1 and are never overridden). Consequences, all pinned by tests:

- `"Nursery 2"` / `"LKG 2"` / `"UKG 2"` / `"KG 2"` / `"Pre-Primary 1"` → own NAMED group (`N:nursery 2`, …), grade 0, level **Pre-Primary** — never `G1`/`G2`, never merged with an academic class.
- A row with a VALID stored grade keeps rule 1 regardless of its name (`"Nursery 2"` + gradeLevel `'2'` → `G2 "Grade 2"`) — the mission's stored-data-is-authoritative rule is untouched.
- Numberless names (Nursery/LKG/UKG/IKG/Diploma/…) are unaffected (they reached rule 3 anyway).

**Unusual-name case table agreed and pinned this follow-up (expected grade / key / label / level):**

| Name (gradeLevel NULL unless noted) | Grade | Key | Label | Level | Note |
|---|---|---|---|---|---|
| `Batch 2026` | ~~2026 / `G2026` / Senior Secondary~~ **SUPERSEDED by the final refinement (§8)** → 0 / `N:batch 2026` / `Batch 2026` / Primary | a year is not an academic grade; the earlier accepted-edge position was replaced by the pattern-anchored parse the same day (see §8) |
| `Nursery 2` | 0 | `N:nursery 2` | `Nursery 2` | Pre-Primary | D1a correction (this section) |
| `Nursery 2` with stored `'2'` | 2 | `G2` | `Grade 2` | Primary | rule 1 — stored valid grade wins |
| `Grade 9 - A` | 9 | `G9` | `Grade 9 - A` | Secondary | merges with `Class 9` = CORRECT (same academic grade) |
| `Class 0` | 0 | `N:class 0` | `Class 0` | Primary (unknown-grade bucket) | **ambiguity documented, not guessed**: some curricula treat "Class 0" as pre-primary; the regex does not recognize it and was NOT extended on a guess. Invariants hold: own group, real name, never "Grade 0". |
| `Class 01` | 1 | `G1` | `Class 01` (standalone) / `Grade 1` (when a stored-'1' row sorts first) | Primary | zero-padding must not split grade 1; cross-path merge with `Class 1`/stored-`1` rows is CORRECT |
| `''` / `'   '` | 0 | `N:` | `''` | Primary | **API-FORBIDDEN** (wizard `safeText(40).min(1)` → 422; `/api/classes` throws 'Class name is required'; publish `.filter(Boolean)`); defensive mapper pin only: no crash, isolated group |

---

## 8. FINAL BEHAVIOUR REFINEMENT (2026-10-23, PR #57) — pattern-anchored name→grade parsing

**Owner directive (same day as §7):** the earlier “year-in-name is an accepted edge” position was rejected by the owner — `"Batch 2026"` must NOT become academic grade 2026, `"Room 12"` must not merge into grade 12, `"Group 3"` must not merge into grade 3. **Do not parse the first arbitrary number from every class name** — a number is a grade only when the name declares it as one.

**Amendment (smallest scoped change, same canonical mapper, one function):** `gradeFromClassName` is now PATTERN-ANCHORED instead of first-number-anywhere. Three explicit patterns, all backed by repository conventions:

| Pattern | Regex | Repository evidence |
|---|---|---|
| keyword-anchored | `\b(class|grade|std|standard)\b[\s._#:–-]*(\d+)` (whole-word, case-insensitive) | wizard `CLASS_PRESETS` → `"Class N"`; timetable-publish → `"Grade 9 - A"`; `"Std 8"`/`"Standard 8"` supported common operator spellings (task directive). Word-boundary: `"Classroom 5"` is NOT `"Class 5"` |
| section-first | `^(\d{1,2})\s*[–-]\s*\S+` | the demo corpus's own numeric row shape `"1-A".."12-A"`; the given example `"6-A"` |
| pure number | `^(\d{1,2})$` (WHOLE token) | a bare `"6"` is unambiguous; taking the whole token means years (`"2026"`) can never parse |

**No hard 1–12 cap** (directive honored): a non-matching name falls to its OWN named group (rule 3), so no cap can ever collide unrelated names into one group. A valid stored grade (rule 1) remains authoritative and is never overridden. Pre-primary recognition (§7) remains BEFORE the parse.

**Case table added this refinement (grade / key / label / level):**

| Name (gradeLevel NULL) | Grade | Key | Label | Level | Note |
|---|---|---|---|---|---|
| `Batch 2026` | 0 | `N:batch 2026` | `Batch 2026` | Primary (unknown-grade bucket) | never `G2026`; never merges with any academic group |
| `Room 12` | 0 | `N:room 12` | `Room 12` | Primary | never merges with `G12` ("Room 101" exists only as a ROOM-model name in seeds — no class-naming convention uses rooms) |
| `Group 3` | 0 | `N:group 3` | `Group 3` | Primary | never merges with `G3`; census found NO academic `"Group N"` format in any write path, seed, or corpus |
| `Std 8` / `Standard 8` | 8 | `G8` | real name | Middle | merges with `Class 8` — same academic grade (directive: supported patterns) |
| `6-A` (NULL) | 6 | `G6` | `6-A` | Middle | section-first; the corpus row shape |
| `6` (pure number) | 6 | `G6` | `6` | Middle | merges with `Class 6` (zero-padding family — like `Class 01` → `G1`) |
| `2026` (year alone) | 0 | `N:2026` | `2026` | Primary | 4-digit token cannot parse as a grade (pure-number takes the WHOLE token) |
| `Classroom 5` | 0 | `N:classroom 5` | `Classroom 5` | Primary | whole-word keyword — `"classroom"` ≠ `"class"`; never `G5` |

**Red-green proof (command output, TEST-RESULTS.md §12):** new battery 40 pass / **9 fail** against the pre-refinement implementation (exactly the incidental-number family: Batch ×3, Room 12, Group 3, Batch-vs-Diploma, Classroom 5, year "2026", corpus Batch-student resolution) → **49 pass / 0 fail** after the one-function change.

**Documented divergence (unchanged, display-only surfaces):** the allocation picker (`use-academic-allocation.ts gradeNumberOf /\d{1,2}/`) and the store's local `createClass` (`/(\d+)/`, default grade 1) keep their own first-number ladders — their buckets/records are local and display-only; the canonical mapper is the one that builds the shared ClassRecord universe. The wizard-repro evidence (cases A–K, X, Y) remains BYTE-IDENTICAL under the refinement (verified by diff against `evidence-repro-mapper-POSTFIX.txt`).
