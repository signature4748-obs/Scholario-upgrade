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
