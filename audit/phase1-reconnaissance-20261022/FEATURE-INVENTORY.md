# PHASE 1/9 — FEATURE INVENTORY (role-by-role, module-by-module)

Scope note: this is an inventory of what EXISTS in the codebase at `main @ 7585fad`, with location, intended behavior, permission requirements, dependencies and test coverage. **Existence ≠ verified working.** Verification status comes from the Phase 1 baseline (CI/local tests) and will be extended click-by-click in Phase 2 via TEST-MATRIX.md. Nothing here claims 100 % coverage.

Counting methodology (all counts re-computed this session):
- Pages: `find src/app -name page.tsx` → **21**
- API route files: `find src/app/api -name route.ts` → **324** (+ 2 non-API route files = the 326 total)
- HTTP method handlers: `grep "export async function {GET,POST,PUT,PATCH,DELETE}"` → GET **179** · POST **153** · PUT **11** · PATCH **42** · DELETE **27** = **412 handlers**
- Prisma models: `grep "^model " prisma/schema.prisma` → **131** (0 enums; status vocabularies are string fields)
- Migrations: `prisma migrate status` → **28**
- Test files: `find tests -name "*.test.ts*"` → **116** (unit 21+2 tsx, integration 2, api 10, regression 9, security 70, e2e 4)

---

## 1. Planes and routes (page tree)

| Route | Plane | Purpose |
|---|---|---|
| `/` | school | landing → tenant resolution/portal (marketing component set) |
| `/login` | school | unified school login door |
| `/auth/callback` | shared | auth callback (Supabase linking flow) |
| `/platform` (+ `(console)` group) | platform | console root (Overview) |
| `/platform/login`, `/platform/forgot-password`, `/platform/reset-password` | platform | platform auth doors (lockout + recovery) |
| `/platform/(console)/schools`, `/schools/new`, `/schools/[id]` | platform | schools directory + 7-step provision wizard + school detail (tabs: Identity requests, Domains, Subscription, Setup, Users, Payment gateway, Support, Audit) |
| `/platform/(console)/subscriptions` | platform | subscription registry/plans/codes |
| `/platform/(console)/admins` | platform | platform admin accounts & permissions |
| `/platform/(console)/support`, `/platform/support/view` | platform | support oversight + school-session tools |
| `/platform/(console)/announcements` | platform | platform announcements broadcast |
| `/platform/(console)/audit` | platform | platform audit log |
| `/platform/(console)/operations` | platform | operations center (overview, health runs, alerts, errors, usage) |
| `/platform/(console)/sessions` | platform | admin session management |
| `/platform/(console)/settings` | platform | platform settings + account security |
| `/s/[slug]`, `/s/[slug]/login` | school | canonical tenant website + per-tenant login door |
| `/health/*` (`live`, `ready`) | both | probes (liveness/readiness; used by CI + deployment verify) |

Plane gating: `SCHOLARIO_PLANE` env (`platform` | `school` | `unified` dev default) — route inventory + plane-architecture tests enforce that school APIs don't exist on the platform plane and vice versa (single documented cross-plane exemption: public announcements broadcast).

## 2. Roles

**Platform plane** (`PlatformAdmin`, root + non-root):
- Permission registry (11 keys): `schools.read`, `schools.manage`, `schools.provision`, `billing.manage`, `billing.complimentary`, `announcements.manage`, `settings.manage`, `audit.read`, `support.access`, `admins.manage`, `ops.read` (root = all; non-root = granted rows; grants managed via `/api/platform/admins/[id]/permissions`).
- Step-up MFA (TOTP) required for destructive actions (suspend, credential resets, feature-flag surgery); rate-limited lockout + Google OAuth linking (link/unlink/status/callback) for admins; recovery-ticket flow for locked-out admins.

**School plane** — canonical roles: `PRINCIPAL`, `TEACHER`, `STUDENT` (login door + `withUser` enforce the allowlist; legacy vocabulary PARENT/MANAGEMENT/ACCOUNTANT/DRIVER is non-authenticating residue by design — `src/lib/security/permissions.ts`). Teachers have a "relieved staff" restricted mode (relieved-views.tsx).

## 3. Platform console modules (sidebar = 10 destinations; `console-shell.tsx`)

| Module | Route | Key surfaces | API dependencies | Tests |
|---|---|---|---|---|
| Overview | `/platform` | system health overview, pending-tenant banner | `platform/overview`, `platform/health`, `platform/operations/*` | platform-overview-health.test.ts |
| Schools | `/platform/schools` | directory (filters: demo/production, readiness, subscription state; sort name/created), **Add School 7-step wizard** (Identity → Subscription → Academic → Branding → Address → Review → Create), school record detail (activate/suspend/reactivate, feature flags, plan, subscription terms/payments, domains CRUD+DNS verify, users, access controls incl. credential reissue, setup-readiness, identity-change requests, admissions-issuance, payment-gateway config, per-school audit) | `platform/schools*` (33 route files) | schools-management-overhaul, school-onboarding-wizard (785 lines), provisioning-reliability, platform-schools-attention-filter, platform-provisioning |
| Subscriptions | `/platform/subscriptions` | registry summary, plans CRUD, activation codes (issue/revoke), config | `platform/subscriptions/*`, `webhooks/platform-subscription` | platform-subscriptions-registry-summary, saas-hardening, subscription-* suites |
| Users & Access | `/platform/admins` | admin accounts, permission grants, suspend/reactivate, reset-password, recovery tickets, Google unlink | `platform/admins/*` | platform-account-recovery, platform-lockout-recovery |
| Support | `/platform/support` | support sessions + school-session revoke | `platform/support/*`, `platform/school-sessions` | platform-support-sessions-revoked |
| Announcements | `/platform/announcements` | broadcast CRUD + public feed | `platform/announcements*` | (covered by platform-isolation) |
| Audit Log | `/platform/audit` | full `PlatformAuditLog` browsing (the "Audit Log incident" regression is E2E-tested) | `platform/audit` | audit.test.ts, platform-console-journeys (E2E) |
| Settings | `/platform/settings` | platform settings, account security (password, TOTP, Google link) | `platform/settings`, `platform/auth/*` | platform-password-change, platform-mfa-config |
| My Sessions | `/platform/sessions` | admin's own session list + revoke | `platform/auth/me`, session revoke | platform-session-gate (unit) |
| Operations | `/platform/operations` | health runs, alerts (ack/resolve/settings), error ledger (fingerprint ack/resolve), diagnostics, usage/school-usage + sync | `platform/operations/*` (13 route files), `cron/ops-sync` | ops-* unit suites, ops-isolation |

## 4. Principal modules (`src/components/principal/modules/` — sidebar registry in principal-panel.tsx)

| Group | Module | Key behaviors | Selected API routes | Tests |
|---|---|---|---|---|
| Overview | Dashboard | KPIs, finance/attendance snapshots | `/api/dashboard` | phase75-product, journeys E2E |
| Academics | Admissions | inquiry intake, application forms, decision workflow (accept/reject/enrol), fee snapshot, official admission letter | `admissions/*` (7 routes) | admission-duplicate-detection, admission-fee-honesty, platform-admissions-issuance |
| | Teachers | directory, add-teacher wizard (multi-step), upload/import, relief/deactivation | `teachers*`, `teachers/upload*` | add-teacher-honesty |
| | Students & Classes | student CRUD, class cards (grouped display), class details (subjects/CSA, class-teacher appointment, rooms), Add Class flow, archive/restore, roster | `students*`, `classes*`, `students/roster`, `rooms*` | class-teacher-appointment-regression (regression suite), QA defect verification pack 2026-10-17 |
| | Timetable | grid editing, publish (atomic class/subject/CSA auto-create), teacher load views | `timetable`, `timetable/publish` | honesty-sweep, timetable suites |
| | Attendance | day capture, overview analytics, exam attendance | `attendance`, `attendance/overview`, `exams/[id]/attendance*` | attendance-real-data |
| | Examinations | exam CRUD, schedule/seating/admit-cards, marks entry + verify/lock, outcomes compute, results declare, report cards, grade scales, exam types, policies | `exams/*` (30 route files) | fee/exam suites; exams settings CRUD under tests/api |
| Finance | Fee Management | structures (draft→publish), catalogue, quote/verify/pay (two-stage), receipts, defaulters + reminders, refunds, reconciliation, settlements, discount rules, gateway config | `fees/*` (17 routes) + `webhooks/razorpay` | fee-admissions, fee-gateway, fee-lifecycle, pg-money-precision, export-policy |
| | Salary & Payroll | salary structures, payments, void, payslips | `salary*` | salary-persistence |
| | Finance Dashboard | ledger/receivables analytics | `/api/dashboard`, `fees/reconcile` | honesty-sweep |
| Operations | Applications & Forms | form builder + submissions (tag: Demo) | `applications` | (module-flag gated) |
| | Communication | announcements | `announcements*` | auth-gate |
| | Messages | parent-teacher messaging threads | `messaging/threads`, `messages` | messaging-persistence |
| | Calendar | school events | `events` | calendar-server-events |
| | Library | book catalog, issues | `library` | library-server-wiring |
| | Transport | routes, vehicles, users | `transport` | (module-flag gated) |
| | Inventory | item ledger (Demo tag) | `inventory` | — |
| | Certificates | template → generate → history | `certificates` (store-backed) | — |
| | Downloads | document center | `downloads-content` store | — |
| Website | Website Management | CMS: home/about/admissions/contact, notices (RSS feed), gallery, media upload, social links, admissions settings | `school/website/*` (11 routes), `public/notices/rss`, `school/domains` | tenant-domains, seed-website-cms, read-audience-hardening |
| System | Settings | school profile, working days, module flags, profile-change requests (platform-approved), domain management | `school-settings*`, `school/domains`, `school/setup-readiness` | platform-plan-marker-sync, honesty-sweep |
| | Subscription | tenant subscription state, plans/orders, student entitlement status | `subscription*` | subscription-lock, subscription-entitlement, saas-hardening |

## 5. Teacher modules (`src/components/teacher/modules/`, nav-registry.tsx)

| Module | Behaviors | API routes | Tests |
|---|---|---|---|
| Dashboard | day/week load, duties | `teacher/dashboard` | journeys E2E (teacher) |
| Class Attendance | draft → board publish flow, baseline | `teacher/class-attendance*` | attendance-real-data |
| Lesson Planner | syllabus/topics/plan/completion | `teacher/lesson-planner*` | — |
| Marks Entry | grid + scan-draft (OCR), save/submit | `teacher/marks-entry*`, `exams/[id]/marks*` | phase75-product |
| Student Directory | class-scoped student list, marksheet view | `teacher/students*` | tenant-isolation |
| Student Growth | growth events/follow-ups | `teacher/growth*`, `teacher/follow-ups*` | — |
| My Class (class-teacher hub) | roster, marksheets, communication for own class | `teacher/class-hub*` | class-teacher-appointment-regression |
| My Salary & Payments | payslips, payment history | `teacher/role`, `salary/*` (scoped) | salary-persistence |
| My Attendance / My Timetable | personal records + export | `teacher/timetable`, `student/attendance` pattern | — |
| Parent Connect | conversations with parents | `teacher/parent-connect*`, `teacher/communication*` | messaging-persistence |
| Application Reviews | admissions duty queue | `teacher/applications` | identity-authz |
| Analytics | teaching analytics | `teacher/analytics` | — |
| Fee Collections | collection records for assigned students | `teacher/fee-collection` | — |
| Settings | profile | `teacher/settings`, `profile*` | — |
| Relieved-staff restricted views | profile/payroll/fee-collections only | (relieved-views.tsx) | — |

## 6. Student modules (`src/components/student/`)

| Module | Behaviors | API routes | Tests |
|---|---|---|---|
| Dashboard | today's schedule, notices | `student/dashboard` | journeys E2E (student), student-holidays-real-events |
| My Profile | own record, guardian info, documents | `profile`, `students/[id]` (self) | identity-authz |
| Timetable / Attendance | own class views | `student/timetable`, `student/attendance` | — |
| Results | declared results, report card | `results`, `exams/[id]/outcomes/[studentId]` | — |
| Learning (L2D) | study materials, bookmarks, activity, search | `study-materials*`, `student/learning*` | assignment-scope, search-book-leak |
| Flashcards / Study Groups / Study Tasks | decks, review, groups+questions, tasks | `student/flashcards*`, `student/study-groups*`, `student/study-tasks*` | — |
| Messages / Notices | messaging, notice feed | `student/notices`, `messages`, `student/support` | student-messaging-contacts, messaging-persistence |
| Fees | own dues, order→verify, receipts | `student/payments*`, `fees/receipts` | fee-lifecycle, fee-gateway (student checkout) |
| My Subscription | per-student entitlement state, activation-code claim | `subscription/student*` | subscription-entitlement |
| Certificates / Transport / Applications | own documents, bus route, forms | `certificates` (scoped), `transport`, `applications` | — |
| Settings | profile prefs, notification prefs | `student/settings`, `profile/avatar*` | — |

## 7. Database model map (131 models — families)

- **Platform control plane**: PlatformAdmin, PlatformAdminSession, PlatformPermission, PlatformAuditLog, PlatformAlert(+Setting), OperationalError(+Event), PlatformAnnouncement, PlatformSetting, PlatformPasswordReset, PlatformRecoveryTicket, PlatformPayment, SubscriptionPlan/Order, SchoolUsageDaily, SchoolActiveUserDay, ProviderSyncRun, ProviderUsageSnapshot, MonitoringCheck, JobRun
- **Tenancy core**: School, SchoolSubscription, SchoolPaymentGateway, SchoolProfileChangeRequest, TenantDomain, Session, RateLimitBucket, WebhookEvent
- **People**: User, UserPreference, Student, StudentEntitlement, StudentSubscriptionPayment, Teacher, TeacherFollowUp, SupportSession
- **Academics**: Class, Subject, ClassSubjectAssignment, CurriculumTopic, Exam family (Exam, ExamClass, ExamSubjectConfig, ExamScheduleItem, ExamMark, MarksScanDraft, ExamAttendance, Result, ReportCardConfig), Timetable, Room, Attendance(+Draft), Assignment, QuestionBank
- **Learning 2.0**: StudyMaterial(+Target), LearningActivity, LearningBookmark, FlashcardDeck/Flashcard, StudyGroup(+Member/Question), StudyTask
- **Finance**: Fee, FeeStructure, FeeTransaction, Payment, Settlement, Reconciliation, MasterFeeHead, SalaryStructure, SalaryPayment
- **Comms/ops**: Message, MessageTemplate, ParentConversation/Message/Grievance, Notification(+Read), Announcement, SchoolEvent, Homework family (Homework, Policy, Submission, Survey, AuditLog, NoHomeworkDate), LibraryBook, Vehicle/Route, UploadedFile, Website{Notice,Media,Admission,SocialLink}

Key relationships: everything tenant-scoped via `School.schoolId` (+ RLS, 24 GIN trgm indexes, 11 schoolId FK indexes — `tenant-isolation` 57 tests, `pg-rls`, `database-integrity` 41 checks). `Class` rows are (name, section) pairs — unique `[schoolId, name, section]`; sections are rows, not a separate model.

## 8. External integrations & scheduled/background work

| Integration | State | Evidence |
|---|---|---|
| Resend (email) | live in production — dual-scheme Svix verification (PR #55), rejection ledger (PR #54), in-app webhook repair tooling (PR #50–52), live verification green (run 39802116911) | docs/EMAIL.md, scripts/prod-release/email-*.ts |
| Razorpay (fees) | contract-verified via sandbox + signed-webhook battery (`PAYMENTS_SANDBOX`); live keys configured per config-preflight; live settlement reconciliation NOT re-verified this phase (P1 user-side item from prior audits remains) | fee-gateway/saas-hardening tests |
| Supabase | production Postgres (ap-south-1) + optional Supabase-auth account linking (`/api/auth/supabase/*`, live exchange suites skip locally by design) + optional realtime mode | supabase-auth-linking (integration), realtime-bridge |
| Google OAuth | platform admins only; OFF unless GOOGLE_* env present (fail-closed contract tests) | platform-account-recovery §H |
| Cron/background | `/api/cron/ops-sync` (usage snapshots/alert sync), JobRun ledger, dev keepalive + supervisor tooling | ops suites |
| CI/Release | 7 workflows; Release embeds full CI gate incl. the signed-webhook battery (PR #56); two-plane deploy hooks + verify-deployment script | .github/workflows |

## 9. Verification status summary (what Phase 1 can honestly claim)

- **Proven this phase**: typecheck/lint green; 1,743 local test cases executed (all suites green modulo the two documented environment-class items in BASELINE §6); CI green on the identical tree at `7585fad`; both production planes READY on `7585fad`; email→webhook→DB chain green (run 39802116911 + Release gate).
- **NOT verified this phase** (Phase 2 targets): click-by-click UI behavior per role (TEST-MATRIX.md), the wizard-created-school display correctness (currently **broken** — see CLASS-SECTION-INVESTIGATION.md), any claim of 100 % coverage.
- **Known-open product defect found by this phase**: Grade-0 class grouping (display) — the only confirmed product defect; see DEFECTS.md D1.
