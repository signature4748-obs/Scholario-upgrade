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
