# PHASE 2/9 — SCHOOL PROVISIONING & CLASS CONFIGURATION AUDIT (pack index)

Date: 2026-10-22/23 · Repo: `signature4748-obs/Scholario-upgrade` · Branch: `fix/phase2-class-grouping-d1` (from `main @ 7585fad`, verified clean before work) · Phase 1 handoff: `audit/phase1-reconnaissance-20261022/` (read in full, not modified).

Mission: audit the complete school-creation and class/section configuration workflow, reproduce the confirmed Grade-0 grouping defect before proposing the smallest safe fix, then implement it test-first. **No production data was read or written; no production query of any kind was issued this phase.** All live evidence used throwaway tenants on the local embedded database (teardown verified).

## Contents

| File | Deliverable |
|---|---|
| `PROVISIONING-TRACE.md` | the full UI→API→DB→display path with exact files/functions/lines: wizard steps/defaults/validation, payload shape (secrets redacted), provision schema/auth/transaction/idempotency, Class bootstrap, model constraints, all class-creation paths, repeated-submission safety |
| `CLASS-GROUPING-POLICY.md` | STEP D: implementation census (canonical mapper + 53 consumers), source-of-truth rules, case table, backward-compat analysis, rejected alternatives |
| `REPRODUCTION-RESULTS.md` | STEP C matrix (cases A–K + probes X/Y) at three evidence levels (deterministic mapper, live API, live UI), pre/post-fix, with the honest environment record (one OOM restart; one 429 retry) |
| `TEST-RESULTS.md` | STEP F: every command, exit code and count; new 21-test battery red→green; all targeted suites green; environment failures separated from product signal; security/tenant-isolation notes |
| `DEFECTS.md` | ledger update: **D1 FIXED (branch pending merge)**, D2–D5 carried, new observations D6 (display order) + D7 (`''` write-path hygiene), picker-regex note |
| `PHASE3-PLAN.md` | prioritized next steps: land D1 → small hygiene PRs → UI walks → sweeps → ledger close |
| `repro-mapper.ts` / `repro-live.ts` | the two evidence generators (pure-function and live-API repro; safe by construction, throwaway tenants only) |
| `evidence-repro-mapper-PRE-FIX/-POSTFIX.txt`, `evidence-repro-live-PRE-FIX/-POSTFIX.txt` | captured outputs (exact inputs → persisted rows → API responses → mapped groups) |
| `ui-01…ui-05*.png` | browser evidence: the pre-fix “Grade 0 · 12 sections” card + detail, the post-fix 12 named cards + “Class 6” detail, and the OOM-restart window capture |

## One-line outcome

The provisioning path is **correct** (payload, dedupe, idempotency, atomicity, persisted rows all verified); the reported “Class 0 / excessive sections” was a **display-layer grouping defect** (D1), reproduced at three levels pre-fix and verified fixed post-fix with a 21-test regression battery and all targeted suites green — the smallest compatible change, in the ONE canonical mapper, no write-path or production changes.
