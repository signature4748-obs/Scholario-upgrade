# SCHOLARIO — School Delivery & Onboarding Package

**Release version:** 2.14.0 · **Prepared:** 2026-10-15 · **For:** school rollout demonstration

This package matches the real shipped application — every screen, credential and
workflow named below exists in the verified build. Nothing here is aspirational.

---

## 1. Environments — read this first

| Environment | URL | Data | Purpose |
| --- | --- | --- | --- |
| **Demo (sandbox preview)** | The preview panel / sandbox URL of this deployment | Hawkings High School Prithvipur — a **demonstration tenant** (`isDemo=true`) with a realistic full corpus | What you show schools tomorrow |
| **Production** | `https://scholario-platform.vercel.app` (control plane) · `https://scholario-app-virid.vercel.app` (school plane) | Real tenants | Live schools — do not demo against this |

**Every account and record in the demo tenant is sample data created for
demonstration.** The clean tenant (Green Valley Public School) shows the honest
empty state a brand-new school sees on day one.

**Two planes, one product:** the *platform* plane is where the SaaS operator
onboards schools and manages subscriptions; the *school* plane is where each
school's website, login and ERP live. A school never needs the platform plane.

---

## 2. School onboarding (platform operator → school live)

1. Operator signs into the **platform console** and provisions the school:
   name, code, slug, city, principal name + email, academic session.
2. The system creates the school **website + branding skeleton**, the
   principal's account, and emails a **one-time invitation** containing a
   temporary password (shown once at provisioning; re-issuable).
3. The principal signs in at the school's own login portal and is prompted to
   **set a new password** on first sign-in.
4. The school appears at its own public URL `/?slug=<school-slug>` with its own
   branding, notices, admissions enquiry form and login portal.
5. Subscription: the school starts **ACTIVE on its plan**; entitlements are
   enforced server-side per the subscription model (docs/SCHOOL_SUBSCRIPTION_ACCESS_MODEL.md).

**Principal setup checklist (day one):**

- [ ] Sign in with the invitation password; set your own password
- [ ] School settings: session, affiliation, contact details, branding colors
- [ ] Create teachers (Admissions → Teachers) — each gets login credentials
- [ ] Create classes & sections with rooms (Students & Classes)
- [ ] Assign class teachers and subject teachers (CSA)
- [ ] Create students with guardians (Students & Classes → Students)
- [ ] Configure fee structures per class (Fee Management)
- [ ] Publish the timetable (Timetable)
- [ ] Send the school-wide welcome notice (Communication)

## 3. Teacher guide (daily use)

- **Sign in:** school login portal → institutional email + password.
- **Dashboard:** today's classes, pending attendance, notices, messages.
- **Attendance:** Attendance module → pick class & date → mark present/absent
  → submit. Historical attendance and per-class reports stay available.
- **Marks entry:** class hub (your class) or the examinations module →
  marks-entry sheet → enter per-subject marks → submit. The principal verifies.
  Once results are **declared**, marks are locked (immutable history).
- **Messages & parent connect:** Communication → messages; guardians are
  reachable per student.
- **Study materials:** upload materials for your subjects (file upload with
  signed access URLs).

## 4. Student & family guide

- **Sign in:** school login portal → student email + password.
- **Dashboard:** today's timetable, attendance %, fees due, notices,
  learning tasks.
- **Results:** once the principal declares an exam's results, the latest
  declared results card shows subject marks, percentage and honest class rank.
  **Marksheets** (per-exam, subject-wise, with grade and rank) are visible in
  the results area of the student profile.
- **Attendance:** personal attendance history is on the dashboard.
- **Fees:** outstanding amount + nearest due date (no payment pressure data
  beyond the school's own records).
- **Parents:** logins are **student accounts** in this release — guardians do
  not get separate accounts (see §7 limitations).

## 5. Fees — recording & verification (office / principal)

1. **Collect fee:** Fee Management → record payment (cash/online) against a
   student's fee head. Cash collections recorded by a teacher sit at
   **UNDER_VERIFICATION** — they are visible as pending, **not yet receipts**.
2. **Verify:** principal/office opens the verification queue → verify (issue
   the numbered `SCH-YYYY-NNNNNN` receipt + credit the ledger) or reject (with
   reason). Verification is idempotent — a settled transaction cannot be
   double-credited, and rejecting a settled one is refused.
3. **Dashboards:** Finance Dashboard totals come from the real ledger; the
   8 cash collections totalling ₹6,660 currently shown as *under verification*
   in the demo tenant are **seeded demo records** demonstrating the honest
   pending state.
4. **Dues & defaulters:** defaulters lists derive from live fee rows.

## 6. Examinations — create → marks → declare → marksheets

1. Principal creates the exam (subjects, classes, dates, max marks) — status
   Draft → Scheduled.
2. Exam runs (Ongoing) → invigilation/seat plans → attendance.
3. Teachers enter marks per class-subject; principal verifies and locks papers.
4. **Declare results** (Result Ready → Result Declared): results become
   visible to students; marks become immutable; publishing notifies.
5. Marksheets/report cards: per-student and per-class PDF export with grades,
   rank and co-scholastic areas.
6. Status note: the overview "Results Declared" counter treats both
   `Result Declared` and the historical `Declared` value as declared
   (2026-10-15 canonicalisation fix — see §9).

---

## 7. Known limitations (honest, at this release)

- **Parent accounts:** separate parent logins are **not** in this release by
  design — the student account is the family's window; parent contact details
  live on the student record and are reachable by teachers. A dedicated parent
  portal is a future scope decision for the owner.
- **Google sign-in:** off in production until configured (honest degradation,
  email + password everywhere).
- **Online payments (Razorpay):** not configured in production; the system
  **fails closed** — no order can be created or settled, and no entitlement can
  be unlocked by an unconfigured gateway. Offline lanes (operator recording +
  activation codes) work.
- **Email in the local demo** is dev-log transport (emails appear in the
  server log, not inboxes). Production email runs through the configured
  provider.
- **Realtime notifications** degrade gracefully when realtime is unavailable
  (the database stays the source of truth; screens refresh honestly).
- Demo-tenant data is sample data; the demo tenant's locked accounts
  (subscription-locked) demonstrate the locked-state UX, not real students.

## 8. Support & escalation

- **Tier 1:** school ERP principal/admin (settings, passwords, staff).
- **Tier 2:** platform operator (subscriptions, activation codes, provisioning,
  billing questions) via the platform console.
- **Escalation:** owner of the Scholario deployment (see repo
  docs/RELEASE.md § contacts) — bug reports should include the URL, the
  account role, the time, and what was expected vs. seen.
- Password resets: self-service "Forgot password?" on both login portals;
  platform admins have account-recovery with emailed tokens.

## 9. Release identity & verification summary (2026-10-15)

- Release candidate for production: `origin/main` @ `8e58baa` (deployed,
  unchanged) + **PR #30** @ `284d90a` (subscription & entitlement system —
  CI green, mergeable, **awaiting owner approval** to merge + migrate).
- Demo build: this workspace (local `main` @ HEAD after the 2026-10-15 fixes)
  serving the full ERP with the canonical demo corpus.
- Key verifications: tenant isolation 76/76; platform isolation 45/45;
  subscription entitlement 33/33; fail-closed + lock suites 12/12; regression
  139/139; unit 91/91; integration 49/49; API 65 (10 environment-gated skips);
  exam result-status regression 18/18 (new); typecheck clean.
- Production DB: 23/25 migrations applied, 2 pending (owner-gated);
  financial ledger digest unchanged since 2026-10-13.

## 10. Demo credentials (DEMO TENANT ONLY — sample data)

Demo password families are env-driven seeds (rotate for anything beyond
demo). **No credential values are inlined in this repository** (Phase 8A
regression guard); the single value source is `prisma/seed-credentials.ts`
(env-overridable, server/test-side only):

| Role | Email | Password source |
| --- | --- | --- |
| Principal | `principal@hawkingshigh.edu` | `prisma/seed-credentials.ts` (demo family) |
| Teacher (featured) | `teacher1@hawkingshigh.edu` | `prisma/seed-credentials.ts` (demo family) |
| Student (featured, 7-A) | featured student email (see `docs/HAWKINGS_DEMO_TENANT.md`) | `prisma/seed-credentials.ts` (demo family) |
| Other staff/students | `<name>@hawkingshigh.edu` | `prisma/seed-credentials.ts` (demo family) |
| Platform root | `admin@scholario.cloud` | `prisma/seed-credentials.ts` (platform defaults) |
| Clean tenant | `principal.b@greenvalley.test` | `prisma/seed-credentials.ts` (tenant fixture) |

**These are demonstration credentials for sample accounts.** Never reuse them
for production tenants; production accounts get invitation passwords and
forced first-login rotation. The credential report generator
(`bun scripts/gen-credential-report.ts`) produces the per-deployment report
outside the repo.
