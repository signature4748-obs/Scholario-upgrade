# Scholario — Sandbox Rebuild Worklog

Shared worklog for all agents. Append sections below; never overwrite.

---
Task ID: 0
Agent: orchestrator (main)
Task: Phase 0 — state recovery, external service reconciliation, rebuild strategy

Work Log:
- Read full mission brief from upload/Pasted Content_1791514528337.txt (815 lines).
- Cloned reference repo to /tmp/scholario-ref (branch main @ 3ae3c85 "test: export rate-limit probe uses a canonical role" — matches the last verified SHA in the brief).
- Extracted domain model (80+ models, 3062-line schema), module maps per role, design system, demo tenant facts.
- Read-only external checks (Phase 0 reconciliation):
  - GitHub: token VALID (admin/push). Repo default branch = main.
  - Vercel: token VALID. 3 projects live: scholario-app, scholario-platform, scholario-production (legacy).
  - Supabase: management access token INVALID ("Invalid access token"). Project REST endpoint at kbyknezedewvgrnqervj.supabase.co responds with anon key (project alive, not paused). Direct DB creds unverified.
  - Resend: API key INVALID ("API key is invalid") — BLOCKED — OWNER ACTION (new key needed).
- Decision: this sandbox cannot safely run the production repo (Postgres/Supabase, two-plane deployment, 3GB builds). Per sandbox constraints (single `/` route, SQLite-only, port 3000), we rebuild Scholario faithfully as a single-page app backed by API routes + Prisma/SQLite, preserving the real product's domain, roles, design language, and demo tenant identity. The production repo is untouched (read-only reference).

Stage Summary (verified facts from the repo):
- Product: multi-tenant School ERP SaaS. Roles: PRINCIPAL, TEACHER, STUDENT (+ platform super-admin, out of scope for v1).
- Tenants: Hawkings High School Prithvipur (slug `hawkings-prithvipur`, code HHSP, demo) and Green Valley Public School (slug `green-valley`, real, unconfigured).
- Principal (demo): Arjun Malhotra. Classes: 15 levels × section A (Nursery, LKG, IKG, 1–12; Science stream for 11/12).
- Design system (from repo globals.css): light-first, white surfaces, slate neutrals, TEAL single accent (oklch 0.58 0.09 192), amber warning, radius 0.75rem, Sora display font + Geist sans/mono, explicit dark mode only.
- Principal modules: dashboard, students, teachers, classes, attendance, exams, timetable, fees/finance, admissions, salary, school-settings, notices/communication, library, transport, inventory, website, certificates, calendar.
- Teacher modules: dashboard, class-hub, attendance, marks, timetable, lesson-planner, fee-collection, my-salary, students, communication.
- Student modules: dashboard, attendance, results, fees, timetable, notices, profile, learning.
- Business invariants to honor: tenant scoping always from session; attendance identity = class+date+student (unique); timetable conflicts → 409; teacher fee collections need principal verification; monthly fixed salary; no fabricated fee fallbacks (missing config must show honestly).

Plan:
- Task 1 (orchestrator): schema + seed + auth + design system + shell + hash router + dashboards + module registry/stubs.
- Task 2-a (subagent): Students / Teachers / Classes / Attendance modules.
- Task 2-b (subagent): Exams & Marks / Timetable / Lesson Planner modules.
- Task 2-c (subagent): Fees & Payments / Admissions / Salary / Notices / Settings modules.
- Task 3 (orchestrator): integration, lint, agent-browser E2E verification, reports, cron setup.

Demo credentials (sandbox seed):
- Hawkings demo tenant — principal: arjun.malhotra@hhsp.edu.in / Hawkings@2026 (teachers & students same password).
- Green Valley real tenant — principal: principal@greenvalley.edu.in / GreenValley@2026 (not advertised on login page).

---
Task ID: 1
Agent: orchestrator (main)
Task: Foundation — schema, seed, auth, design system, shell, dashboards

Work Log:
- prisma/schema.prisma: full Scholario domain (20 models) on SQLite; attendance unique(studentId,date); timetable unique(classId,day,period) + teacher index; receipts unique; payslips unique(teacher,month).
- bun run db:push (twice: relation fixes + Room relation on TimetableSlot).
- prisma/seed.ts: deterministic corpus for Hawkings demo tenant — 353 students (17 sections Nursery→12-A), 16 teachers, 6,600+ attendance rows (last 7 weeks, today ~60% classes marked), PA1 published (1,200 marks) + Half-Yearly scheduled (Oct 26–Nov 4), 4,101 fee assessments + 1,223 receipts (200 teacher-collected under verification), 578 conflict-free timetable slots, 12 admission inquiries, 16 payslips (Sept 2026), 14 lesson plans, 7 notices, 12 activity-log entries. Green Valley = real tenant, principal only.
- src/lib/auth.ts (scrypt sessions, HttpOnly cookie), src/lib/api.ts (route wrapper, requireSession/requireRole), src/lib/format.ts (INR en-IN, dates, CBSE grades), src/lib/types.ts (client DTOs + api() fetch helper).
- src/app/globals.css: Scholario design tokens (light-first, teal oklch(0.55 0.095 192) accent, slate neutrals, Sora display font, explicit dark, .tnum, .scroll-slim, crest gradient).
- src/app/layout.tsx: Geist + Geist Mono + Sora fonts, sonner Toaster.
- APIs: /api/auth/login|logout|me|schools, /api/dashboard (three role payloads, all server-computed).
- Shell: app-root (login gate) → login-view (split brand panel, school doors, demo quick-fill) → app-shell (sidebar nav with groups, sticky header, demo badge, theme toggle, hash router #/module) → registry with lazy modules + stubs.
- Shared module kit: src/components/modules/kit.tsx (PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows/Grid, StatusDot).
- Dashboard module: principal (KPIs, attendance trend area chart, fee bar chart, sections list, PA1 averages, admissions funnel, activity, notices), teacher (today's periods, pending attendance, marks pending, payslip, lessons), student (KPIs, today's classes, attendance strip, PA1 vs class avg, fee due, notices).
- Dev server resilience: ported spawn-detached.mjs from reference repo — `bun spawn-detached.mjs bun run dev` survives across tool calls (direct & + setsid children get reaped).
- Verified via curl: login + all three dashboard payloads OK. Browser: login → one-click principal → dashboard renders, zero console errors.

Stage Summary:
- Foundation COMPLETE and verified. All module stubs render inside the shell.
- Demo credentials: principal arjun.malhotra@hhsp.edu.in, teacher sunita.verma@hhsp.edu.in (class teacher 10-A), student ananya.sharma.25@students.hhsp.edu.in — password Hawkings@2026.

══════════ MODULE PATTERN GUIDE (binding for all module subagents) ══════════

STACK/CONVENTIONS
- Next.js 16 App Router, TS strict, Tailwind 4 + shadcn/ui (src/components/ui/*), lucide-react icons, recharts via ui/chart.
- Fetch with `api()` from "@/lib/types" (returns data or throws Error with message). Queries: @tanstack/react-query (queryKey conventions below). Mutations: useMutation + toast (sonner: `import { toast } from "sonner"`).
- Money: integer paise-free rupees; display ALWAYS via `inr()` from "@/lib/format" (₹ Indian grouping). Dates via fmtDate/fmtDayDate/fmtDateTime/timeAgo. Numbers: className "tnum".
- UI kit from "@/components/modules/kit": PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot. Do NOT invent new card styles — reuse the kit for coherence.
- Tables: shadcn Table (ui/table). Long lists: max-h + overflow-y-auto + scroll-slim class. Filters via Select + Input with debounce (300ms).
- Every module component signature: `export function XModule({ ctx }: { ctx: ModuleCtx })` — ctx.me.role switches views. NEVER trust client role for server auth; APIs enforce.
- Server routes: use `route()` wrapper + `requireRole(...)` from "@/lib/api"; tenant = session user.schoolId (NEVER from request body). Return ok(data)/fail(status,msg). Zod-validate request bodies (zod v4 installed).
- Add an ActivityLog row (db.activityLog.create) for sensitive writes (marks publish, payment verify, student create/suspend, timetable edit, notice post, salary, enroll).
- Empty/error/loading states are mandatory for every list. NO lorem, NO fake KPIs. Copy tone: quiet, specific, human ("Attendance submitted for 8-A", not "Operation successful").
- Charts: ChartContainer from ui/chart; colors var(--chart-1..5)/var(--primary).

MODULE SPECS
- Students (PRINCIPAL+TEACHER): directory w/ search (name/admNo), class filter, status badges (ACTIVE/SUSPENDED); principal: create student (dialog: name, class, gender, guardian, phone → generates admissionNo HHSP-2026-<next> + user account email first.last.<adm4>@students.hhsp.edu.in pw Hawkings@2026 shown once), suspend/reactivate w/ confirm; profile drawer/dialog: guardian, attendance %, fee dues, PA1 summary. Teacher: only students of classes they teach (via classSubjects or classTeacherOf).
- Teachers (PRINCIPAL): directory w/ search, designation, specialization, salary (visible only to principal), subjects taught count; create teacher (dialog: name, email, designation, qualification, salary, employeeCode auto HHSP-T-###).
- Classes (PRINCIPAL): cards/table of 17 sections: name, class teacher, room, strength/capacity, subjects list w/ assigned teachers; edit class teacher (Select of teachers); create section (gradeLevel+section+capacity+room).
- Attendance (TEACHER=home-room duty, PRINCIPAL=overview, STUDENT=own record): teacher picks own class + date → roster grid with P/A/L/L toggle per student, "Mark all present" shortcut, submit → upsert per student (unique student+date; validate date is today or past school day; class teacher only for own class); principal: class-wise % for a chosen date + weekly trend; student: calendar-ish list of last 60 days + % KPI.
- Exams (PRINCIPAL): list exams (name, term, window, status); detail: subject slots per class (maxMarks, heldOn), PA1 published averages; create exam (name, term, dates); add exam-subject slots; publish results (status→PUBLISHED).
- Marks Entry (TEACHER; PRINCIPAL read): pick my subject slot (exam+class+subject I teach) → grid of students, input obtained (0..maxMarks), auto grade via gradeFor, save (upsert unique slot+student); principal sees read-only grid per slot + completeness %.
- Timetable (all roles): PRINCIPAL: class picker + editable weekly grid (Mon-Sat, P1-8; Sat P1-4), assign subject+teacher per cell with CONFLICT detection: teacher busy → 409 error shown as toast w/ teacher name; STUDENT/TEACHER: own read-only grid. GET returns slots w/ subject+teacher+room names.
- Fees (PRINCIPAL+STUDENT): principal: 3 tabs — Structures (per class fee heads w/ amount/frequency; edit/add head), Ledger (student picker → assessments DUE/PAID + payments w/ receipts; record payment dialog: student, amount, mode; allocates oldest-DUE-first), Verification (UNDER_VERIFICATION receipts list → verify→SUCCESS / reject→revert assessments to DUE); student: own ledger + dues + receipts.
- Fee Collection (TEACHER): my collected receipts (list + this month total), record payment for students of my classes (goes UNDER_VERIFICATION; principal verifies).
- Admissions (PRINCIPAL): inquiry inbox table (applicant, class, parent, phone, source, status, followUpOn), filter by status, new inquiry dialog, status advance (NEW→CONTACTED→VISIT_SCHEDULED→APPLICATION→ENROLLED / CLOSED), enroll converts to student (uses create-student logic) + activity log.
- Salary (PRINCIPAL+TEACHER): principal: teacher salary table (gross), process payslip for month (dialog: month → create PAID payslips w/ EPF 12% capped 1800 + PT 200), payslip history; teacher: my payslips (list + latest detail card w/ gross/deductions/net).
- Lesson Planner (TEACHER): list my plans (class, subject, topic, date, status DRAFT/TAUGHT/SKIPPED), create dialog (class=classes I teach, subject, topic, objectives, date, periods), mark TAUGHT/SKIPPED.
- Notices (ALL): principal: post/edit/pin notice (title, body, audience ALL/TEACHERS/STUDENTS); others: filtered list (audience) w/ pinned first.
- Results (STUDENT): published exam results per subject w/ obtained/max/grade/classAvg + overall %.
- Profile (STUDENT): my identity (adm no, class, roll, guardian, dob), no edits.
- Settings (PRINCIPAL): school profile form (name, shortName, tagline, address, city, phone, email, principalName, established, academicYear) → db.school.update + toast; show code/slug read-only.

API ROUTE OWNERSHIP (create under src/app/api/<area>/route.ts; dynamic segments in [...]/[id]/route.ts):
- 2-a: /api/students, /api/students/[id], /api/teachers, /api/classes, /api/attendance
- 2-b: /api/exams, /api/exams/[id], /api/marks, /api/timetable, /api/lesson-plans
- 2-c: /api/fees, /api/payments, /api/admissions, /api/salary, /api/notices, /api/settings
Ownership of module UI files follows the same split. Do NOT edit files outside your ownership (esp. registry.tsx, kit.tsx, app shell, auth APIs) — request via worklog instead.

---
Task ID: 2-a
Agent: modules (students / teachers / classes / attendance)
Task: Students, Teachers, Classes, Attendance modules + their APIs

Work Log:
- Note: a previous session of this task had already written the full 2-a code but crashed before verifying/appending here. This session audited every file against the pattern guide, then verified end-to-end (lint + curl with principal/teacher/student cookie jars + agent-browser across all three roles) and fixed nothing — the implementation was complete and correct. Test artifacts (1 student, 1 teacher, 1 section, 27 attendance rows, 8 activity rows) were removed after verification; demo DB restored to seed counts (353 students / 16 teachers / 17 sections, 12 activity rows).
- Modules (all `({ ctx }: { ctx: ModuleCtx })` signature, kit components, loading/empty/error states, sonner toasts, .tnum, avatarTint, inr/fmtDate/fmtDayDate):
  - students-module.tsx — directory: 300ms-debounced search (name/admNo), class + status Selects, paginated Table (20/page) with row-click (keyboard too) profile Dialog: attendance % + P/A/L/L breakdown, fee dues (itemized heads + dueOn), PA1 per-subject table w/ grade + class avg, guardian/contact block, Suspend AlertDialog / Reactivate (principal only); AddStudentDialog (name/class/gender/guardian/phone/dob) with one-time credentials panel (CopyField ×2); teachers scoped server-side to classes they teach/lead.
  - teachers-module.tsx — staff cards (avatar, designation, employeeCode, specialization badge, qualification, email/phone, subjectsCount / home-rooms / salary-per-month mini-grid via inr, joinedOn), StatCards (staff, payroll compact, section leads), debounced search, AddTeacherDialog (specialization = Select of school subject codes; employeeCode auto HHSP-T-0NN).
  - classes-module.tsx — 17 section cards: class teacher (avatar chip + Pencil → ChangeTeacherDialog PATCH), room, strength Progress vs capacity, subject chips (code + assigned teacher, warning tint when unassigned), AddSectionDialog (gradeLevel 1–15 + letter + capacity + room w/ live name preview).
  - attendance-module.tsx — TEACHER: date Input (max today), home-class Tabs (marked ✓ / pending dot), roster with P/A/L/L segmented toggle groups (aria-pressed), live tally row, "All present", dirty-count chip, submit (class-teacher-only; subject-teachers get view-only badge); PRINCIPAL: date picker, 4 StatCards, class-wise Table (P/A/L/Lv/% + Progress) w/ "not marked" state, 10-day trend BarChart (ChartContainer, var(--primary)); STUDENT: 5 KPI cards incl. 75%-eligibility tone + last-60-days day-wise list.
- APIs (route() + requireRole(), tenant = session.schoolId, zod bodies, ActivityLog on every write):
  - /api/students GET (q/classId/status/page; TEACHER scoped via classTeacherId OR classSubjects.teacherId), POST (auto admNo HHSP-2026-<next>, next roll, login first.last.<adm4>@students.<code>.edu.in + clash suffix, pw Hawkings@2026 returned once).
  - /api/students/[id] GET (profile w/ attendance %, fee dues, PA1 summary; STUDENT=own only, TEACHER=taught-classes only), PATCH (suspend/reactivate — updates Student + linked User in a transaction).
  - /api/teachers GET (search name/code/specialization + subjectCodes list + subjectsCount/classTeacherOf aggregates), POST (employeeCode auto, email uniqueness 409).
  - /api/classes GET (principal: all + rooms; teacher: own sections w/ isClassTeacher; strength = ACTIVE _count; subjects w/ teacher names), POST (gradeLabel naming, duplicate 409), /api/classes/[id] PATCH (class teacher swap, no-op + inactive guards).
  - /api/attendance GET role-aware (teacher meta+roster w/ existing marks; principal class-wise summary + 10-school-day trend skipping Sundays; student own last 60), POST (class-teacher-only, future/Sunday rejected, roster-membership + duplicate checks, per-student upsert on studentId_date unique).
- Verification (all pass):
  - `bun run lint`: 0 errors, 0 warnings in 2-a files (2 pre-existing warnings elsewhere, not mine).
  - curl as principal: students list/search/filters/pagination (353 total), create → admNo HHSP-2026-1354 + email test.verification.1354@… returned once; suspend→reactivate (user status follows); profile KPIs real (Ananya Sharma 97.6% / ₹5,000 due / PA1 88%); teachers search "verma" + create HHSP-T-017 + dup 409 + salary zod; classes create 10-B + duplicate 409 + class-teacher PATCH + no-op/role guards; attendance POST 27 entries → resubmit correction stays 27 rows (upsert), future/Sunday/non-own-class/foreign-student/empty-entries all rejected with specific messages.
  - curl as teacher: students scoped to 10 taught classes (220), PATCH students 403, teachers API 403, roster + submit OK (isClassTeacher for 10-A); as student: own 42-day record.
  - agent-browser: principal → students table (20 rows) + row-click dialog (Nursery: "not assessed for this class" honest empty PA1) + Add student dialog; teachers cards; classes cards (Class 10-A: 7 subject chips w/ teachers); attendance summary (93.9%, 10/17 marked) + trend chart 10 bars. Teacher → roster toggles (All present → 26 pressed, one flipped to Absent → tally 25/1), scoped directory. Student → own KPIs + day list. Zero console errors.
- Dev log: every 2-a route hit returned 200 (400s only from deliberate guard probes); no compile/server errors.

Stage Summary:
- 2-a COMPLETE and verified. All 4 modules render for all applicable roles; all 6 API files enforce role/tenant guards and the attendance upsert invariant. Demo DB back to pristine seed state (Task 3 E2E can proceed).

---
Task ID: 2-c
Agent: modules (continuation — fees / admissions / salary done in an earlier session; this session: notices / settings / profile / results)
Task: Finish the last 4 module UIs (Notices, Settings, Profile, Results) + their API routes

Work Log:
- Context: fees / payments / admissions / salary modules and the notices/settings route handlers were already implemented by an earlier 2-c session. This session replaced the four remaining module stubs and added two new routes. No files outside 2-c ownership were touched (registry, kit, app shell, login, dashboards, other agents' modules, prisma schema untouched).
- Modules (all `({ ctx }: { ctx: ModuleCtx })`, kit components, loading/empty/error states, sonner toasts, .tnum, inr/fmtDate/fmtDayDate/timeAgo):
  - notices-module.tsx (ALL roles) — SectionCard "Notice board" list: pinned first with Pin icon + border-primary/40 tint, title, full body (whitespace-pre-line), audience Badge (Everyone/Teachers/Students), "Posted by X · timeAgo" footer. PRINCIPAL: "Post notice" dialog (title Input, body Textarea, audience Select, pinned Switch w/ "Pin to top"), per-notice Pin/Unpin (PATCH {id, pinned}) and Remove (AlertDialog confirm → DELETE ?id=). Invalidates ["notices"] + ["dashboard"]. Role-aware subtitles + empty states.
  - settings-module.tsx (PRINCIPAL) — two-column responsive form (sm:grid-cols-2; name/tagline/address/city span 2) prefilled from GET /api/settings; plain Label+Input stack; dirty-tracked Save button (disabled until changed → "Saved"); PATCH sends all editable fields with optional ones nulled when blank; toast "School profile saved" + invalidates ["settings"], ["me"], ["doors"] (dev log confirmed /api/auth/me + /api/auth/schools refetch, shell wordmark updates). Form remounts keyed on server state so refetches re-sync inputs. Read-only identity card: code, slug, board, location, Demo/Live tenant badge, status.
  - profile-module.tsx (STUDENT) — identity card: avatarTint initials, name + HHSP student badge, admissionNo (mono), Class/Roll badges, detail grid (dob fmtDate, guardian, guardian phone, address, login email, admitted on); quick-stat StatCards (attendance % this session w/ day/absent/late sub — 97.6% for Ananya, fee dues via inr w/ pending instalments); "My class" card (class, class teacher + designation, room, roll strength). No edits, honest "Not recorded" for missing fields.
  - results-module.tsx (STUDENT) — exam selector (Select, published exams first, "published"/"awaited" suffix); published: 3 overall StatCards (total marks / percentage + best subject / CBSE grade) + subject table (obtained/max, Progress bar colored success/destructive via passAt, grade Badge, class avg small text, "— not entered" for missing marks); non-published: honest awaited EmptyState w/ exam window (+ datesheet when slots have heldOn — seed HY slots have none, so it stays hidden). Pass threshold computed server-side as passMarks scaled to the paper's maxMarks (33/100 → 9/25 for PA1), avoiding the raw passMarks-vs-maxMarks comparison bug.
- API routes (route() + requireRole(), session tenant, ActivityLog on writes):
  - /api/notices (existing, owned): PATCH/DELETE shapes verified and used as-is ({id, …} PATCH body, ?id= query for DELETE). Hardened POST/PATCH from .parse() to safeParse → clean 400s with the zod issue message instead of a 500.
  - /api/settings (existing, owned): PATCH schema extended — nullable text fields (shortName/tagline/address/city/phone/email/principalName/established) now accept null so the form can clear them; PATCH converted to safeParse. GET unchanged.
  - /api/profile (new, GET, STUDENT): own student row + user email, class w/ classTeacher name+designation (select, not include — scalar designation), room, active strength; session attendance counts + pct (PRESENT+LATE rule, matches dashboard); fee dues net of concession.
  - /api/results (new, GET, STUDENT): every exam with slots for my class (published first, then startsOn desc); published → subjects (subject, code, maxMarks, passMarks, passAt, obtained, stored grade w/ gradeFor fallback, classAvg rounded 0.1) + overall (totalObtained/totalMax/pct/grade/best subject); non-published → datesheet only (subjects withheld).
- Verification (all pass):
  - bun run lint: 0 errors/warnings in my files (only the pre-existing use-hash-route.ts warning remains). bunx tsc --noEmit: no errors in any 2-c file (pre-existing errors exist in others' files only).
  - curl (principal + student jars): profile GET (Ananya: adm HHSP-2026-1353, dob 14 Mar 2011, guardian, attendance 97.6%, ₹5,000 dues, Sunita Verma / Room 115); results GET (PA1 published: 4 subjects 88/100, 88%, A2, best English 96%, classAvgs ~17.7–18; HY awaited w/ empty datesheet); notices GET student=6 / principal=7 audience-filtered; POST → PATCH pin → DELETE → re-delete 404; student POST 403; short-title POST 400 w/ message; settings GET/POST-shape PATCH (tagline change, null-clear, bad email 400, student 403) then restored.
  - agent-browser E2E: student → My Results (PA1 table + stat cards, selector → Half-Yearly awaited state), My Profile (identity card, stats, class info), Notices (6 cards, pinned first) — zero console errors. Principal → Notices: post pinned TEACHERS notice via dialog (toast "Notice published — …", appears first w/ Unpin/Remove), Remove w/ AlertDialog (toast, back to 7); Settings: prefilled form, edit tagline → "Save changes" → toast "School profile saved" → form re-syncs to "Saved", revert → saved again; me/doors invalidations visible in dev log. Zero console errors throughout.
  - Cleanup: all verification artifacts removed — demo DB restored to seed state (7 notices, 12 activity rows, school profile untouched).

Stage Summary:
- 2-c COMPLETE and verified. All 17 registered modules now have real implementations; no stubs remain. Demo DB pristine (Task 3 E2E can proceed).
