# PHASE 1/9 — CLASS 0 / EXCESSIVE-SECTIONS INVESTIGATION (evidence-backed root cause)

Reported symptom: *"A newly created school appeared to contain a Class 0 and an unexpectedly large number of sections."*

**Verdict (one line): the persisted data is correct; the symptom is a display/mapping error in the school-plane class grouping, which collapses every wizard-created class into one "Grade 0" group carrying all sections. No production data changes are required.**

---

## 1. The affected school (production, read-only evidence)

The only school created since the 7-step wizard release (`fd14234`, merged 2026-10-20) is:

| Field | Value |
|---|---|
| School | **SBS SHIKSHA NIKETAN** — slug `sbs-shiksha-niketan`, status ACTIVE |
| Created | 2026-10-20 10:33:57.101 (single provisioning transaction; all 12 Class rows written 10:33:57.211–.264, i.e. within 53 ms — one atomic transaction) |
| Platform audit | `platform.school.provisioned` @ 10:33:57.270 — plan STANDARD, PER_STUDENT/ANNUAL ₹300 × 350 licensed, recordPrefix **SSN-0001**, `bootstrap: {classes: 12, sections: 12, subjects: 0, rooms: 0}` |
| Later events | activated 10:34:33; four feature-flag toggles (library off, homework off, transport off→on) at 10:45 |

The audit row's `bootstrap.classes = 12, bootstrap.sections = 12` is exactly the wizard's "Class 1–12" preset with one section (A) each — **the submitted payload and the created rows match the operator's intent**. Nothing about the provisioning misbehaved.

## 2. What is actually persisted (read-only production query, 2026-10-22)

`SELECT name, "gradeLevel", section, … FROM "Class" WHERE schoolId = <SSN>` returns **exactly 12 rows**:

```
Class 1 … Class 12   ·  gradeLevel = NULL (all 12)  ·  section = 'A' (all 12)  ·  capacity 40
```

- **There is NO "Class 0" row.** There are no duplicate rows. There are no extra sections.
- Dependent-record census for this school: users 1 (the founding principal), students **0**, teachers **0**, subjects **0**, rooms **0**, timetable **0**, exams **0**. **Nothing references these Class rows** — no students, attendance, timetable, subjects, exams, marksheets or reports point at them, so the display defect currently has zero data-level blast radius and no cleanup is needed.

Comparison across tenants (same query, grouped):

| School | Class rows | gradeLevel NULL | Notes |
|---|---|---|---|
| SBS SHIKSHA NIKETAN | 12 | **12** | wizard-created → NULL gradeLevel |
| Hawkings High School Prithvipur (demo) | 15 | 0 | seed sets gradeLevel ('1'…'12', 'Nursery', 'LKG', 'IKG') |
| Green Valley Public School | **0** | — | pre-wizard school; bootstrap was empty (state fact, not a defect) |

## 3. Where "Class 0" and the excessive sections actually come from (root-cause chain)

The school-plane UI does not render `Class` rows directly; `GET /api/students/roster` returns the flat rows and `src/lib/store/students-store/server-sync.ts` **groups them**:

1. `gradeFor` (server-sync.ts:110): `Number(gradeLevel)` when finite and > 0, **else `0`** →
   - `gradeFor(null)` → `Number(null)` = `0` (the wizard rows)
   - `gradeFor('Nursery')` → `Number('Nursery')` = `NaN` → `0` (the demo tenant's pre-primary rows — same defect class, pre-existing)
2. `groupKeyOf` (server-sync.ts:138): key = `G${grade}` (+ stream suffix) → **every NULL-gradeLevel row shares key `G0`**
3. `groupLabelOf` (server-sync.ts:146): label = **`Grade 0`**
4. One `ClassRecord` per group → **a single "Grade 0" card whose `sections[]` contains all 12 section-level rows** (each named "A", per `sec.section ?? 'A'`)
5. The Classes module renders `{cls.level} · {cls.sections.length} sections` and a chip per section (classes/index.tsx:142–170) → the operator sees **"Grade 0 · 12 sections" with twelve "A" chips** — precisely the reported "Class 0 and an unexpectedly large number of sections".

**Deterministic reproduction (safe, no DB, no network)** — feeding the repo's own `mapRosterToRecords` the exact production payload shape (12 DTOs, `name: "Class 1"…"Class 12"`, `gradeLevel: null`, `section: "A"`):

```
=== CASE 1: production shape (wizard-created, gradeLevel NULL) ===
grouped class records: 1
  name="Grade 0" grade=0 level="Primary" sections=[A, A, A, A, A, A, A, A, A, A, A, A]
=== CASE 2: control (gradeLevel "1".."12" set) ===
grouped class records: 12
  name="Grade 1" grade=1 sections=[A]  …  name="Grade 12" grade=12 sections=[A]
```

Control case proves the mapping works when `gradeLevel` is populated. (Repro script: pure-function evaluation of the repo's own mapper; recorded in this pack's README.)

## 4. Which process created each record; is "Class 0" persisted, display-only, or a conversion error?

| Question | Answer | Evidence |
|---|---|---|
| Which process created the 12 rows? | `POST /api/platform/schools` academic-bootstrap inside the single provisioning `$transaction` (route.ts:1142–1166) — creates one `Class` row per (name, section) with server-side dedupe; **it never sets `gradeLevel`** | code + audit-log bootstrap counts + row timestamps within 53 ms |
| Is Class 0 a persisted class? | **No.** No row has name/gradeLevel "0" | production SELECT (§2) |
| Display-only or conversion error? | **Conversion error** in the roster→store mapping: null/absent `gradeLevel` → numeric 0 → shared `G0` group; the group label synthesizes "Grade 0" instead of deriving from the real `name` | code chain §3 + repro |
| Why did the sections seem excessive? | Grouping *merges* rows: 12 legitimate rows become one group's 12 section chips. No duplicates exist | repro CASE 1 |
| Do other records reference them? | **No** — students/teachers/attendance/timetable/subjects/exams/marksheets/reports all count 0 for this school | production census (§2) |
| What should the configuration be? | Exactly what was submitted: Class 1–12, one section A each (matching the wizard's preset and the fd14234 wizard-verification pack's expected DB ground truth) | audit log + wizard visual verification pack |

## 5. The same defect class has two more write-side triggers (and a pre-existing instance)

1. **`POST /api/classes`** (school-plane Add Class, route.ts:57): writes `gradeLevel: String(body.gradeLevel || '')` — an omitted grade level becomes `''` → `Number('')` = `0` → same "Grade 0" merge for school-side-created classes.
2. **`POST /api/timetable/publish`** (route.ts:83): auto-creates missing classes from timetable payloads with **no gradeLevel at all**.
3. Pre-existing instance: the demo tenant's Nursery/LKG/IKG rows carry non-numeric gradeLevel (`'Nursery'` etc.) → all three merge into a "Grade 0" group with 3 sections on the school plane (same `gradeFor` NaN path). The wizard didn't introduce the defect — it made it maximally visible by leaving *every* row NULL.

Also noted: even when `gradeLevel` IS set, `groupLabelOf` renders the synthetic "Grade N" rather than the persisted `name` ("Class 6") — a smaller display-fidelity issue for wizard schools (operator sees "Grade 1"–"Grade 12", not "Class 1"–"Class 12").

## 6. Blast radius (which surfaces show the wrong grouping)

`mapRosterToRecords` feeds the students-store `ClassRecord` universe, which ~65 school-plane consumers read (Classes grid, Students module, Exams create-exam class pickers via `src/lib/mock/academic/resolver.ts`, certificates, transport, messaging, downloads). For SBS SHIKSHA NIKETAN every class picker or grid that renders grouped classes shows one "Grade 0" entry with 12 "A" sections instead of 12 named classes. Platform-plane surfaces (schools list, wizard success panel, setup-readiness, audit) show correct data.

## 7. Minimal fix proposal (for Phase 2 — NOT applied in this reconnaissance phase)

Primary (display-layer, smallest safe change, fixes all three triggers at once):
1. `server-sync.ts gradeFor/groupKeyOf/groupLabelOf` — when `gradeLevel` is null/empty/non-numeric, derive the grade from the class NAME (`/(\d+)/` parse, like the store's own `createClass` fallback at store.ts:608) and group/label from the real `name`; pre-primary labels (Nursery/LKG/IKG…) should form their own named group, never numeric 0.
2. Regression test: feed `mapRosterToRecords` the wizard payload shape (12 × gradeLevel NULL) and assert 12 groups labeled by name — closes the coverage gap that let this ship (no existing test covers wizard-created class display).

Secondary (write-layer, optional but principled): the provisioning bootstrap, `POST /api/classes`, and timetable-publish auto-create should persist `gradeLevel` derived from the name at creation time. This is a code change only — **no production backfill is required for correctness** (display-layer fix suffices), and none should run without its own evidence gate. If desired later for query-ordering reasons (`roster` orders by `gradeLevel`), a guarded backfill for the 12 SSN rows could ride a future release pipeline — explicitly deferred.

## 8. What remains unverified (honest)

- The exact rendered pixels of the "Grade 0 · 12 sections" card in production were not observed (no principal sign-in was performed on production during this phase — read-only discipline). The claim rests on the code chain + deterministic repro + the operator's report, which the chain fully explains.
- Whether any OTHER wizard-created school (only one exists in production) or school-plane-created class (SSN has none) exhibits variants — production census shows none exist to check.
