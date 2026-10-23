# PHASE 2/9 — PROVISIONING-TRACE (school creation → class configuration → display)

Audit date: 2026-10-22/23 (session) · Repo `signature4748-obs/Scholario-upgrade` · Working tree base `main @ 7585fad` (clean; no user changes existed — verified before any edit) · Method: read-only code trace + isolated local tenants (embedded PG 18.4, supervised dev server with CI-parity fixture env, `DEV_OLD_SPACE_MB=1700`).

Every item below was verified against the code this session (line numbers from `main @ 7585fad` unless noted). **No production system was touched. No production data was read or written this phase.**

---

## 1. Platform navigation → provision entry point

| # | Step | File / function | Verified facts |
|---|---|---|---|
| 1.1 | Entry page | `src/app/(platform)/platform/schools/new/page.tsx` → `src/components/platform/modules/provision-wizard.tsx` (`ProvisionWizard`) | 7-step full-page workspace; breadcrumb `Schools / Add school`; success panel replaces the form after creation |
| 1.2 | Stepper | `provision-wizard.tsx` `STEPS` (line 276): 1 School identity · 2 Principal · 3 Subscription · 4 Academic setup · 5 Branding · 6 Address · 7 Review & create | Completed steps clickable (jump-back); forward motion validation-gated by `next()` (line 935) |
| 1.3 | Draft persistence | `WizardDraft` + `DRAFT_KEY = 'scholario.platform.add-school-draft.v1'` (line 374), `isFormMeaningful` (line 378) | sessionStorage auto-save; `principalPassword` structurally never persisted (excluded from the draft contract); resume only via explicit RESUME/DISCARD |
| 1.4 | Authorization | API: `withPlatform({ permission: 'schools.provision' })` (`src/app/api/platform/schools/route.ts:742-744`) | UI reachable by provision holders; API enforces the permission server-side |

## 2. Wizard steps — fields, defaults, validation (client UX; server re-validates)

| Step | Fields (defaults) | Validation (`stepIssue`, lines 925–933) |
|---|---|---|
| 1 Identity | name, board (**CBSE** default; only CBSE/UP_BOARD — `BOARD_OPTIONS` line 111), optional code (2–16 `[A-Z0-9-]`), shortName (auto), slug (auto, `SLUG_RE`), contact email optional | `validateIdentity` (823): name ≥2, slug 3+ chars, slug/code server availability via precheck (`/api/platform/schools/precheck`) |
| 2 Principal | principalName, principalEmail (required), phone optional (`PHONE_RE`), password optional (≥8 or auto-generated) | `validatePrincipal` (840) |
| 3 Subscription | billingModel (**SCHOOL_WIDE**; PER_STUDENT forces ANNUAL — monthly refused client AND server), agreedAmount (required, `AMOUNT_RE`, ≤100,000,000), currency (**INR**), licensedStudents (required when PER_STUDENT), start date (within ±1 y) | `validateSubscription` (850) |
| 4 Academic | academicYear (`YYYY-YYYY`, optional), workingDays (**MON–FRI** default; ≥1 required), **classRows** (default `[]` — the inert-row invariant: a nameless row can never carry sections; `EMPTY_FORM` line 237 is the exported regression fixture), subjectsText/roomsText (optional) | `validateAcademic` (873): duplicate (name+sections) rows blocked, ≤40 rows |
| 5 Branding | themeColor (**#0f766e**), accentColor (**#f59e0b**), tagline, websiteEnabled (**true**), customDomain optional | `validateBranding` (889) |
| 6 Address | address/city/state/country required; PIN required for India (6 digits, first 1–8); district/addressLine2 optional; timezone (**Asia/Kolkata**) | `validateAddress` (904) |
| 7 Review | Ready/Optional/Needs-attention per section; jump-back editing | `buildPayload()` (966) assembles the exact wire payload |

## 3. Class preset selection, deselection, custom classes (Step 4 grid)

| Behavior | Code (provision-wizard.tsx) | Facts |
|---|---|---|
| Presets | `CLASS_PRESETS` (line 175): Class 1–5 · 6–8 · 9–10 · 11–12 · 1–12 | `togglePresetClasses` (1078) adds rows `{name: "Class N", sections: "A"}` for each missing N; toggling OFF removes exactly the preset's rows |
| Custom rows | “+ Add the school’s own class” (line 2193) | new row `{name:'', sections:'A'}`; name free-text (≤40 chars after trim in `parsedClasses`); **the UI never offers a gradeLevel field** — classes are configured by NAME + sections only |
| Row editing | per-row name input (2150), sections input “A, B” (2162), remove “×” (2176) | sections are comma-separated; inert rows (blank name) are filtered from the payload |

## 4. Section parsing (wizard client-side)

`parsedClasses` (lines 772–786): named rows only → `name.trim().slice(0,40)`; `sections.split(',').map(trim).filter(Boolean).slice(0,8)`. Therefore:
- single section `"A"` → `['A']`
- multiple `"A, B, C"` → `['A','B','C']`
- whitespace-only entries are dropped client-side (and the API's `safeText(8)` — `z.string().trim().min(1)` — would refuse them anyway; **verified live**: sections `['  ']` → HTTP 422)
- duplicates within one row are impossible (split+filter keeps them — e.g. `"A, A"` → `['A','A']` — but the server-side dedupe (§5) removes the second; verified by the wizard suite's “classes bootstrap dedupes (name, section) pairs server-side” test, green)
- blank/empty input `""` → `[]` → the server creates ONE row with `section: null` (§5)
- **there is no UI path that sends a row without a name** (inert-row invariant)

## 5. Final review → exact request payload (sensitive values redacted)

`buildPayload()` (966–1004) → `POST /api/platform/schools` (one atomic call; precheck is a separate read-only call):

```jsonc
{
  "name": "<school name>", "shortName": "...?", "slug": "<slug>", "code": "...?",
  "board": "CBSE | UP_BOARD",
  "address": "...", "addressLine2": "...?", "city": "...", "district": "...?",
  "state": "...", "pincode": "...?", "country": "...", "timezone": "...",
  "officialEmail": "...?", "phone": "...?", "website": "...?",
  "billingModel": "SCHOOL_WIDE | PER_STUDENT | MIXED", "billingFrequency": "MONTHLY | ANNUAL",
  "agreedAmount": <number>, "currency": "INR", "licensedStudents": <number?>,
  "subscriptionStartsOn": "YYYY-MM-DD",
  "principalName": "...", "principalEmail": "...", "principalPhone": "...?",
  "principalPassword": "<redacted — optional>",   // never persisted client-side
  "academicYear": "YYYY-YYYY?", "workingDays": ["MON",...],
  "classes": [{ "name": "Class 1", "sections": ["A"] }, ...],   // ≤40 rows, ≤8 sections
  "subjects": ["..."]?, "rooms": ["..."]?,
  "themeColor": "#rrggbb", "accentColor": "#rrggbb", "tagline": "...?",
  "websiteEnabled": true, "customDomain": "...?"
}
```
**`classes[].gradeLevel` does not exist in the wire contract — by design the operator configures classes by name+sections only.**

## 6. Provisioning API (POST /api/platform/schools) — schema, auth, validation, transaction, errors

| Concern | Code (route.ts) | Facts |
|---|---|---|
| Auth | `withPlatform({ permission: 'schools.provision' })` (742) | platform session + permission + step-up where required |
| Schema | `provisionSchema` (zod, ~lines 495–707; classes at 605–608: `array({name: safeText(40), sections: array(safeText(8)).max(8).default([])}).max(40).optional()`) + `superRefine` cross-field rules (615: PER_STUDENT×MONTHLY refused; amount⇔frequency pair; licensed only on PER_STUDENT; Indian PIN rules; start-date sanity) | safeText trims + min 1 → blank strings impossible |
| Idempotent replay | 764–823: slug+code+principal-email+audit-proven+PENDING fingerprint → `replayed: true`, **no second school**; tempPassword never re-surfaced | **Verified live (CASE H): re-submitting the same payload → 200 `replayed=true`, same id, still 12 rows** |
| Transaction | ONE `$transaction` (838–1187): School (PENDING, recordPrefix under advisory lock) → founding Principal (`mustChangePassword: true`, 48 h credential window) → TenantDomain (PENDING + verification token) → subjects → **classes** → rooms → SchoolSubscription (terms only, `paymentsRecorded: 0`) → PlatformAuditLog (`platform.school.provisioned` with `bootstrap` counts) | P2002 races map to typed CONFLICT (1188–1209); nothing can orphan |
| **Class bootstrap** | 1142–1165: server-side dedupe `Set("name|section")`; `sections.length > 0 ? sections : [null]`; `tx.class.create({ schoolId, name, section })` — **`gradeLevel` is never set → NULL** | one row per (name, section); `bootstrapCounts.classes/sections` in the audit event |
| Error handling | typed `AppError` envelope; 422/409 classes per rule | verified live: whitespace sections → 422; duplicate slug → 409 (wizard suite) |

## 7. Bootstrap of the rest (same transaction)

| Entity | Behavior |
|---|---|
| Subjects | school-level `Subject` rows with deterministic codes (`subjectCodeOf`), deduped |
| Rooms | `Room` rows (`type: 'Classroom'`), deduped |
| Principal | `User` role PRINCIPAL, ACTIVE, `mustChangePassword: true`, `credentialExpiresAt = +48 h`; temp password shown ONCE in the success panel |
| Subscription | `SchoolSubscription` carries the AGREED terms; `periodEnd` null; payments honestly 0 |
| Audit | `platform.school.provisioned` (+ per-action events for activate/flags later) |

## 8. Class model fields & constraints (prisma/schema.prisma:460–502)

```prisma
model Class {
  id             String   @id @default(cuid())
  schoolId       String
  school         School   @relation(..., onDelete: Cascade)
  name           String
  gradeLevel     String?          // ← nullable by design; no DB constraint on format
  section        String?
  stream         String?
  capacity       Int?     @default(40)
  roomId         String?  // + room String? display projection
  classTeacherId String?
  createdAt      DateTime @default(now())
  @@unique([schoolId, name, section])   // the ONLY class uniqueness constraint
  @@index([schoolId, classTeacherId])
}
```
- `gradeLevel` NULL is **schema-legal** and the wizard path produces exactly that (verified: 12/12 rows NULL, live).
- `@@unique([schoolId, name, section])` permits the same name with different sections (the section-level design) and makes duplicate (name, section) pairs impossible at the DB level.
- 20 relations point at Class (students, subjects, exams, attendance, timetables, examClasses, …) — all NULL-safe FKs.

## 9. Read/list APIs + server-side mapping

| API | Behavior |
|---|---|
| `GET /api/students/roster` (`src/app/api/students/roster/route.ts:82`) | roles PRINCIPAL/MANAGEMENT/STUDENT; `class.findMany` `orderBy: [{gradeLevel: 'asc'}, {section: 'asc'}]` (106) — **string ordering**: NULLS LAST; lexicographic for non-null strings ('1'<'10'<'11'<'12'<'2'…); returns rows verbatim incl. `gradeLevel: null` (363–375) |
| `GET /api/classes` (route.ts:8–27) | staff-only list (`orderBy gradeLevel asc`), used by non-store consumers |
| `GET /api/principal/academic` | the allocation picker's own source (classes+CSA) — **not** the students store |

## 10. Client mapping + display (the D1 chain, pre-fix)

`src/lib/store/students-store/server-sync.ts` (pre-fix): `gradeFor` (110): `Number(g)`, finite-and->0 else **0** → `Number(null)=0`, `Number('')=0`, `Number('Nursery')=NaN→0`; `groupKeyOf` (137): `G{grade}`(+stream); `groupLabelOf` (145): `Grade {grade}`; `mapRosterToRecords` (154) groups section rows into one `ClassRecord` per key with `sections[] = row.section ?? 'A'`. UI: `src/components/principal/modules/classes/index.tsx` ClassCard (89): `{cls.name}` + `{cls.level} · {cls.sections.length} section(s)` (142) + per-section chips (168–179). **Every school-plane store consumer (53 files) renders this universe.**

## 11. All other code paths that create Class rows (repo-wide `\.class\.create\(` census)

| Path | gradeLevel written | Notes |
|---|---|---|
| `POST /api/platform/schools` bootstrap (route.ts:1154) | **never** (NULL) | the wizard path — D1 trigger #1 |
| `POST /api/classes` (classes/route.ts:53–63) | `String(body.gradeLevel || '')` → **''** when omitted | school-plane Add Class — D1 trigger #2 (verified live: omitted → `""`) |
| `POST /api/timetable/publish` (publish/route.ts:83–87) | **never** (NULL) | auto-creates missing classes, full label kept as name, trailing letter derived as section — D1 trigger #3 |
| `prisma/seed.ts` (331) + `seed-teacher-academics.ts` (119) | `lv.level` ('Nursery','LKG','IKG','1'..'12') | demo corpus — gradeLevel always set |
| `prisma/seed-tenant-isolation.ts` (172), tests | various | fixtures only |
| Store-side `useStudentsStore.createClass` (store.ts:603–612) | none (client-only record) | derives grade from NAME `(\d+)`, default 1 — never 0 |

## 12. Side effects / repeated-submission safety

- **Idempotent replay** (§6) + DB unique + in-payload dedupe ⇒ repeated submits cannot duplicate schools or classes (verified live CASE H).
- The wizard's `classes: undefined` (no rows selected) ⇒ bootstrap skipped entirely (readiness tracker honestly reports “not configured” — Green Valley is the standing example).
- No background job, migration or cron creates Class rows (migration census: none touches existing Class rows' gradeLevel; seeds write it only for the demo tenant).

## Intended vs observed behavior (summary)

| Surface | Intended | Observed pre-fix | Post-fix (this phase) |
|---|---|---|---|
| Wizard payload | name+sections, no gradeLevel | same (correct) | unchanged |
| Persisted rows | one per (name, section), gradeLevel NULL | same (correct) | unchanged |
| Platform-plane views (directory, audit, readiness) | correct data | correct | unchanged |
| School-plane roster→store grouping | one class card per real class | **one synthetic “Grade 0” card absorbing all classes as “sections”** | **fixed — one named card per class** (see REPRODUCTION-RESULTS.md) |
