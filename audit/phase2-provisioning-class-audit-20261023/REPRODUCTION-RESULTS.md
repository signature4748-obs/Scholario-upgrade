# PHASE 2/9 — REPRODUCTION-RESULTS (defect matrix, three evidence levels)

All reproduction ran on the LOCAL isolated stack (embedded PG 18.4 + supervised dev server, CI-parity fixture env, `DEV_OLD_SPACE_MB=1700`). Every write targeted uniquely-named throwaway tenants (`Wizard Academy P2-*` / `Wizard Academy P2UI *`), fully purged at teardown (school count verified back to the 2 seed tenants). The demo tenants were only ever READ. **No production system was touched.**

Levels of evidence (kept explicitly separate):
- **L1 — deterministic mapper**: the repo's own `mapRosterToRecords` fed exact payload shapes; pure function, no DB/network. Script: `repro-mapper.ts`.
- **L2 — live API**: real `POST /api/platform/schools` → activate → forced password change → real login → `GET /api/students/roster` → mapper. Script: `repro-live.ts`.
- **L3 — live UI (browser)**: tenant door sign-in → forced-change screen → principal shell → Classes tab. DOM snapshots quoted below; screenshots in this directory.

Evidence files: `evidence-repro-mapper-PRE-FIX.txt` / `-POSTFIX.txt` · `evidence-repro-live-PRE-FIX.txt` / `-POSTFIX.txt` · `ui-01…ui-05*.png`.

---

## Matrix (mission STEP C cases A–K + policy probes X/Y)

| Case | Input | Expected (correct behavior) | Actual PRE-fix | Actual POST-fix | Status | Evidence |
|---|---|---|---|---|---|---|
| **A** | Wizard preset Class 1–12 × section A (gradeLevel NULL — the production shape) | 12 class cards “Class 1…Class 12”, 1 section each | L1/L2/L3: **ONE “Grade 0” group, 12 sections [A×12]** (L3 UI: “TOTAL CLASSES 1”, “12 sections”, single “View Grade 0” card) | L1/L2/L3: **12 named groups/cards** “Class 1…12”, grade = 1…12, correct level ladder | **FAIL→PASS** | L1 `evidence-repro-mapper-*` CASE A · L2 CASE A (live principal roster: 12 rows → 1 group pre / 12 groups post) · L3 `ui-02…PRE-FIX.png` / `ui-04…POSTFIX.png` + DOM snapshots below |
| **B** | Custom (operator-typed) Class 1–12 × A | same as A | identical wire shape → identical failure | identical success | **FAIL→PASS** | L1 CASE B (wire shape identical to A by construction) |
| **C** | One class, sections A,B,C (gradeLevel NULL) | one “Class 5” group with sections [A,B,C] | ONE “Grade 0” group, sections [A,B,C] | one group `G5 “Class 5”`, sections [A,B,C] | **FAIL→PASS** (shape) | L1 CASE C · L2 CASE C+D+E (8 rows → 1 group pre / 6 groups post) |
| **D** | Nursery, LKG, UKG (+IKG) rows (gradeLevel NULL) | four separate named pre-primary groups | ONE “Grade 0” group, 4 sections | four groups `N:nursery/lkg/ukg/ikg`, level Pre-Primary | **FAIL→PASS** | L1 CASE D · L2 CASE C+D+E |
| **E** | Presets 9–10 and 11–12 (+streams on 11/12) | 2 and 2+stream groups | merged “Grade 0” (streams split keys: “Grade 0 (Science)”/“Grade 0 (Commerce)”) | “Class 9”, “Class 10”, “Class 11 (Science)”, “Class 12 (Commerce)” | **FAIL→PASS** | L1 CASE E1/E2 |
| **F** | No classes selected | zero classes (readiness reports unconfigured) | 0 groups (correct); bootstrap skipped | unchanged | **PASS→PASS** | L1 CASE F · L2 CASE F+G bootstrap `{classes:1}` only for the seeded row |
| **G** | Empty/whitespace section input | empty list → one row `section: null` → default chip “A”; whitespace strings refused | `section: null` row → “Grade 0” card with chip “A”; whitespace `['  ']` → **422** (safeText trims+min1) | named card (“Class 3”), default chip “A”; 422 unchanged | **FAIL→PASS** (grouping) — section-null convention documented | L1 CASE G · L2 CASE F+G DB dump (`name="Class 3" gradeLevel=null section=null`) + G2 422 line |
| **H** | Repeated submit (same payload) | idempotent replay, no duplicates | **200 `replayed=true`, same school id, rows remain 12** | unchanged (re-run confirmed) | **PASS→PASS** (provisioning was never the defect) | L2 CASE H both evidence files |
| **I** | gradeLevel NULL (all three write paths) | named groups | “Grade 0” merge for wizard NULL (I-wizard), `/api/classes` omitted → persisted `""` → same merge (verified live: `gradeLevel=""`), publish auto-create NULL → same merge | named groups for all three shapes | **FAIL→PASS** | L1 CASE I1 (`''`)/I2 (publish shape) · L2 CASE I1 (live POST, persisted `""`, grade-0 group grew to 13 sections pre-fix) |
| **J** | Valid numeric gradeLevel ('1'..'12') | 12 “Grade N” groups | correct (control) | unchanged (byte-identical) | **PASS→PASS** | L1 CASE J · L2 CASE J (`Grade 6` group + merged sections [J, A] with the wizard row — same-grade merge is intended) |
| **K** | Demo-tenant naming (Hawkings; read-only) | numerics unchanged; pre-primary trio as 3 named groups | 13 groups: 12 correct + **one “Grade 0 · 3 sections”** (Nursery-A/LKG-A/IKG-A merged) | **15 groups** — trio now 3 named Pre-Primary cards; numerics byte-identical | **FAIL→PASS** (pre-primary only) | L1 CASE K · L2 CASE K (read-only DB rows → mapper) |
| **X** | gradeLevel '7' on name “Class 9” | stored valid grade wins | `G7 “Grade 7”` (correct already) | unchanged | **PASS→PASS** (policy pinned by test) | L1 CASE X |
| **Y** | Arbitrary numberless name (“Diploma”) | own named group | “Grade 0” | `N:diploma “Diploma”` | **FAIL→PASS** | L1 CASE Y |

### L3 UI DOM snapshots (quoted verbatim from the browser session)

Pre-fix, Classes tab (`Wizard Academy P2UI 45ea5a`, wizard-provisioned with Class 1–12 × A):
```
StaticText "TOTAL CLASSES" → "1"      StaticText "12 sections"
button "View Grade 0"                  (single card)
detail: heading "Grade 0" · "Primary · 12 sections" · CAPACITY 480 · twelve "A 0/40" chips
```
Post-fix, same tenant, same tab (after the mapper fix; no data change):
```
StaticText "TOTAL CLASSES" → "12"     StaticText "12 sections" · "12 classes"
buttons "View Class 1" … "View Class 12"
detail (Class 6): heading "Class 6" · "Middle · 1 sections" · CAPACITY 40
```
Screenshots: `ui-02-classes-grade0-PRE-FIX.png`, `ui-03-grade0-detail-PRE-FIX.png`, `ui-04-classes-12cards-POSTFIX.png`, `ui-05-class6-detail-POSTFIX.png`.

## Was the defect reproduced in the actual UI, the deterministic mapper, or both?

**Both — all three levels.** The deterministic mapper (L1) reproduces the exact production payload failure; the live API chain (L2) proves the payload shape is what the real provisioning path produces; the live browser (L3) shows the operator-visible “Grade 0 · 12 sections” card, the exact reported symptom (M2-02 FAIL), and its post-fix PASS.

## Environment limitations (honest record)

- One kernel OOM restart occurred mid-UI-walk (dmesg: `Out of memory: Killed process 25527 (next-server … anon-rss:3212164kB)`) — the documented 4 GB-box class (Phase 1 BASELINE §5/§6). The supervision loop restarted the dev server; the walk resumed after ONE retry and completed both pre- and post-fix passes. `ui-01-mid-oom-restart-window.png` + the “localhost refused to connect” DOM snapshot capture the window. No product failure was misclassified: the provisioning in flight at that moment had already committed correctly (audit row + bootstrap rows verified later).
- The dev server runs with the repo's sandbox-tuned `DEV_OLD_SPACE_MB=1700`; the 4096 MB heap is NOT applied (mission rule honored).
- The wizard API suite's first run had 1 failure of the transport class (HTTP 429 `platformMutation` 60/min — my own earlier repro provisions had consumed the shared bucket). Verified environmental cause; re-run once after the 60 s window expired → **18/18 green**. Not a product regression (see TEST-RESULTS.md).

## Teardown verification

`teardown: purged 3 test tenants (+0 strays); school count back to 2` (L2 runs) and the UI tenant purge → `schools remaining: green-valley, hawkings-prithvipur`. No test artifacts remain in the database; no seed tenant was modified.

---

# FINAL-REVIEW FOLLOW-UP (2026-10-23, PR #57 @ 74f9e43) — unusual/custom class-name matrix

The final review requested targeted reproduction of six unusual class-name shapes. All reproduced **deterministically at the canonical-mapper level (L1)** — the D1 family is fully specified there; no live/UI run was needed for the follow-up (the live chain and UI walk above already prove the payload shapes reach the mapper unchanged, and no write path was touched).

| Case | Input (gradeLevel unless noted) | Expected grade / key / label / level | Pre-correction actual | Verdict |
|---|---|---|---|---|
| Batch 2026 | `Batch 2026`, NULL | ~~2026 / `G2026` / Batch 2026 / Senior Secondary (accepted edge)~~ **SUPERSEDED same day by the final refinement (§ below)** → 0 / `N:batch 2026` / `Batch 2026` / Primary — a year is not an academic grade | same as old expectation at the time (pinned then; superseded) | **PASS then; now pinned to the refined behaviour (see below)** |
| Batch 2025+2026 | two rows, NULL | ~~two groups `G2025`/`G2026`~~ → **refined**: two NAMED groups `N:batch 2025`/`N:batch 2026` — batches never merge | same | **PASS (pinned; superseded to named keys)** |
| Nursery 2 | `Nursery 2`, NULL | 0 / `N:nursery 2` / `Nursery 2` / Pre-Primary (picker parity: regex BEFORE number parse) | **grade 2 / `G2` / level Primary** — WRONG | **FAIL → D1a, fixed this follow-up** |
| Nursery 2 + Class 2 | two rows, NULL | TWO groups (pre-primary stage never merges with an academic grade) | **ONE merged `G2` group** — unrelated classes merged (the D1 invariant violated) | **FAIL → D1a, fixed** |
| LKG 2 / UKG 2 / KG 2 / Pre-Primary 1 | four rows, NULL | four named Pre-Primary groups, never `G1`/`G2` | **four `G2`/`G1` groups** | **FAIL → D1a, fixed** |
| Nursery 2 + stored '2' | `Nursery 2`, gradeLevel `'2'` | 2 / `G2` / `Grade 2` (rule 1: stored valid grade wins) | same | **PASS** (pinned — fix must NOT override stored data) |
| Grade 9 - A | `Grade 9 - A`, NULL | 9 / `G9` / `Grade 9 - A` / Secondary | same | **PASS** (pinned) |
| Grade 9 - A + Class 9 | two rows, NULL | ONE `G9` group, 2 sections (same academic grade — CORRECT merge) | same | **PASS** (pinned) |
| Class 0 | `Class 0`, NULL | 0 / `N:class 0` / `Class 0` / Primary (unknown-grade bucket) — **ambiguity documented**: could be pre-primary in some curricula; regex NOT extended on a guess | same | **PASS** (pinned; ambiguity recorded) |
| Class 0 + Nursery + Class 10 | three rows, NULL | three distinct groups | same | **PASS** (pinned) |
| Class 01 | `Class 01`, NULL | 1 / `G1` / `Class 01` / Primary (zero-padding must not split grade 1) | same | **PASS** (pinned) |
| Class 01 + Class 1 + 1-A(stored '1') | three rows | ONE `G1` group, 3 sections, label follows first row (`Grade 1` when the stored row sorts first) | same | **PASS** (pinned) |
| Empty / whitespace name | `''` + `'   '`, NULL | **API-FORBIDDEN** (wizard `safeText(40).min(1)` → 422; `/api/classes` throws 'Class name is required'; timetable-publish `.filter(Boolean)`) — defensive mapper pin: no crash, isolated `N:` group | same (no crash) | **PASS** (defensive pin; contract forbids the shape) |
| Mixed data (stored '6' + NULL 'Class 6') | `6-A`(stored '6') + `Class 6`(NULL) | ONE `G6` group, sections [A,B]; label follows first row (stored sorts first → `Grade 6`); students on both rows share classId `G6` + label, keep own sections | same | **PASS** (pinned both orders) |
| Student resolution across all the above | 8-row corpus + 8 students | every student's `classId` resolves to a real grouped ClassRecord with `name === className` and the student's section chip present | pre-correction: the `Nursery 2` student resolved to `G2` (wrong group) | **FAIL on the Nursery-2 student → fixed; PASS post** |

**Summary: 4 deterministic FAILs pre-correction, all in the number-bearing pre-primary family (D1a); all green post-correction (39/0). Evidence: the test battery itself (tests/unit/students-store-class-grouping.test.ts, describe blocks 6–8) + TEST-RESULTS.md §8–§9.**

---

# FINAL BEHAVIOUR REFINEMENT (2026-10-23, PR #57) — pattern-anchored name→grade parsing

Owner directive after the review battery: incidental numbers in class names are NEVER academic grades (`"Batch 2026"` must not become G2026; `"Room 12"` must not merge into G12; `"Group 3"` must not merge into G3). The earlier accepted-edge position on year-in-name was rejected. Implemented as the smallest scoped change: `gradeFromClassName` in the canonical mapper is now PATTERN-ANCHORED (keyword-anchored `Class|Grade|Std|Standard`, section-first `6-A`, pure 1–2-digit number) — full rationale and case table in `CLASS-GROUPING-POLICY.md` §8.

| Case | Input (gradeLevel NULL) | Expected grade / key / label / level | Pre-refinement actual | Verdict |
|---|---|---|---|---|
| Batch 2026 | `Batch 2026` | 0 / `N:batch 2026` / `Batch 2026` / Primary (unknown-grade bucket) | **2026 / `G2026` / Senior Secondary** — WRONG (year as grade) | **FAIL → fixed (pattern-anchored parse)** |
| Batch 2026 collision guard | `Batch 2026` + `Class 2` + `Class 12` | THREE groups; batch isolated, `G2026` never exists | batch landed in `G2026` (isolated by luck — nothing else parsed 2026) | **FAIL → fixed** |
| Batch 2025 + Batch 2026 | two rows | two NAMED groups `N:batch 2025`/`N:batch 2026` | two academic groups `G2025`/`G2026` | **FAIL → fixed** |
| Room 12 | `Room 12` + `Class 12` | TWO groups; `N:room 12` (grade 0) and `G12` (grade 12, Senior Secondary) | **ONE merged `G12` group** — unrelated classes merged | **FAIL → fixed** |
| Group 3 | `Group 3` + `Class 3` | TWO groups; `N:group 3` (grade 0) and `G3` | **ONE merged `G3` group** | **FAIL → fixed** |
| Two different custom names | `Batch 2026` + `Diploma` | two NAMED groups `N:batch 2026`/`N:diploma` | `G2026` + `N:diploma` (batch as academic group) | **FAIL → fixed** |
| Classroom 5 (word boundary) | `Classroom 5` + `Class 5` | TWO groups; `N:classroom 5` and `G5` | **ONE merged `G5` group** (first-number parse ignored word boundaries) | **FAIL → fixed** |
| Year alone | `2026` | 0 / `N:2026` / `2026` / Primary | **2026 / `G2026`** | **FAIL → fixed** |
| Pure number (compat) | `6` + `Class 6` | ONE `G6` group, sections [A,B], level Middle | same (first-number parse already academic) | **PASS (pinned compat)** |
| Section-first NULL (compat) | `6-A` | 6 / `G6` / `6-A` / Middle | same | **PASS (pinned compat)** |
| Std 8 / Standard 8 (compat) | `Std 8` + `Standard 8` + `Class 8` | ONE `G8` group, 3 sections, Middle | same | **PASS (pinned compat)** |
| Class 6 sections A/B (compat) | `Class 6` × 2 rows | ONE `G6` group, sections [A,B] | same | **PASS (pinned compat)** |
| Corpus student resolution | 8-row corpus incl. `Batch 2026` | the Batch student resolves to `N:batch 2026` + real-name label | Batch student resolved to `G2026` | **FAIL → fixed** |

**Summary: 9 deterministic FAILs pre-refinement (exactly the incidental-number family) → 49/0 post (battery 21 → 39 → 49 tests). Red-green proof: command output in TEST-RESULTS.md §12. Wizard/corpus/publish shapes (cases A–K, X, Y) BYTE-IDENTICAL under the refinement (diff-verified against `evidence-repro-mapper-POSTFIX.txt`).**
