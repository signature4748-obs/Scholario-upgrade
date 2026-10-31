# PHASE 1 — INDEPENDENT SECURITY & ARCHITECTURE REVIEW

**PR #69 — Super Admin Control Center Foundation (Overview | Setup | Manage)**

| Field | Value |
|---|---|
| Repository | `signature4748-obs/Scholario-upgrade` |
| PR | [#69](https://github.com/signature4748-obs/Scholario-upgrade/pull/69) — `feat(super-admin): Phase 1 — School Control Center foundation (Overview | Setup | Manage)` |
| Branch | `feat/super-admin-control-center-phase1` |
| Reviewed head SHA | `6b25ed0c8b8f40b1f21c70ff082887d39833031b` (exactly 1 commit: `6b25ed0`) |
| Base SHA | `e8aca3973f066a4f532e0466bbdaaef1a8392c4a` (= current `main` head = PR #68 merge commit) |
| PR state at review time | OPEN · not draft · not merged · `mergeable: true` · `mergeable_state: clean` · 0 commits behind base |
| Diff size | 8 files, +911 / −166 |
| Review date | 2026-10-31 (UTC) |
| Reviewer | Independent (separate session from the implementing session; no shared state) |
| Review mode | REVIEW-ONLY. No code edits, commits, pushes, merges, deployments, or DB writes were performed. (Two read-only `SELECT` queries against the production Postgres were used to verify a permission question in §6/Finding 1; no state was changed.) |

---

## VERDICT (summary first)

**APPROVE WITH NON-BLOCKING OBSERVATIONS.**

No P0/P1/P2 findings. Phase 1 is a genuinely safe, presentational regroup: server-side authorization is untouched, no schema/API/contract changes, every historical deep link resolves, the Overview dashboard is backed by the same DB-computed readiness engine the Setup panel uses, and the architecture document matches the codebase with unusual precision (every spot-checked number was exact). Four P3 observations and several INFO notes are documented below; none block merging, and each has a concrete recommended fix.

---

## 1. Verified GitHub state (live evidence)

Retrieved independently via the GitHub REST API at review time.

**PR metadata (GET /pulls/69):**

- `state: open`, `merged: false`, `draft: false`
- `head.ref: feat/super-admin-control-center-phase1`, `head.sha: 6b25ed0c8b8f…`
- `base.ref: main`, `base.sha: e8aca3973f06…`
- `mergeable: true`, `mergeable_state: clean`
- `commits: 1`, `changed_files: 8`, `additions: 911`, `deletions: 166`
- Base is **identical** to the current `main` head (`GET /compare/e8aca39...main` → `identical`, ahead 0 / behind 0), and `GET /compare/e8aca39...6b25ed0` → `ahead: 1, behind: 0`. The PR is exactly one commit on top of the PR #68 merge commit. PR #68 itself is confirmed **merged** (`merged: true`, merge commit `e8aca3973f06`).

**Changed files (all 8, complete list):**

| Status | File | +/− |
|---|---|---|
| added | `docs/super-admin-transformation/PHASE-1-ARCHITECTURE.md` | +297 |
| added | `docs/super-admin-transformation/PHASE-1-IMPLEMENTATION.md` | +52 |
| added | `src/app/platform/(console)/schools/[id]/manage/page.tsx` | +20 |
| added | `src/app/platform/(console)/schools/[id]/overview/page.tsx` | +17 |
| added | `src/app/platform/(console)/schools/[id]/setup/page.tsx` | +20 |
| added | `src/components/platform/modules/school-detail-tabs.ts` | +110 |
| modified | `src/components/platform/modules/school-detail.tsx` | +219/−166 |
| added | `tests/unit/school-control-center-tabs.test.ts` | +176 |

Single commit `6b25ed0` (author date 2026-10-31, signature: `verified: False` — normal for this repo's workflow; every prior PR in this repository commits the same way).

**CI — run [41170178241](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/41170178241) (`CI`, event `pull_request`, head_branch `feat/super-admin-control-center-phase1`, head_sha `6b25ed0c8b8f…` — the exact reviewed head):**

- **Attempt 2** (2026-10-31T04:50:30Z → completed 05:20:40Z): `conclusion: success`. Job `Typecheck · Lint · Migrations · Build · Tests`: steps 1–17 all `success` (typecheck, lint, migration deploy to fresh CI Postgres, schema drift gate, production build, seeds, dev server, test suite, E2E). Step 18 `Dev server log tail (on failure)` is `skipped` (it only runs on failure). Post-job cleanup steps `success`. So "22/22 green" is accurate in substance: 21 steps `success`, 1 failure-only diagnostic `skipped`, nothing failed. Note the workflow exposes **one** job, so the "22 steps" count matches the job's step list, not 22 separate jobs.
- **Attempt 1** (same run id, same head SHA): `conclusion: failure` at **step 15 — Test suite (unit · integration · API · regression · security)**. Full job log downloaded and analyzed (see §9.1). E2E steps were skipped as a consequence.
- Attempt URLs share the run URL; attempts are queryable at `…/actions/runs/41170178241/attempts/1` and `/attempts/2`.

**Conclusion:** the CI evidence corresponds to the exact reviewed head. No head/SHA mismatch — the review proceeds.

---

## 2. Navigation architecture review

The intended IA — three primary destinations `Overview | Setup | Manage` — is implemented as a **tab-surface regroup inside the existing workspace**, not a route-tree rewrite:

```
/platform/schools/[id]                ← existing workspace page (unchanged contract)
  ?tab=overview | setup | manage      ← canonical keys (three Radix Tabs)
/platform/schools/[id]/overview       ← NEW: server redirect → workspace default
/platform/schools/[id]/setup          ← NEW: server redirect → ?tab=setup
/platform/schools/[id]/manage         ← NEW: server redirect → ?tab=manage
```

### 2.1 What was verified

1. **Tab resolution data is now a pure, unit-tested module** (`school-detail-tabs.ts`): `CONTROL_CENTER_GROUPS`, `SUBSECTION_IDS` (12 anchor ids), `LEGACY_TAB_REDIRECT` (22 keys), `resolveTabValue`, `availableControlCenterGroups`. No React imports; imported by `school-detail.tsx` only.
2. **URL → state effect** (`school-detail.tsx:1575-1589`): `?tab=` remains the single source of truth; unknown/permission-withheld values fail safe to `overview`; legacy values are normalized to the canonical key via `router.replace` (URL "healing"), preserving all other query params (verified: `new URLSearchParams(searchParams)` copy — `sub=`, `&fp=` etc. survive). Byte-compared against the base file: this effect is unchanged from §7 except the comment text.
3. **Echo suppression** (`lastWrittenTab` ref): present in base, byte-identical in the PR. Its one edge case (BACK then FORWARD can leave the UI on Overview while the URL reads `?tab=setup`) is **pre-existing §7 behavior, not introduced here** — see INFO-1.
4. **Anchor resolution** (`:1596-1620`): retries ~4 s for late-mounted content, then drops quietly (permission-withheld sub-section still lands on the destination top). All 12 `SUBSECTION_IDS` anchors verified to exist in the rendered tree: 10 via `GroupSection id={SUBSECTION_IDS.*}` in `school-detail.tsx` (lines 2318–2835), 2 rendered by `support-audit.tsx` (`section-support`:571, `section-audit`:843).
5. **The three new routes** are 17–20-LOC server components that call `redirect()` only — no data fetch, no auth logic of their own, `encodeURIComponent(id)` on the param. They inherit the `(console)` layout chain and the middleware page boundary. They cannot create an alternate access path (§5).
6. **Active state**: Radix `Tabs value={activeGroup}` + `TabsTrigger` per destination; `Manage` trigger rendered only when `availableGroups` contains it; Radix provides `aria-selected` + roving focus. No duplicate or conflicting navigation was added; the platform sidebar (`console-shell.tsx`) was **not** modified.
7. **Refresh / direct nav / back-forward**: refresh and direct navigation re-run the URL→state effect (verified logic); back/forward handled by the same effect except the pre-existing echo edge (INFO-1). `navigateToTab` writes the URL with `router.push` and scrolls to content top for plain group switches.
8. **Nothing disappeared** — full content mapping verified (§4).

### 2.2 Navigation verdict

The implementation matches the intended architecture. Existing URLs resolve, legacy `?tab=` links are not broken (§6), the new routes resolve correctly and cannot redirect into an empty state (they land on the same protected workspace), and active-state/keyboard behavior comes from the pre-existing Radix pattern.

---

## 3. Overview data integrity

The new Overview adds exactly one component: `SetupModulesCard` (`school-detail.tsx:1396-1506`), rendering two read-only summaries.

**Setup completion** — sourced from `data.provisioning?.readiness` (`:2229`), which the dossier `GET /api/platform/schools/[id]` (`route.ts:202-217`) fills from `computeSetupReadiness(school.id)` — **the same engine** (`src/lib/school/setup-readiness.ts`) the Setup destination's own `setup-readiness` API serves. Verified properties:

- `requiredTotal` = 5 required sections (identity, principal, academic, people, fees); `requiredDone` = completed count; `requiredComplete` = equality; `usable = status === 'ACTIVE' && requiredComplete` (`setup-readiness.ts:226-240`).
- Every section is computed from **live DB counts** (11 batched `db.*.count({ where: { schoolId } })` + school column presence) — never client-reported, never fabricated. A zero-progress school honestly shows zero; the `PENDING` case is explicitly guarded ("PENDING schools are not usable regardless of content").
- **No mock or hardcoded school data anywhere in the chain.** The card's null path (`readiness === null`) renders "Setup status unavailable — open Setup to load the readiness document" — honest degradation, no fabrication.
- Header badges (`PROVISIONING_META`) and `NextActionsCard` continue to render only from `data.provisioning` (null → renders nothing).

**Modules summary** — sourced from `flags`, which is synced from `data.school.featureFlags` (`:1727`, the raw school override map serialized at `route.ts:164`). It displays `override ?? true` per module with an explicit provenance suffix ("· school override" / "· platform default"). See Finding 2 for the resolution-fidelity caveat.

**States verified in code:** loading skeleton (`:1905`, `loading && !data`), honest not-found (`:1922`), error + retry (`:1942`), and `reload()` re-fetches the dossier fresh from the API on every mount/retry (`:1681-1698`) — no client cache layer, no stale-summary mechanism beyond a single render pass. "Ready/active" claims are not overstated: `usable` requires actual `ACTIVE` status, and the card never claims a school is active on its own.

One **copy-accuracy defect** exists in the new card (Finding 3): for a `PENDING`/`TRIAL` school whose required sections are all complete, the badge says "Complete" while the paragraph below says "Required onboarding sections are still incomplete" — internally contradictory and factually wrong about the sections (the blocker is lifecycle, not setup). Display-only.

---

## 4. Setup / Manage separation

| Destination | Contains (all verified rendered) | First-time vs ongoing |
|---|---|---|
| **Overview** | `NextActionsCard`, **new** `SetupModulesCard`, school profile (read-only), recent activity | read-only dashboard |
| **Setup** | `section-setup` Setup & readiness · `section-metadata` profile & metadata · `section-modules` module availability + admissions flag · `section-identity` identity & branding (+ change requests) · `section-domains` custom domains | first-time configuration + identity governance |
| **Manage** | `section-access` Access & sign-in (doors, principal credential, live sessions; `StudentAccessCard` canManage-gated) · `section-users` read-only roster · `section-subscription` + `section-gateway` (canBill) · `SupportAuditTab` (canSupport‖canAudit) · danger zone (canManage) | ongoing operation & oversight |

- Every §7 group survived the regroup (Configuration→Setup; Access→Manage; Subscription→Manage; Support & audit→Manage; Advanced→Manage). All five §7 sub-section content blocks and their permission conditionals (`canBill`, `canSupport||canAudit`, `canManage`) are preserved verbatim — verified in the diff and in the rendered tree.
- **No duplicate controls**: the module toggles keep their single home in Setup; the Overview card is summary-only with an "Open Setup / Configure" jump link. Admissions issuance remains only in Setup. Danger zone only in Manage.
- **Honesty about placeholders**: there are **no empty route shells pretending to be features** — the three new pages are declared redirect handles ("When a later phase promotes Setup to its own route tree, only this handle changes"), and the architecture doc's §7 explicitly marks Phase 3/4 items ("not duplicated", "not present (honest)", "later phase"). Doc §8/§9 are labeled "design, not built in Phase 1". This is accurate.
- One **ownership boundary change** vs §7 is documented in Finding 1 (Manage tab visibility).

---

## 5. Security review (critical)

**Result: no new security-relevant behavior. Every hard boundary is byte-identical to base.**

1. **Server-side platform authorization unchanged**: `withPlatform`/`authorizePlatform` (`src/lib/platform/authz.ts`) — platform session → ACTIVE admin → permission set (root ⇒ all; else granted rows; unknown keys fail closed) → optional step-up (dormant only while `PLATFORM_TOTP_ENABLED≠1`, re-arms automatically) → per-admin mutation rate limit. The PR does not touch this file or any caller's policy.
2. **The workspace's own API**: `GET /api/platform/schools/[id]` keeps `withPlatform({ permission: 'schools.read' })` and re-verifies the school id against the real `School` table (fail-safe 404). No new or modified API route exists in the diff (all API dirs untouched).
3. **New routes cannot create an alternate access path**: they are redirect-only server components under the same `(console)` group. In production, `middleware.ts:292-315` redirects unauthenticated `/platform/*` page requests (including the three new paths) to `/platform/login`; `:272-290` keeps the platform API boundary cookie/token-space disjoint from school sessions; `:205-235` plane gate 404s platform pages on the school deployment. Nothing in the PR modifies `middleware.ts`. The pages fetch no data, so there is no payload to leak.
4. **No client-only authorization introduced**: the only permission logic touched is `availableControlCenterGroups` — **UI visibility only**, feeding tab rendering; every action behind it re-authorizes server-side (the component's own comment and the unchanged child conditionals confirm). "Hidden UI ≠ authorization" is respected: all destructive flows (activate/suspend/delete via `useStepUpGate`, typed confirmation, `platformAuditEvent`) are byte-identical in the diff.
5. **Tenant isolation / RLS**: no `prisma/` change, no migration, no raw SQL. RLS policies and the tenant-guard triggers are untouched. The readiness engine reads only the URL-identified school's rows (`where: { schoolId }` on every count).
6. **No sensitive data in route params or client payloads**: the redirects encode the id; no token, no secret, no cross-school identifier appears anywhere in the new code.
7. **No unauthorized write operation added**: the diff contains zero `fetch`/`platformApi` write calls; the only new interactivity is in-tab navigation and read-only display.
8. **Step-up & audit**: every `gate()` call, typed-confirmation dialog and audit hook in `school-detail.tsx` is unchanged — the diff moves JSX between containers and renames tab values only (verified hunk-by-hunk; 20 hunks reviewed).
9. **Security suites in CI on the exact head**: route-inventory 11/11, plus the full `tests/security/` battery inside the 2,099-test run — all green on attempt 2.

I additionally verified **in production (read-only SELECT)** that the platform-permission surface that interact with the new visibility gate is in the expected shape — see Finding 1.

---

## 6. Legacy compatibility

All historical `?tab=` keys resolve through `LEGACY_TAB_REDIRECT` (22 keys: 3 canonical + 5 §7 operator keys + 14 pre-§7 keys). Cross-checked against **every caller in the repo** (repository-wide grep over `src/`, `tests/`, `e2e/`):

| Caller | Emits | Resolves to | ✓ |
|---|---|---|---|
| `reports.tsx:254` | `router.push('/platform/schools/${id}?tab=subscription')` | Manage → `section-subscription` | ✓ |
| `subscriptions.tsx:235` | same `?tab=subscription` | same | ✓ |
| `school-subscription.tsx:3065` | `onNavigateTab('gateway')` | Manage → `section-gateway` | ✓ |
| `school-subscription.tsx:2750-2778` | persists `?tab=…&sub=…` | parent rewrites copy unknown params — `sub` survives healing | ✓ |
| `school-setup.tsx:107-115` | `onNavigateTab('metadata'/'users'/'identity'/'plan'/'domains')` | all five in map; unit-pinned | ✓ |
| `NextActionsCard` | `tab:'advanced'/'access'/'setup'` | `advanced`→Manage·danger, `access`→Manage·access, `setup`→Setup | ✓ |
| `audit/page.tsx:6`, `operations/*`, `class-hub` | other surfaces' own `?tab=` vocabularies (reports/operations/teacher) — different pages, unaffected | — | ✓ |

- The only remaining literal old-key strings in `school-detail.tsx` are the two intentional `tab:'advanced'` compat callers in `NextActionsCard` — they are the compatibility mechanism itself, exercised through the tested map.
- `tests/security/route-inventory.test.ts` (11/11, green locally and in CI) independently guarantees no stale internal href/router target exists in platform sources.
- Existing E2E journeys remain valid: CI attempt 2 ran `Ran 39 tests across 4 files` — all pass, including the platform-console navigation battery ("every sidebar destination renders", audit-log regression, 404 plane recovery, session-expiry flow).

**One behavioral change found** (Finding 1): a viewer holding `schools.read` and none of the four Manage capabilities no longer sees the Access & users content (§7 showed it to everyone). Production DB check: **no such admin exists today** (2 platform admins: 1 root; 1 suspended ops admin holding `schools.manage` among 5 grants) — latent, not live.

---

## 7. Responsive UI & usability review

**Verification level: static code review only.** No browser session was performed in this review (auth-gated console surface; no credentials; running the app locally would have required pointing it at a database, which the review restrictions forbid). Every claim below is from class/structure inspection, not pixels.

- **Tab bar**: 3 triggers (down from 6) in the pre-existing single-row `overflow-x-auto no-scrollbar` list with `flex-none` triggers — horizontal overflow risk at 390 px strictly decreases; no page-level horizontal scroll introduced.
- **New card layout**: `grid-cols-1 lg:grid-cols-2` for the two cards; module list `grid-cols-1 sm:grid-cols-2`; `min-w-0` + `truncate` on text cells — stacks cleanly to a single column on phones.
- **Touch targets / a11y**: trigger `min-h-[36px]` is the pre-existing §7 sizing (unchanged); Radix provides `aria-selected`, roving arrow-key focus; icon-only glyphs are `aria-hidden` with adjacent text labels; the module rows are real text (screen-reader readable); the readiness badge conveys state as text.
- **No clutter/oversized cards**: the card reuses the established compact card chrome (border-b header, px-4/5 paddings); no decorative panels, no fake progress indicators, no duplicated explanatory text beyond the two one-line descriptions.
- Loading/empty/error states of the surrounding workspace are pre-existing and unchanged (§3).

Concrete usability problem found: none beyond Finding 3's copy contradiction (a user-facing text that can mislead). No visual-change recommendations are made — nothing observed justifies one.

---

## 8. Architecture documentation review (`PHASE-1-ARCHITECTURE.md` + `PHASE-1-IMPLEMENTATION.md`)

Spot-checked claims against the codebase — **all exact**:

| Doc claim | Verified |
|---|---|
| 93 platform API route files | 93 ✓ |
| ~243 school-plane API route files | 243 ✓ |
| `console-shell.tsx` 734 LOC, hardcoded `NAV_GROUPS` | 734 ✓, `NAV_GROUPS` at line 97 ✓ |
| `school-detail.tsx` 3,071 LOC pre-Phase-1 | 3,071 ✓ (3,123 after) |
| `school-subscription.tsx` 3,108 LOC | 3,108 ✓ |
| `provision-wizard.tsx` 2,815 LOC | 2,815 ✓ |
| 135 Prisma models | 135 ✓ |
| tests taxonomy "142 files" | 141 `.test.ts` (143 files importing `bun:test`) — trivial drift, INFO-3 |
| readiness contract (11 sections, `usable` gate) | matches `setup-readiness.ts` ✓ |
| module flag resolution `school ?? PlatformSetting.modules ?? true` | matches `module-flags.ts` ✓ |
| §6 navigation (implemented) / §7 Manage hierarchy (phased) | matches code (§4 above) ✓ |
| §10 "Phase 1: none — no migration, no API contract change, no new endpoint" | true (redirect-only page handles are not API endpoints) ✓ |
| §11 security risks incl. MFA stand-down, shallow flag coverage, F1/F2 carry-over | all consistent with code and prior PR #68 review ✓ |
| §15 known limitations honest (dormant plan modules, demo-tier certificates, write-only timetable slice, three announcement universes) | consistent ✓ |

- The doc's proposed **feature registry** (§8) explicitly extends the existing `FLAGGABLE_MODULES` vocabulary and keeps `assertModuleEnabled` as the server gate — it does **not** create a competing permission/module system. The **template lifecycle** (§9: Draft→Validate→Preview→Publish→Active→Retire, immutable published versions, rollback = repoint) reuses the existing render engines and adds persistence — matching the audit finding that no template system exists today (certificates are client-store demo-tier; verified).
- The ownership matrix (§5) documents where reality diverges from the proposed table (platform metadata PATCH bypasses the school path's contrast check — queued as a Phase 2 fix; contact/location dual-writer) — honest, no assumption presented as implemented.
- `PHASE-1-IMPLEMENTATION.md` claims vs my independent local re-run: see §9.2 — **every claimed local result reproduced exactly**.

---

## 9. Regression & CI review (independently verified)

### 9.1 CI attempt 1 failure — root cause analysis (evidence, not assumption)

From the attempt-1 job log (downloaded in full, 13,274 lines):

```
(fail) GATE F · DELETE /api/profile/avatar — authorization boundary > canonical roles
        remove their (unset) own photo → 200 (self-service preserved, no-op write) [1622.29ms]
error: DELETE /api/profile/avatar (tenant.teacher.a@hawkings.test): expected 200, got 500;
       body=<!DOCTYPE html>…
--- dev.log (relevant tail) ---
⚠ Server is approaching the used memory threshold, restarting...
{"…","operation":"POST /api/profile/avatar",…,"status":503,"errorCode":"EXTERNAL_SERVICE_FAILURE",
 "detail":"storage env gate: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing…"}
```

- The failing test got an **HTTP 500 whose body is the dev-server crash/restart HTML page**, timestamped exactly while the dev.log records `⚠ Server is approaching the used memory threshold, restarting...`. The request hit the server mid-restart.
- The same test passed on attempt 2 (full suite green), and the identical assertion passed in the neighboring attempt-1 tests (`existing avatar: planted safe fileName clears BOTH columns → 200` passed 0.5 s later; the 503 storage-gate line is an expected-fixture log, not the failure).
- The PR diff does not touch `/api/profile/avatar`, auth, storage, or anything in the failure's code path.

**Determination: the attempt-1 failure is genuinely transient — CI-infrastructure memory pressure, not a test or authorization defect.** What it *does* reveal is harness sensitivity (a live dev server under memory pressure can restart mid-test and turn any in-flight request into a spurious 500) → Finding 4.

### 9.2 Local verification (performed by this reviewer, on the exact head `6b25ed0`, exact commands from the repo)

| Check | Implementation report claims | Independent local result |
|---|---|---|
| `bun run typecheck` (tsc --noEmit) | 0 errors | **0 errors** (exit 0) ✓ |
| `bun run lint` (0-error gate) | 0 errors, 64 warnings | **0 errors, 64 warnings** ✓ |
| `bun test tests/unit/school-control-center-tabs.test.ts` | 11/11 | **11 pass / 0 fail** ✓ |
| `bun test tests/unit/` | 471/471 (34 files) | **471 pass / 0 fail, 34 files** ✓ |
| `bun test tests/security/route-inventory.test.ts` | 11/11 | **11 pass / 0 fail** ✓ |
| `bun run build` (SCHOLARIO_PLANE=platform, standalone) | exit 0; new routes in manifest | **exit 0**; `/platform/schools/[id]/overview`, `/setup`, `/manage` all present in the route manifest ✓ |
| Full DB-backed battery (integration/api/regression/security + E2E) + migrations | executed by CI only | **CI attempt 2 on the exact head**: `Ran 2099 tests across 139 files` → 2,072 pass + 27 skip + 0 fail; `Ran 39 tests across 4 files` E2E → 39/0; migration deploy + drift gate green ✓ |

The reported "2072 passed / 27 skipped / 0 failed" and "E2E 39/0" are confirmed from the attempt-2 CI log itself (`(pass)` line counts: 2,111 = 2,072 unit-side + 39 E2E; skip list enumerates exactly 27). Which results are local vs CI is correctly stated in the implementation report.

---

## 10. Scope creep check

All 8 files inspected line-by-line (545-line diff, 20 hunks). Confirmed the PR does **not**:

- change `prisma/schema.prisma`, add migrations, or alter seeds — none present;
- modify authentication/authorization behavior (`middleware.ts`, `authz.ts`, `auth.ts`, `permissions.ts` untouched);
- modify env vars, CI workflow, deployment config, or secrets — none;
- change unrelated APIs or platform-wide module behavior — no API file touched;
- delete old functionality — every §7 capability survives (§4); deletions are the moved-out legacy map + old tab-bar JSX + superseded comments;
- introduce mock data — the only new display consumes the live dossier payload;
- alter school-side workflows — nothing outside the platform console surface changes.

The one feature addition (the Overview `SetupModulesCard`) is within the declared Phase 1 scope ("Overview: real DB data dashboard — setup completion, modules") and is read-only. Scope verdict: **clean**.

---

## 11. Findings

Severity key: P0 critical security/data loss · P1 high-impact defect · P2 important correctness/architecture · P3 minor · INFO observation.

### Finding 1 — P3 · Manage tab hides the read-only Users roster from a hypothetical `schools.read`-only admin

- **Where**: `school-detail-tabs.ts:99-110` (`availableControlCenterGroups`); `school-detail.tsx` (Users section now inside `TabsContent value="manage"`).
- **Evidence**: §7 made the Access & users group visible to every viewer (`groups = ['overview','configuration','access']`); Phase 1 shows Manage only when the viewer holds ≥1 of `schools.manage | billing.manage | support.access | audit.read`. Meanwhile `GET /api/platform/schools/[id]/users` authorizes with `schools.read` alone — i.e., the roster is a read capability that the new gate hides. Production DB (read-only query, this review): 2 platform admins — 1 root, 1 suspended ops admin whose grants include `schools.manage`. **No admin with `schools.read` and none of the four capabilities exists today**, so zero current users are affected.
- **Why it matters**: it is the one place the "nothing disappeared during regrouping" claim doesn't hold for a conceivable future role (e.g., a read-only auditor), and the fix is small. It does not weaken security (the server still authorizes; this is pure UI visibility).
- **Recommended fix** (either): (a) count `schools.read` toward Manage visibility but keep every section self-gated as it already is; or (b) move/also-render the Users `GroupSection` where a read-only viewer can reach it. Alternatively document the constraint in §7 of the architecture doc.
- **Blocks merging**: No (latent; no affected user exists).

### Finding 2 — P3 · Overview modules summary ignores the platform master switch (`override ?? true` vs documented `override ?? master ?? true`)

- **Where**: `school-detail.tsx:1485-1500` (new `SetupModulesCard`); same pre-existing computation in the Setup section at `:2518-2521`.
- **Evidence**: the dossier GET returns the raw override map (`route.ts:164` — `featureFlags: parseFlags(school.featureFlags)`); the card computes `enabled = override ?? true` and labels no-override rows "· platform default". Server truth is `school override ?? PlatformSetting.modules ?? true` (`module-flags.ts:56-95`, enforced by `assertModuleEnabled`). When a master switch is OFF and the school has no override, the card says "On · platform default" while the module is actually disabled server-side. The Setup section has displayed the same simplified value since before this PR (its own header even states the full formula); the PR replicates the behavior on a second surface rather than fixing it.
- **Why it matters**: the Overview is the "operator's landing truth"; a misstated module state can misdirect an operator. Display-only — `FEATURE_DISABLED` enforcement is unaffected.
- **Recommended fix**: Phase 2 (as the doc already plans richer Overview data): serve `effectiveModuleFlags(schoolId)` through the dossier GET and have both surfaces render from it; until then, soften the label to "no school override" instead of asserting the effective value.
- **Blocks merging**: No (pre-existing behavior faithfully replicated; proper fix needs an API payload change deliberately out of Phase 1 scope).

### Finding 3 — P3 · Contradictory readiness copy for PENDING/TRIAL schools whose required sections are complete

- **Where**: `school-detail.tsx:1458-1470` (`SetupModulesCard` description paragraph).
- **Evidence**: `usable = status==='ACTIVE' && requiredComplete` (`setup-readiness.ts:239`); `deriveProvisioningState` maps `PENDING→PENDING_ACTIVATION` and leaves `TRIAL` to the `NEEDS_SETUP/READY` branch with `setupUsable=false`. For a PENDING/TRIAL school with `requiredComplete=true` the card renders badge **"Complete"** and paragraph **"Required onboarding sections are still incomplete — Setup deep-links each blocker."** The two statements contradict each other and the paragraph is factually wrong (the blocker is activation, not sections). Realistic for TRIAL tenants that finished configuration.
- **Why it matters**: Phase 1's Overview must not make misleading readiness claims; this is exactly the "misleading claim about a school being ready" class.
- **Recommended fix**: one-line copy branch — when `requiredComplete && !usable`: "Setup is complete — sign-in opens when the school is activated." (plus analogous TRIAL wording).
- **Blocks merging**: No (display copy only; badge and underlying data remain correct).

### Finding 4 — P3 · CI test harness is sensitive to dev-server memory-pressure restarts

- **Where**: CI workflow test-suite step (`.github/workflows/ci.yml`, step 15); failure evidence in attempt-1 log (§9.1).
- **Evidence**: attempt 1 failed one test with a 500 HTML page exactly while dev.log recorded `⚠ Server is approaching the used memory threshold, restarting...`; attempt 2 identical head → full green.
- **Why it matters**: not a PR defect (diff doesn't touch the failing path) and not an authorization issue, but it can produce spurious reds that erode trust in CI — the same class of "flaky" that this review was asked to adjudicate with evidence.
- **Recommended fix** (repo-level, not this PR): give the CI dev server more headroom (the repo already tunes `DEV_OLD_SPACE_MB`), or make the test harness retry once on a 5xx-with-HTML-body before failing an assertion.
- **Blocks merging**: No.

### INFO-1 — Pre-existing back/forward echo edge in tab state (not introduced here)

`lastWrittenTab` echo-suppression (`school-detail.tsx:1560,1575-1589`) is byte-identical to base. Sequence BACK (URL loses `?tab=`) → FORWARD (URL regains the same `?tab=setup`) suppresses the effect because `raw === lastWrittenTab.current`, leaving the UI on Overview with `?tab=setup` in the URL until the next interaction. Pre-existing §7 defect; worth a follow-up (clear `lastWrittenTab` whenever `raw` is null or differs from the last write).

### INFO-2 — New stable handles drop extra query params on redirect

`/schools/[id]/setup?sub=codes` redirects to `?tab=setup` without copying `sub=`. No caller passes extra params to the new handles today; relevant only when Phase 2 promotes sub-tab deep links. One-line fix at that time (mirror the workspace's param-copying rewrite).

### INFO-3 — Doc/count drift trivia

Implementation doc says "142 files / 2,027 cases" for the test taxonomy; actual `tests/` holds 141 `.test.ts` files (143 importing `bun:test`). Immaterial; correct opportunistically.

### INFO-4 — No dedicated E2E for the three new redirect handles

They're covered indirectly by the production build manifest, route-inventory href resolution, and Next.js redirect semantics; a Phase 2 E2E journey ("deep link → correct destination") is already planned in doc §12.6.

### Codex bot findings (context)

The automated Codex review flagged three P2s on this PR; they correspond to my Findings 1, 2 and 3. I calibrated all three down to P3 on evidence: Finding 1 is latent (production DB shows no such admin exists), Finding 2 replicates pre-existing display behavior with the correct fix requiring an out-of-scope API payload change, and Finding 3 is a copy defect where the adjacent badge remains correct. The findings are real and documented; none blocks merge.

---

## 12. Final review verdict

**APPROVE WITH NON-BLOCKING OBSERVATIONS**

| Item | Result |
|---|---|
| Exact reviewed head SHA | `6b25ed0c8b8f40b1f21c70ff082887d39833031b` |
| Base SHA | `e8aca3973f066a4f532e0466bbdaaef1a8392c4a` (= current `main`; PR #68 merge commit) |
| PR status | Open, not draft, not merged, mergeable/clean, 1 commit, 8 files |
| CI runs | [Run 41170178241](https://github.com/signature4748-obs/Scholario-upgrade/actions/runs/41170178241) on the exact head — attempt 1 failure (transient dev-server memory restart, unrelated to diff), attempt 2 success; unit/integration/API/regression/security 2,072 pass / 27 skip / 0 fail; E2E 39/0; typecheck/lint/migrations/build green |
| Local independent verification | typecheck 0 errors · lint 0/64 · new tests 11/11 · unit 471/471 · route-inventory 11/11 · build exit 0 with all three new routes — all on the exact head, all matching the implementation report |
| Security review | No authorization/tenant-isolation/RLS/step-up/audit change; new routes are redirect-only inside the existing boundary; no new write path; no client-only authz; no sensitive data exposure |
| Legacy compatibility | All 22 tab keys + every repo caller verified; URL healing preserves foreign params; route-inventory + E2E green |
| Responsive verification level | Static code review only (disclosed); layout classes and a11y structure inspected; no browser session performed |
| Documentation accuracy | High — every spot-checked quantitative claim exact (93/243/734/3071/3108/2815/135); honest limitation and phased-plan sections |
| Merge blockers | **None** |
| Findings | P3 ×4 (Manage-visibility latent regression · module-summary master-switch fidelity · readiness copy contradiction · CI harness memory sensitivity) + INFO ×4 |
| Recommended next action | Merge. Then, in a fast-follow (ideally before Phase 2 work starts): (1) copy fix in `SetupModulesCard` for the PENDING/TRIAL complete case; (2) decide the read-only-roster visibility rule; (3) plan `effectiveModuleFlags` in the dossier GET for Phase 2; (4) CI dev-server headroom/retry hardening. |

**Final principle check.** Phase 1 keeps its promises: it is a foundation, not a rewrite — it reuses the existing permission pipeline, readiness engine, module-flag resolution and audit/step-up machinery; it invents no schema, no competing systems, and no mock data; and the architecture document it ships is an honest map (including what is *not* built) that Phases 2–4 can safely build upon.

---

### Review-artifact note

This report was produced in a review-only session. It exists as a local, **uncommitted** file at:

- `/home/z/my-project/repo69/docs/super-admin-transformation/PHASE-1-INDEPENDENT-REVIEW.md` (repo-relative path as requested; not committed/pushed)
- with a user-facing copy at `/home/z/my-project/download/PHASE-1-INDEPENDENT-REVIEW.md`

No repository state was modified.
