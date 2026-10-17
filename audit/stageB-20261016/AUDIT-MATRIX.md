# Super Admin Functional Audit Matrix — Final Quality Gate (2026-10-16)

**Code verified:** `feat/super-admin-schools-management` — two distinct evidence layers, cited per SHA:

- **`46e26fa`** — the functional browser audit (this matrix's screenshots 03–18 + the local live walkthrough on the seeded corpus; the 7ec259f session-gate evidence 05–07 is its direct parent).
- **`71ec088`** (current head) — service hardening only: `mini-services/postgres-db` env resolution (worktree `.env` first, SQLite-shaped main `.env` skipped) + 4-case unit regression. **No browser surface changed** in this commit, so the 46e26fa browser evidence carries forward; the new logic is covered by `tests/unit/pg-service-env-resolution.test.ts` (4/4 in CI) plus the live post-reset runtime (service up on the SQLite-clobbered main `.env`).

**Key:** PASS = verified with evidence · BLOCKED = environment prevented verification · NOT TESTED = no local/browser coverage (cite what covers it in CI).

**CI (verified per exact SHA, not substituted):**

| SHA | Run | Result | Suite counts |
|---|---|---|---|
| `46e26fa` | [38879255718](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/38879255718) | all 21 executed steps success (only the failure-only log-tail debug step skipped) | full suite + e2e green |
| `71ec088` | [38903993033](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/38903993033) | all 21 executed steps success (only the failure-only log-tail debug step skipped) | **1380 pass / 36 skip / 0 fail** + e2e **32 pass / 0 fail** (skips = env-gated live-credential tests, by design) |

**Vercel previews (verified per exact SHA):**

| SHA | scholario-app | scholario-platform |
|---|---|---|
| `46e26fa` | `dpl_A3E9…` READY | `dpl_5R5C…` READY |
| `71ec088` | `dpl_4dHK…` READY — `scholario-kojvjx4hq-…` | `dpl_G594…` READY — `scholario-platform-61v445r9g-…` |

Both head previews probe **HTTP 302 → vercel.com/sso-api** — SSO-protected, so app-level smoke checks are **blocked** (deployment status alone is never cited as app health).

## Authentication & session

| Function | Result | Evidence |
|---|---|---|
| Platform login (valid credentials) | **PASS** | API 200 + token persisted + console reachable; browser screenshots 11 |
| Login password eye toggle (both planes) | **PASS** | Value retained across toggle; aria-label flips; platform + school doors (08) |
| Login failure states (rate limits, account lock) | **PASS** (suite) | dev.log: 401 `credential mismatch` classified; login rate-limit contract text on the door; rate-limit suites green in CI |
| Sign-out | **PASS** | Token cleared; console content gated (login screen rendered for unauthenticated /platform/settings) |
| Session expiry | **PASS** (suite) | auth-sessions + platform-account-recovery suites (CI green); My Sessions page shows live session + revoke |
| Unavailable-database recovery | **PASS** | Reproduced + fixed (7ec259f): explicit "Control plane unavailable" + Retry; browser-verified down→recover (05–07) |
| Login→redirect latency (dev only) | **OBSERVATION** | Client router transition lands slowly under dev-mode HMR churn; completes; not present in production builds (no HMR). Not a defect. |

## Overview

| Function | Result | Evidence |
|---|---|---|
| Metrics (total/active/suspended/needs-attention) | **PASS** | Real DB values (2/2/0/0); screenshot 11; overview API 200 |
| Needs-attention links | **PASS** | "View schools" + next-actions list in school workspace deep-links to fixable sections |
| Recent activity (audit feed) | **PASS** | Live audit rows on Overview |

## Schools directory

| Function | Result | Evidence |
|---|---|---|
| Search (name/slug/code) | **PASS** | "green"→Green Valley only; "haw"→Hawkings only (12) |
| Filter popover (status/plan/subscription/billing/readiness) | **PASS** | Dialog with 5 dimensions, collapsed by default (12) |
| Sort + pagination controls | **PASS** | Sort combobox; prev/next disabled correctly at 1 page |
| Refresh + error recovery | **PASS** | Refresh preserves results; DB-down → typed error state (05–07) |
| Add-school wizard (4 steps) | **PASS** | Step-1 validation: "School name is required (2+ characters)"; close = no side effects |
| Duplicate submission / timeout recovery | **PASS** (suite) | provisioning-reliability suite (176/176 re-run green locally; CI green) |

## School workspace

| Function | Result | Evidence |
|---|---|---|
| Six-section tab structure + `?tab=` deep links | **PASS** | Overview/Configuration/Access & users/Subscription/Support & audit/Advanced; `?tab=subscription` & `?tab=advanced` verified |
| Configuration: setup readiness, metadata, identity, modules, domains | **PASS** | Setup-readiness progress (40% required, honest zero-state text); editable audited metadata; domains/identity modules present (04) |
| Access & users | **PASS** | Users tab renders; credential reset covered by credential-reset suite (green) |
| Subscription sub-tabs (snapshot/plan/codes/students/ledger) + fee gateway separation | **PASS** | Sub-tab list verified; gateway in its own region (invariant: platform subscription ≠ fee gateway) |
| Suspend / reactivate lifecycle | **PASS** | Reason-required dialog; DB-verified SUSPENDED→ACTIVE round-trip (14) |
| Support & audit sections | **PASS** (suite) | support-session + audit suites green; pages verified below |
| Advanced (danger zone) | **PASS** | "Danger zone" framing + Suspend action (13) |

## Subscriptions

| Function | Result | Evidence |
|---|---|---|
| Registry (school/plan/status/validity/payments/actions) | **PASS** | Live table with 2 subscriptions (03) |
| Stats (active/expiring/expired/needs review) | **PASS** | 2/0/0/0 from real data |
| Student entitlements (focused workflow + school picker) | **PASS** | Picker loads; honest "No students match" empty state (15) |
| Plans & commercial models (focused workflow) | **PASS** | Registry + model toggles view (16) |
| Schema-pending compatibility | **PASS** (suite) | core-surfaces + subscription-schema-pending suites: 41/41 focused; CI green |
| Activation codes / webhook integrity / payment reconciliation | **PASS** (suite) | fee-gateway 12/12 + subscription-entitlement 7/7 + saas-hardening 1/1 after env parity (176/176 combined re-run) |

## Administration

| Function | Result | Evidence |
|---|---|---|
| Support page (reason-required, read-only sessions) | **PASS** | Contract text verified; suites green |
| Audit log page | **PASS** | Append-only framing; live rows |
| Settings | **PASS** | Renders fully once loaded (18); API 200; transient unlabeled compile window noted as polish-only |
| Announcements | **PASS** | Compose/publish/expiry UI (17) |
| Platform admins (Users) | **PASS** | Step-up-gated, audited framing; table renders (17) |
| My Sessions | **PASS** | Current session with device info + revoke (17) |

## Cross-cutting

| Item | Result | Evidence |
|---|---|---|
| Responsive 390/820 (no horizontal overflow) | **PASS** | scrollWidth == clientWidth at both widths (09/10) |
| Error boundaries + fail-closed APIs | **PASS** | Route error boundary (607c928 lineage); AUTH_REQUIRED on unauthenticated platform APIs |
| Plane isolation (previews) | **PASS** (infra) + **BLOCKED** (app-level) | Both Vercel planes deployed success at `46e26fa` **and** at `71ec088` (per-SHA deployment IDs above; each probe 302→Vercel SSO) → app-level probing blocked; local unified plane verified; plane-architecture suite green |
| Production safety | **PASS** | Zero production mutations; no main pushes; no merges |

## Local full-suite failure classification (the 30 remaining after clean-DB re-run)

> **Transparency note:** the local focused re-runs (176/176) prove the 30 classified cases pass in isolation — they do **not** by themselves prove the full local suite is clean end-to-end. The authoritative full-suite green is the clean-environment CI run on the exact head (`71ec088`): **1380 pass / 36 skip / 0 fail**. The residual local-only failures are classified below.

| Class | Count | Files | Resolution |
|---|---|---|
| Dev-server fixture-env parity (server lacked CI's fake OAuth/Razorpay/sandbox/webhook env) | 27 | fee-gateway (12), subscription-entitlement (7), platform-account-recovery (7), saas-hardening (1) | Dev server restarted WITH CI fixture env → **all pass focused (176/176)**; same suites green in CI full run |
| Restart-window / cold-compile timeout (documented CI flake class) | 3 | provisioning-reliability (2 ECONNRESET), credential-reset (1 hook timeout) | Pass focused under parity; CI supervisor handles the class (0 such failures in CI run 38903993033) |
| Shared-state contamination (long-lived corpus) | 79 of the original 109 | various | Fresh reset + reseed removed them (109 → 30) |
| **Genuine product regressions** | **0** | — | — |

Cleanup after failed/interrupted tests: suites are marker-scoped; the one hook-timeout case (credential-reset) re-passed focused including its migration-invariant test; corpus is dev-only and reseedable.
