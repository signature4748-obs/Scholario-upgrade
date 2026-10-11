# AUDIT 6/7 — PRIORITIZED REPAIR BACKLOG (incl. Phase 7: PR-3 fee integrity findings)
Audit date: 2026-10-09 · Scope: everything found by Audits 1–5 · No fixes were implemented (audit-only).

---

## A. Backlog (severity-ranked)

### P0 — critical (release/verification blocking)

**P0-1 Workspace DB stack is down (environment, not code).**
- Evidence: Audit 1 §2–3, Audit 4 §3.2 (prisma datasource URL rejected; `/health/ready database:failed`; login POST 500 pre-auth; door 404; event-stream reconnect failing).
- Affected: ALL roles, ALL DB-backed modules (matrix §2–6).
- Verified: YES (live probes today).
- Minimal fix (Gate A, needs approval + operator secrets): restore `.env` (PG URL + full env set from operator secret store) → start `mini-services/postgres-db` (fresh cluster) → `bunx prisma generate` (already done) → `prisma migrate deploy` (isolated local DB — allowed as migration-chain check) → re-seed demo corpus (seed scripts = the approval gate) → verify.
- Test coverage: after Gate A, run the full suite family (518-test historical matrix) + e2e.
- Dependencies: operator-held env values.

**P0-2 Persistence & process (workspace controller).**
- Evidence: Audit 1 §2 (three reset events; untracked/ignored wiped; external branch revert 02:41:48; `worklog.md` evidence loss).
- Affected: development workflow, evidence trail, any future implementation.
- Verified: YES.
- Minimal fix: policy — commit at every approval gate; verify branch presence + `git status` before each phase; keep canonical evidence in git (commit this `audit/` dir at the next gate); never leave uncommitted work across long operations.
- Dependencies: none (process).

### P1 — major production correctness / workflow

**P1-1 Local `main` carries accidental deletions (`baf93ac` amend).**
- Evidence: Audit 2 §3 (4 upload routes deleted vs. baseline; tarball `--exclude='upload'` damage class; `3fd6a13` precedent).
- Affected: school website + teachers upload APIs (local tree only — remote main intact).
- Verified: YES (tree comparisons).
- Minimal fix (Gate B): reconcile local main to the remote line (remote main is protected — PR flow per docs/CI.md), restoring the 4 routes; the legitimate docs delta is identical in both lines.
- Test coverage: upload suite (14) + typecheck.
- Dependencies: Gate A not required; branch-protection rules.

**P1-2 event-stream service / realtime ticker degraded.** Auto-heals after Gate A (it reconnects to PG); consider adding postgres-db to the container start sequence (workspace change — approval). Evidence: service.log attempts 163+. Verified: YES.

**P1-3 Bootstrap `.env` template is incompatible (SQLite URL for a PG app).** Every reset silently re-breaks the DB layer. Fix: operator-level bootstrap correction or a documented first-step runbook check. Evidence: Audit 1 §2. Verified: YES.

**P1-4 Vercel deployment wiring unverified.** Which SHA is live on the two plane projects is unknown (git integration never connected per 8C; handoff token invalid). User-side: check dashboard, connect integration or deploy deliberately, verify SHA = `3ae3c85`. Verified: NO (credential-gated).

**P1-5 Phase-4 completion check.** After Gate A, re-run the Principal/Teacher/Student demo login→dashboard flows on the ORIGINAL app (browser E2E) and confirm the preview. Verified: NOT YET (blocked by Gate A).

**P1-6 Supabase production read-only reconciliation** (record counts, referential integrity, financial consistency, RLS advisor). User-side, credentials required. Verified: NO.

### P2 — important incomplete functionality

**P2-1 PR-3 fee integrity (admission documents) — full findings in §B below.** The payment side is sound; the admission document side needs the server-authoritative fee snapshot. Re-implement Gate-1/Gate-2 from the preserved specification on `pr3-recovery-baseline` (original work unrecoverable — prior forensic verdicts stand).
**P2-2 R4 store families server hydration** (messages, calendar, library, transport, inventory, certificates, downloads) — demo-gated client stores; models/部分 APIs exist. DATA_SOURCE_MAP migration path.
**P2-3 CI restoration** (workflow-scoped PAT → un-park `ci.yml`) — the parked pipeline is the designed reset-resilience net (fresh PG + migrate + seeds + suites).
**P2-4 Finance statements real expense/ledger model** (retire R3 illustrative panels).
**P2-5 Payroll model** (retire salary inert history).

### P3 — polish / maintainability

- P3-1 `docs/DATA_SOURCE_MAP.md` stale SQLite references (§0 line 15, §2 table — predates the PG migration).
- P3-2 `fee-workflow.ts:75` stale "SQLite serialises writers" comment; optional P2002-retry polish on receipt minting (uniqueness is already DB-enforced: `@@unique([schoolId, receiptNo])`).
- P3-3 ESLint `react-hooks/exhaustive-deps` warning burn-down (56).
- P3-4 `VERCE_URL` typo'd env name in code (should be `VERCEL_URL`).
- P3-5 `sandbox/v2-rebuild` branch: keep quarantined (do-not-merge per its own SANDBOX.md); user decides long-term retention/extraction.

---

## B. Phase 7 — PR-3 fee integrity findings (all verified on the current tree, 2026-10-09)

### B.1 Exact source locations (unchanged since the PR-3 static audit — content identical to baseline)

| # | Location | Finding | Class (2-F taxonomy) |
|---|---|---|---|
| F1 | `src/components/principal/modules/FeeStructureStep/fee-snapshot.ts:82–86` | `\|\| 1500`, `\|\| 15000`, `\|\| 60000` — missing config silently becomes fabricated amounts | fabricated fallback (production path) |
| F2 | `src/components/principal/modules/FeeStructureStep/useFeeCalculations.ts:4` | `import { feeStructures } from '@/lib/mock/finance'` — mock catalog feeds the wizard | mock source |
| F3 | same file `:150–152` | identical `|| 1500/15000/60000` fallbacks | fabricated fallback |
| F4 | `src/components/principal/modules/FeeStructureStep/constants.ts:10,13` | `TRANSPORT_COST = 18000`, `HOSTEL_COST = 45000` (+ `ACTIVITY_KIT_ITEMS` prices) — optional charges invented client-side | fabricated optional-charge amounts |
| F5 | `src/lib/school-settings.ts:56–77 (feeHeads), :92 (discountRules), :100 (examFeeConfig), :64+ (booksMaster)` | `defaultSchoolSettings` ships 6+ fee heads (₹1,500/₹15,000/₹60,000/₹5,000/₹2,400/₹3,000…), discount rules, exam fees, and **19+ fabricated book entries (₹110–₹680, real-sounding publishers NCERT/Oxford/Camlin/Candid/Evergreen)** as client-side defaults | demo default masquerading as config |
| F6 | `src/components/principal/modules/admission/components/issuance/letter-data.ts:2, 54–60` | **official admission-letter financials computed client-side** from the application's own `feeData` via client `computeFeeSnapshot` — the client is the authority for an official document | client-side authority (the core PR-3 violation) |
| F7 | `src/components/principal/modules/OfficialAdmissionLetter/FeeBreakdownTable.tsx:27–50` | `|| 0` on registration/books/exam fee rows — missing config renders ₹0 (three-state violation) | missing→zero |
| F8 | `src/components/principal/modules/OfficialAdmissionLetter/letter-html.ts:28–29, 56–58` | `?? 0` / `|| 0` on subtotal/discount/fee rows — same violation in the downloaded HTML | missing→zero |

### B.2 Affected document flows
Admission wizard fee step (`FeeStructureStep`) → application review (`AdmissionApplicationFormModal` Page 2 fee data) → **official admission letter** (`letter-data.ts` → `letter-html.ts` → `FeeBreakdownTable.tsx`) → **fee receipt tab** (`issuance/FeeReceiptTab.tsx`) → downloaded/printed HTML. Optional categories (transport/hostel/activity/books) can be invented from constants; missing required heads silently become ₹0 or fabricated defaults.

### B.3 Missing-configuration behavior required (per the preserved PR-3 spec)
Three-state semantics: configured positive / explicit ₹0 / **missing → "Not configured"/"—"** (never ₹0, never a default). Server-authoritative snapshot: `School.settings → normalizeFeeConfig() → computeFeeSnapshot() → documents`; client adapter preview-only; session-derived tenant (never client schoolId/fee input); demo seed only for the Hawkings `isDemo` tenant, idempotent, explicit (never at startup).

### B.4 Gate-1/Gate-2 recovery status
**Unrecoverable** (forensic verdicts from the prior sessions stand: commit `a77cf38` exists nowhere; the uncommitted Gate-2 tree had no reference). The baseline (`3ae3c85`) is preserved on `pr3-recovery-baseline`. Re-implementation from the written specification is the path (Gate C in Audit 7).

### B.5 Required regression tests (when implemented)
Three-state rendering per document row; server boundary rejects client fee input/schoolId (authorization + tenant tests in the security-suite style); fee-snapshot parity client-preview vs server-official; demo-seed idempotency + tenant guard; no fabricated fallback literals in official paths (pattern scan à la DATA_SOURCE_MAP §6).

### B.6 Payment-side audit (positive — integrity confirmed)
- Two-stage workflow: class-teacher collection (UNDER_VERIFICATION) → principal verify → ledger (`Fee.paid`) moves; outstanding = billed − verified paid; pending reported separately.
- `Payment.transactionId @unique` — replayed webhook/double-verify cannot mint duplicates; `WebhookEvent.eventId @unique` idempotency; Razorpay webhook: HMAC-SHA256 + `timingSafeEqual`; auto-reconciliation.
- Receipts: DB-backed sequential `SCH-YYYY-NNNN`, `@@unique([schoolId, receiptNo])`; duplicate reference-number rejection with honest message.
- Money: NUMERIC(12,2) throughout (Phase 8A); pg-money suite 8/8 (H1).
- Residual (P3): max+1 mint comment stale; theoretical P2002 retry polish.
