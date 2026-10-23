# PHASE 2/9 — TEST-RESULTS (validation commands, exit codes, counts)

Environment: local sandbox 4 GB box · embedded PG 18.4 (:5432, `scholario` db) · supervised dev server (:3000, `DEV_OLD_SPACE_MB=1700`, CI-parity fixture env exported into both the server and the test processes — `RATE_LIMIT_DB_SYNC=on`, `PAYMENTS_SANDBOX=1`, fixture secrets per ci.yml) · tree = `main @ 7585fad` + this phase's scoped changes.

Legend: pre-fix = before the mapper change (evidence for the failing behavior); post-fix = after. Baseline = Phase 1 BASELINE §6 counts on the same box.

## 1. New regression battery (test-first, canonical mapper)

`tests/unit/students-store-class-grouping.test.ts` (NEW — 21 tests / 147 expect calls) covering: the confirmed wizard payload, custom rows, subset presets, multi-section, empty-section bootstrap, streams on name-derived groups, pre-primary names (incl. legacy IKG), arbitrary names, case-variant merging, the three alternate class-creation write-path shapes (`''`, publish label, explicit '0'), valid-grade compat (demo corpus, stored-grade-wins, stream suffixes, mixed corpora, empty universe), and the student-record consumer contract.

| Command | When | Exit | Count |
|---|---|---|---|
| `bun test tests/unit/students-store-class-grouping.test.ts` | **pre-fix** | 0 (report) | **3 pass / 17 fail** ← red confirms the failing behavior is pinned |
| same | **post-fix** | 0 | **21 pass / 0 fail** ← green |

## 2. Repo gates (post-fix)

| # | Command | Exit | Result | Baseline comparison |
|---|---|---|---|---|
| 1 | `bun run typecheck` (tsc --noEmit) | **0** | clean | baseline clean |
| 2 | `bun run lint` (eslint .) | **0** | **0 errors / 57 warnings** | identical to baseline (react-hooks/exhaustive-deps class; 0-error gate) |
| 3 | `bun run test:unit` | **0** | **277 pass / 0 fail** (24 files, 982 expects) | baseline 256/0 (23 files) + **exactly the 21 new tests**, zero regressions |
| 4 | `bun run test:integration` | **0** | **49 pass / 0 fail** (2 files) | identical to baseline |
| 5 | `bun run test:regression` | **0** | **178 pass / 0 fail** (9 files) | identical to baseline |

## 3. Live-HTTP provisioning/roster suites (post-fix; CI-parity env; dev server up)

| # | Command | Exit | Result | Notes |
|---|---|---|---|---|
| 6 | `bun test --timeout 45000 tests/api/school-onboarding-wizard.test.ts` (first run) | 0 (report) | 17 pass / **1 fail** | the 1 fail = **HTTP 429** on the shared `platformMutation` (60/min) limiter — my earlier same-session repro provisions consumed the bucket (transport/environment class, same family as Phase 1 §6; the failing tests re-provisioned successfully in the retry) |
| 7 | same, **re-run ONCE after the 60 s window expired** (corrected verified environmental cause) | **0** | **18 pass / 0 fail** (115 expects) | provisioning contract fully intact post-fix |
| 8 | `bun test --timeout 45000 tests/api/school-setup-readiness.test.ts tests/api/empty-school.test.ts` | **0** | **15 pass / 0 fail** (90 expects) | roster-surface suites on a clean school (the honest-empty path) |
| 9 | `bun test --timeout 45000 tests/api/schools-management-overhaul.test.ts` | **0** | **11 pass / 0 fail** (50 expects) | includes the directory sort row (D2) — green on the clean corpus, as documented |

## 4. Reproduction scripts (evidence generators, this directory)

| Command | Pre-fix | Post-fix |
|---|---|---|
| `bun run audit/phase2-…/repro-mapper.ts` | cases A–E,G,I1,I2,K(pre-primary),Y all “Grade 0” merges; J/X controls pass (evidence-repro-mapper-PRE-FIX.txt) | all cases corrected; controls unchanged (evidence-repro-mapper-POSTFIX.txt) |
| `source scripts/dev-env.sh && bun run audit/phase2-…/repro-live.ts` | live chain FAIL confirmed incl. Add-Class `''` path (13-section Grade 0) and demo trio merge (evidence-repro-live-PRE-FIX.txt) | live chain PASS (evidence-repro-live-POSTFIX.txt) |

## 5. Environment failures (recorded, not misclassified)

1. **Kernel OOM of the dev server once, mid-UI-walk** (dmesg `next-server anon-rss 3.2 GB`; the box's documented 4 GB class). Recovered via the supervision loop after ONE restart; the interrupted in-flight provision had committed correctly. UI walk then completed pre- and post-fix. `ui-01-mid-oom-restart-window.png` + DOM snapshot captured.
2. **429 rate-limit on the wizard suite's first run** (shared `platformMutation` bucket consumed by this session's own earlier provisioning evidence runs). Corrected by waiting out the 60 s window; single permitted re-run → green. Recorded, not counted as a product failure (the identical tree passes in CI — Phase 1 run 39810762044 for the base, plus the retry here).
3. **E2E journeys: not run** (documented box limitation — Phase 1 §6; CI covers them). No retry loops attempted.

## 6. Security / tenant-isolation checks performed this phase

- All writes went to uniquely-named throwaway tenants on the LOCAL database; every run's teardown verified the school census returned to exactly the 2 seed tenants.
- The demo tenants (Hawkings/Green Valley) were only ever read (SELECT/roster GET); no mutation of seeded data.
- Platform API calls used the repo's established test convention (stepped-up root session minted as a DB fixture — the auth fixture bypasses only the login door; every server-side permission/step-up check still ran).
- School-plane principal sessions used the REAL flows: bootstrap credential → forced password change → real login with the principal's own new password (business APIs stay behind the PASSWORD_CHANGE_REQUIRED gate until the change completes — verified when a fixture session without the change was refused 403).
- No credential, token, cookie or secret value appears in any artifact in this pack (the wizard payload section of PROVISIONING-TRACE.md redacts the principal password by design; temp passwords of throwaway local tenants were never written into committed evidence).
- `bun run lint` + typecheck green — no stray debugging code in the diff; `git status` diff reviewed: only server-sync.ts, the new test file, and this audit pack.
- Cross-tenant isolation was not re-probed this phase (Phase 1's 57-case battery stands; no API authorization code was touched by the fix — the change is a pure client-side mapping function with unit tests).

## 7. Totals executed this phase

- New tests: 21 (all passing post-fix) · Unit: 277/0 · Integration: 49/0 · Regression: 178/0 · Wizard live API: 18/0 · Readiness+empty-school: 15/0 · Overhaul: 11/0 · typecheck 0 · lint 0 errors.
- Every count above was executed and recorded this session; nothing is inferred from CI runs.

---

# FINAL-REVIEW FOLLOW-UP (2026-10-23, PR #57 @ 74f9e43 — added on the same branch)

Scope: unusual/custom class-name battery + full-diff inspection + one smallest-scoped correction (D1a, below). No merge, no deploy, no production touch.

## 8. Follow-up battery: `tests/unit/students-store-class-grouping.test.ts` grew 21 → 39 tests

New describe blocks 6–8 pin: **"Batch 2026"** (year-in-name edge, isolated `G2026`), **"Nursery 2"** (pre-primary-first — see D1a), **"Grade 9 - A"** (publish shape; correct same-grade merge with "Class 9"), **"Class 0"** (named group `N:class 0`, never synthetic "Grade 0"), **"Class 01"** (zero-padding → G1; cross-path merge with stored-"1" rows), **empty/whitespace names** (API-forbidden on all three write paths — defensive no-crash pin), the **mixed-data case** (valid stored '6' + NULL "Class 6" → ONE G6 group, both orders, students on both rows), and the **student-resolution invariant** (every student's classId resolves to a real grouped ClassRecord whose name === className, across the whole unusual-name corpus).

| Command | When | Exit | Count |
|---|---|---|---|
| `bun test tests/unit/students-store-class-grouping.test.ts` | **pre-correction** | 0 (report) | **35 pass / 4 fail** ← the 4 reds are EXACTLY the number-bearing pre-primary family (D1a), all other new cases green |
| same | **post-correction** | **0** | **39 pass / 0 fail** (275 expects) |

## 9. Follow-up gates (post-correction, same session)

| # | Command | Exit | Result | Baseline comparison |
|---|---|---|---|---|
| 10 | `bun run typecheck` | **0** | clean | identical |
| 11 | `bun run lint` | **0** | 0 errors / 57 warnings | identical (baseline warning class only) |
| 12 | `bun run test:unit` | **0** | **295 pass / 0 fail** (24 files, 1,110 expects) | prior 277/0 + **exactly the 18 new tests**, zero regressions |
| 13 | `source scripts/dev-env.sh && bun run test:integration` | **0** | **49 pass / 0 fail** | identical |
| 14 | `source scripts/dev-env.sh && bun run test:regression` | **0** | **178 pass / 0 fail** | identical |
| 15 | `bun run audit/…/repro-mapper.ts` | **0** | cases A–F,G,I1,I2,J,K,X,Y **all identical to the committed POSTFIX evidence** | the D1a correction changed only the number-bearing pre-primary sub-family (not covered by A–K); no prior confirmed behavior disturbed |

## 10. Follow-up environment note (recorded, not misclassified)

- `bun run test:integration` **without** `source scripts/dev-env.sh` (first attempt): 29 tests ran, 18 failed with `PrismaClientInitializationError: the URL must start with postgresql://` — the documented sandbox shell-injection class (scripts/dev-env.sh header: ambient `DATABASE_URL=<sqlite template>` clobbers tool shells). Pure environment cause, corrected by the documented sourcing convention; single re-run → 49/0. Not counted as a product failure; no code relation (failures were auth-identity suites, untouched by this diff).
- Live-HTTP wizard suites were NOT re-run this follow-up: the mapper change is client-side only and the provisioning API contract was already verified intact (§3); CI on the branch re-runs them.

## 11. Follow-up security checks

- Secret-pattern sweep of the full PR diff + audit pack (`password|token|secret|bearer|ghp_|sbp_|vcp_|re_…`): every match is a conceptual reference, a redaction marker, or runtime token-handling code — **no credential value anywhere** (verified again this session on 74f9e43 + the follow-up commit).
- `git diff origin/main...HEAD --stat` re-inspected: src changes remain confined to `src/lib/store/students-store/server-sync.ts` + `tests/unit/students-store-class-grouping.test.ts` + this audit pack. No unrelated edits.

---

## 12. FINAL BEHAVIOUR REFINEMENT (2026-10-23, PR #57) — pattern-anchored name→grade parse

**Owner directive:** incidental numbers in class names are never academic grades (`"Batch 2026"` ≠ G2026, `"Room 12"` must not merge into G12, `"Group 3"` must not merge into G3). Smallest scoped change: `gradeFromClassName` (canonical mapper only) is now pattern-anchored — keyword-anchored `Class|Grade|Std|Standard` (whole word), section-first `6-A`, pure 1–2-digit number. No hard 1–12 cap (non-matching names fall to their own named group — collision-free by construction). Rule 1 (valid stored grade) untouched; pre-primary-first ordering (§9) untouched.

**Red-green proof (exact commands + counts, output preserved in session):**

- `bun test tests/unit/students-store-class-grouping.test.ts` — **RED, pre-refinement implementation**: `40 pass / 9 fail / 295 expect() calls, 49 tests`. The 9 failures, verbatim from output: Batch 2026 named-group, Batch 2026 collision guard, two year-named batches, Room 12 collision, Group 3 collision, two custom names (Batch vs Diploma), Classroom 5 word-boundary, year "2026" alone, corpus Batch-student resolution — exactly the incidental-number family.
- After the one-function change (+ one capture-group slip found by the run and fixed): **GREEN** — `49 pass / 0 fail / 333 expect() calls, 49 tests`.

**Gates re-run post-refinement (exact commands + counts):**

| Check | Command | Result | Baseline parity |
|---|---|---|---|
| Focused battery | `bun test tests/unit/students-store-class-grouping.test.ts` | 49 pass / 0 fail (333 expect) | new battery 21→39→49 |
| Typecheck | `bun run typecheck` | 0 errors (exit 0) | ✓ |
| Lint | `bun run lint` | 0 errors / 57 warnings (exit 0) | ✓ 57 = recorded baseline |
| Unit | `bun run test:unit` | 305 pass / 0 fail (1168 expect, 24 files) | ✓ 295 baseline + 10 new tests |
| Integration | `source scripts/dev-env.sh && bun run test:integration` | 49 pass / 0 fail (133 expect) | ✓ baseline parity |
| Regression | `source scripts/dev-env.sh && bun run test:regression` | 178 pass / 0 fail (712 expect) | ✓ baseline parity |
| Wizard/corpus evidence | `bun run audit/…/repro-mapper.ts` → diff vs `evidence-repro-mapper-POSTFIX.txt` | **BYTE-IDENTICAL** | ✓ A–K,X,Y unchanged |

**No new type errors, no new lint errors, no new suite failures; no baseline relabelling.** The `bun run test` full battery (incl. api/security) + E2E runs in CI on the PR head — the merge gate requires that green on the exact head SHA.

**Secret sweep + diff confinement re-verified post-refinement:** src changes confined to `server-sync.ts` (one function + comments) + the test battery + this audit pack; no unrelated modules, no DB schema, no migrations, no production records.
