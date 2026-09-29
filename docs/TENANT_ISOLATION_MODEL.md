# Tenant Isolation Model — Scholario-OS

**Phase 2 — Multi-Tenant Isolation + Authorization.** This document is the
authoritative description of how Scholario-OS enforces its fundamental
invariant:

> **NO USER FROM SCHOOL A MAY READ, WRITE, MODIFY, DELETE, SEARCH, EXPORT,
> DOWNLOAD OR INFER SCHOOL B DATA.**

The model is enforced **server-side, centrally** — never through frontend
hiding, never through URL id secrecy, never through client-supplied
identifiers. Automated cross-tenant tests demonstrate the invariant
(`tests/security/tenant-isolation.test.ts` + `tenant-isolation-model.test.ts`,
57 + 19 tests).

---

## 1. The request authorization pipeline

Every API request flows through one centralized model:

```
Request
  → authenticated identity      session cookie → Session row → User row
                                (status must be ACTIVE)
  → tenant context              User.schoolId, read from the DATABASE.
                                NEVER from query/body/headers. SUPER_ADMIN
                                (schoolId null) is REFUSED on school-scoped
                                resources — the platform role operates only
                                through platform routes.
  → role                        User.role from the DB (never client input)
  → permission                  server-side capability matrix
                                (src/lib/security/permissions.ts) —
                                unknown capabilities fail CLOSED
  → resource scope              every by-id lookup is tenant-checked
                                (assertTenantRow / scopedId /
                                assertFkInTenant / assertStudentInTenant)
  → database operation          Prisma where ALWAYS carries schoolId for
                                tenant-owned models
```

### 1.1 Implementation modules

| Module | Role |
|---|---|
| `src/lib/security/authz.ts` | `withAuthz(policy, handler)` — the pipeline wrapper replacing `withUser` on hardened routes; `authorize()`; resource-scope guards: `scopedId`, `assertTenantRow`, `assertSameTenant`, `assertFkInTenant`, `assertStudentInTenant`; `stripClientSchoolId` |
| `src/lib/security/permissions.ts` | the server-side role→capability matrix (`can(role, permission)`, fail-closed) |
| `src/lib/api.ts` | `withUser` (legacy wrapper, still ACTIVE-status + role gated), `schoolScoped(user)` — session-derived tenant |
| `src/lib/teacher-scope.ts` | teacher resource scope: CSA (ClassSubjectAssignment) appointments — `teacherCanEnterMarks` |
| `src/lib/teacher-hub.ts` | `requireTeacher`, `authorizedStudentWhere`, `assertStudentInScope` (teacher's authorized student set) |
| `src/lib/learning.ts` | `requireStudent` — student self-service identity from the session |
| `src/lib/security/errors.ts` | `AppError` — typed 404/FORBIDDEN semantics; cross-tenant resources "do not exist" |

### 1.2 Fail-safe 404 semantics (no existence oracle)

When a request addresses a resource that exists in ANOTHER tenant, the
response is **404 "not found"** — indistinguishable from a request for a
nonexistent id. The caller learns nothing: not whether the id exists, not
which school owns it, not what it is. Internal detail (which tenant owns the
row) is logged server-side only (`internalDetail`), never in the response.

---

## 2. Tenant resolution rules

1. **schoolId comes from the authenticated session context** wherever a
   route is school-scoped (`ctx.schoolId` / `schoolScoped(user)` /
   `requireTeacher` / `requireStudent`). A `schoolId` field in a request
   body is never read for scoping — tests send spoofed `schoolId` values
   and assert rows still land in (or are refused for) the CALLER's tenant.
2. **SUPER_ADMIN has no tenant.** School-scoped resources refuse the
   platform role (403). Platform data (schools list, platform activity,
   platform settings, platform-wide payment export) is the only surface
   available to it. This prevents a compromised platform account from
   becoming a tenant-data firehose through school routes.
3. **Student/parent self-service** resolves the subject identity from the
   session (`requireStudent` — the user's own Student row; parent scope via
   `Student.guardianId`), never from a body `studentId`.
4. **Teacher scope is assignment-driven**: ClassSubjectAssignment (CSA) is
   the canonical appointment record (union the legacy timetable name-match
   fallback during migration); class-teacher scope via
   `Class.classTeacherId`. Marks entry, attendance, directory, fee
   collection, growth, parent-connect all consume the SAME resolution.

---

## 3. Write-path FK-in-tenant validation

Every mutation that links a child row to a referenced entity (classId,
subjectId, studentId, teacherUserId, routeId, roomId, catalogueId,
bookId, examId, …) re-verifies the referenced row **in the caller's
tenant** before writing (`assertFkInTenant` / explicit
`findFirst({ where: { id, schoolId } })` → 404). This closes the
cross-tenant FK-injection class where a caller could link School A rows to
School B entities and then read the foreign names back through the join.
Applied surfaces include: student create (class/route), class create
(class teacher), exam schedule items, exam marks (student-in-class-and-
school), exam attendance, exam outcomes, homework create/update
(subject/teacher), fee create (student), library issue (book + student),
fee structures (class/catalogue heads), assignments, questions, AI
autosave, timetable publish.

---

## 4. Cross-tenant IDOR inventory (what was fixed)

Phase 2 audited **every API route** (165 route files / ~260 handlers) with
four parallel audits; all CRITICAL/HIGH findings are fixed and covered by
tests:

| Surface (before) | Violation | Fix |
|---|---|---|
| `DELETE /api/events?id=` | deleted ANY school's event by bare id | `deleteMany({ id, schoolId })` + 404 + audit |
| `PATCH/DELETE /api/exams/settings/types/[id]`, `grades/[id]` | updated/deleted ANY school's exam config (schoolId param ignored) | `findFirst({ id, schoolId })` → 404 before mutate |
| `DELETE /api/questions?id=` | deleted ANY school's question bank row | school-scoped `deleteMany` → 404 |
| `PATCH /api/homework/policy`, `DELETE …/no-homework-dates/[id]`, `PATCH …/grievances/[id]` | cross-tenant homework config/grievance writes | tenant guards in `homework/oversight-service.ts` |
| `POST /api/attendance` (legacy bulk) | global `(studentId, date)` unique let school B OVERWRITE school A's canonical attendance rows | class-in-tenant check, server-derived roster, tenant-safe write, CSA/class-teacher gate for teachers |
| exam marks writes (`setMark`, batch, import, attendance, outcomes) | trusted body `studentId` → cross-tenant ExamMark rows whose student names then leaked through marks/results DTOs | student-in-tenant-and-class verification before every upsert |
| exam schedule create | foreign class/subject ids → foreign names leaked via exam GET | class/subject verified in school AND exam membership |
| `/api/teacher/class-hub/marksheet` | bare-id exam metadata echo | schoolId-checked exam lookup |
| teachers/admissions uploads | shared dir, no school binding → cross-school DELETE/signed-URL mint | `UploadedFile` ownership registry (school-bound); DELETE/access-mint refuse foreign or unregistered legacy files |
| `GET /api/fees`, `/api/fees/settlements`, `/api/payments-export`, `/api/fees/webhook` | no role gate — students read whole-school finance | `school.finance.*` permission gates; webhook payload sanitized (no rawPayload, no null-school OR) |
| `POST /api/fees/payments/confirm` | demo settlement endpoint live in production | env-gated (`PAYMENTS_SANDBOX`), guardian scoping for parents |
| `/api/homework`, `/api/homework/oversight/**`, grievances, audit | no role gates — students read DRAFT homework, submissions, privateNotes, grading audit | `school.homework.read`/`oversight` permission gates + teacher ownership (creator/assignee/class-teacher) |
| `POST /api/notifications` | any teacher broadcast school-wide | `school.announcements.publish` (P/M) + whitelists + rate limit + audit |
| exam marks/results/outcomes/audit/seating/attendance/template/invigilator/admit-cards reads | open to STUDENT/PARENT (pre-declaration marks, rosters, teacher directory) | staff role gates via `exams.*` permissions (students keep self-scoped `/api/results`) |
| `POST marks/import`, `submitMarks` | teacher CSA bypass (bulk write without assignment) | `teacherCanEnterMarks` enforced on the bulk channels |
| `/api/students/roster` (STUDENT) | classmates' fees, exam marks, growth, behavior counts sent to student clients | projection guard: classmates get public fields only |
| `/api/contacts`, `/api/dashboard` GET, `/api/transport` | students enumerate school users / school finance / driver PII | role gates + role-aware projections |
| `/api/search` | PARENT enumerated student body + fee rows; student announcements not audience-filtered | staff-directory gating + audience filtering |
| `/api/schools/public` | anonymous reads incl. STUDENTS-audience notifications; silent demo fallback; raw err.message; no rate limit | audience ALL/PUBLIC only, 404 for unknown slug, safe errors, IP rate limit |
| student payment verify | any student could complete another student's order | `txn.studentId === caller student` |
| payments webhook settlements | unattributed settlements force-linked to a hardcoded demo school | resolve school from linked orders; reject ambiguous |
| school profile `/api/schools/[id]` | "Access denied" 400 (existence oracle) | 404 "School not found" |
| exam marks/audit GET, homework GET | foreign ids returned **empty-200/null-200** | proper 404s (fail-closed, not fail-empty) |

The full audit trail with severities, exact file:line evidence and fixes is
recorded in `/home/z/my-project/worklog.md` (Task IDs 3-a…3-d audits, 4-a…4-d
fixes).

---

## 5. Indirect leakage controls

Verified by dedicated tests (search / counts / analytics / autocomplete /
exports / notifications / file URLs / error messages / ids / dashboard
metrics):

- **Search** (`/api/search`): every query block carries `schoolId` from the
  session; directory blocks are staff-only; students see only own
  fees/authorized learning; announcements audience-filtered for
  STUDENT/PARENT.
- **Counts & dashboard metrics**: all aggregates group by the session
  school; the School B principal's dashboard reports exactly the School B
  population (tested: `stats.students === 1`).
- **Exports** (`/api/export`, `/api/payments-export`): CSV rows are
  `schoolId`-filtered; tested to contain only the caller tenant's names.
- **Notifications**: `schoolId`-scoped + audience visibility; School B
  feeds carry no School A titles (tested).
- **File URLs**: signed file tokens are HMAC-bound to scope+file+expiry and
  verification is timing-safe; the new `UploadedFile` registry binds every
  NEW upload to the uploading school; study-material downloads are
  tenant-checked before the file stream starts (404 for foreign ids).
- **Error messages**: the Phase-1 safe-envelope (`classifyError`) plus 404
  semantics guarantee cross-tenant probes never see Prisma internals,
  stack frames, filesystem paths — and never see the victim school's name
  or the victim row id (asserted by `expectSafeFailure` on every probe).
- **IDs**: all ids are unguessable cuids/random tokens; where an id IS
  known (the tests know them from the DB), every access path still fails
  safe — isolation never relies on id secrecy.

---

## 6. Verification: the cross-tenant test matrix

`prisma/seed-tenant-isolation.ts` (idempotent,
`bun run db:seed-tenant-isolation`) provisions:

- **School A** — Greenwood Public School (canonical tenant) + controlled
  test identities (principal/teacher/student/parent/superadmin,
  `tenant.*@scholario.test`).
- **School B** — Bluebell International Academy + the same role set
  (`*.b@bluebell.test`) + probe rows in every major domain (class,
  subject, teacher, student, fee, notification, event, exam, question,
  room, study material, homework, CSA appointment).

`bun run test:security` (161 tests total) includes:

- **`tests/security/tenant-isolation.test.ts`** — 57 live-HTTP cross-tenant
  tests: anonymous boundary; cross-tenant READ (student/exam/marks/audit/
  homework/material-download/receipt/teacher-student/rooms/school-profile
  probes with School B credentials against School A ids); cross-tenant
  WRITE/DELETE (events, questions, grade scales, exam types, attendance,
  student create with foreign classId, messages to foreign recipients,
  exam marks with foreign student, fee create with spoofed schoolId,
  library issue, parent messaging) — each asserting the safe failure AND
  that the victim row survives unchanged in the database; indirect
  leakage (search, contacts, CSV exports, dashboard counts,
  notifications feed, announcements, exam lists); SUPER_ADMIN platform
  boundary; role boundaries (students/parents refused on staff surfaces);
  the roster classmate-projection guard; spoofed-`schoolId` body probes;
  and **positive controls** (same-tenant access works for both schools —
  proving the 404s are tenant failures, not broken routes).
- **`tests/security/tenant-isolation-model.test.ts`** — 19 unit tests of
  the central model: permission-matrix fail-closed semantics, the
  `authorize()` pipeline (identity/tenant/role/permission gates),
  `assertTenantRow`/`assertSameTenant` 404 semantics,
  DB-backed `assertStudentInTenant` cross-tenant rejection, and
  `stripClientSchoolId`.

Running the HTTP suite requires the dev server (`bun run dev`) on
`localhost:3000`; logins are real `POST /api/auth/login` calls with a
documented direct-session fallback when the login rate limiter has consumed
the IP budget from repeated runs.

---

## 7. Known residuals (documented, not tenant violations)

- Legacy pre-Phase-2 upload files on disk have no `UploadedFile` registry
  row: GET via a still-valid signed token remains possible until expiry
  (≤1 h); DELETE and new access-mint refuse them. New uploads are fully
  school-bound.
- The legacy timetable name-match still grants teacher scope where CSA
  rows are absent (transition fallback, documented in teacher-scope.ts);
  mark WRITES are CSA-gated regardless.
- SQLite (single-file DB) and local-disk uploads remain the Phase-0
  infrastructure posture — migration to Supabase is explicitly deferred
  (per phase instructions).
- Mock data and client-side stores remain (per phase instructions); the
  server boundary does not rely on any of them for authorization.

## 8. How to extend safely

When adding a new API route:

1. Wrap it in `withAuthz({ permission: '<capability>' }, handler)` (or
   `withUser(handler, { roles })` for self-service surfaces).
2. Use **only** `ctx.schoolId` for scoping — put `schoolId` in every Prisma
   `where` for tenant-owned models.
3. For by-id access, fetch with `{ id, schoolId }` or post-check with
   `assertTenantRow` — foreign rows must 404.
4. For write-path FKs, validate with `assertFkInTenant` /
   `assertStudentInTenant` before creating/updating.
5. Add the route to the tenant-isolation test matrix (a School B attempt
   against a School A id must fail safely; a same-tenant attempt must
   succeed).
