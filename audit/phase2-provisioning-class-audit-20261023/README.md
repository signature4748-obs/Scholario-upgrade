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

---

# FINAL-REVIEW FOLLOW-UP (2026-10-23, PR #57 @ 74f9e43 → follow-up commit on the same branch)

Reviewer-requested battery for unusual/custom class names + full-diff inspection. Outcome:

- **One real defect found and fixed (smallest scoped, same canonical mapper): D1a** — number-bearing pre-primary names (`"Nursery 2"`) parsed as academic grades and could merge with the real `"Class 2"`; now the pre-primary regex is consulted BEFORE the number parse (the allocation picker's own ordering). Rule 1 (valid stored grade wins) untouched and pinned.
- The battery grew **21 → 39 tests** (red 4/39 pre-correction — exactly the D1a family → green 39/0 post); unit suite 295/0, integration 49/0, regression 178/0, typecheck 0, lint 0e/57w, repro-mapper A–K,X,Y unchanged.
- Documented ambiguities (NOT guessed): `"Class 0"` level; mixed-data group label follows first row; empty/whitespace names are API-FORBIDDEN (defensive no-crash pin only). ~~Year-in-name (`Batch 2026`) accepted edge~~ → **RESOLVED by the same-day final behaviour refinement** (below).
- Details: `CLASS-GROUPING-POLICY.md` §7, `DEFECTS.md` (D1a + unresolved decisions), `REPRODUCTION-RESULTS.md` (follow-up matrix), `TEST-RESULTS.md` §8–§11.

**Final behaviour refinement (2026-10-23, owner directive, PR #57):** the name→grade parse in the canonical mapper is now PATTERN-ANCHORED (keyword `Class|Grade|Std|Standard` / section-first `6-A` / pure 1–2-digit number) — incidental numbers are never grades. `"Batch 2026"`, `"Room 12"`, `"Group 3"`, `"2026"`, `"Classroom 5"` → their own NAMED groups, never G2026/G12/G3/G5; `"Std 8"`, `"6-A"`, `"6"` → correct academic grades. Battery 39 → **49 tests** (red 9 against the old parse → green 49/0; unit 305/0, integration 49/0, regression 178/0, typecheck 0, lint 0e/57w; wizard/corpus evidence byte-identical). No hard 1–12 cap; rule 1 (stored grade wins) and pre-primary-first ordering untouched. Details: `CLASS-GROUPING-POLICY.md` §8, `REPRODUCTION-RESULTS.md` (refinement matrix), `TEST-RESULTS.md` §12.
