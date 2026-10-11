# AUDIT 7/7 — SAFE CONTINUATION PLAN (ordered, risk-first, approval-gated)
Audit date: 2026-10-09

---

## 0. Operating rules for ALL gates (workspace-controller reality)

1. **Commit at every gate.** Uncommitted work and untracked files are wiped on resets (proven — Audit 1 §2). The controller may also revert branch switches (proven).
2. **Verify before every phase:** `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, branch presence (`pr3-recovery-baseline`).
3. Never fight the controller: no force operations, no blind branch switching, no `git clean`/`reset --hard`.
4. First action of the first approved gate: **commit this `audit/` directory + a recreated `worklog.md`** so the evidence trail itself becomes durable.
5. `main` on GitHub is protected (required PR reviews) — production changes flow through PRs; the parked CI (once restored) is the verification net.
6. The `sandbox/v2-rebuild` branch stays quarantined (its own SANDBOX.md forbids merging).

## Gate A — Workspace stack recovery (unblocks everything; P0-1)

Order (each step verified before the next):
1. Operator provides/restores `.env` values (PG URL for the local cluster + the full 38-var runtime set) — from the operator secret store; never printed.
2. Start `mini-services/postgres-db` (fresh cluster init at `db/pg`, :5432 — it adopts or initializes; ICU60 path already handled by the service).
3. `bunx prisma generate` (already done this session — re-run after any reset).
4. `bun run db:migrate` (migrate deploy against the local cluster — isolated/test database).
5. **Approval checkpoint:** run the demo-corpus seed family (`bun run seed:demo` pipeline, Hawkings-only, Green Valley untouched) — this is a deliberate seeding decision.
6. Restart/verify `mini-services/event-stream` (auto-reconnects) and the dev server; verify `/health/ready` → `database:ok`.
7. **Verification (completes Phase 4):** browser E2E of Principal/Teacher/Student demo login → dashboard on the ORIGINAL app; console clean; preview panel confirms.
8. Run the full test suites (target: the 518-test historical matrix) — record results.

Exit criteria: preview shows the original app, all three role dashboards open with real data, suites green.

## Gate B — Repository reconciliation (P1-1; after or parallel to Gate A)

1. Create a working branch from remote `main` (`3ae3c85`).
2. Restore the 4 upload-route files (already present on that line — the deletions were accidental, Audit 2 §3); confirm the docs delta (EMAIL.md/keepalive) applies cleanly (identical in both lines).
3. Commit audit evidence (Audit 0 rule 4) + typecheck/lint/upload-suite verification.
4. PR to `main` per branch protection (or push `development` → PR per docs/CI.md strategy).
5. Decide the fate of local `main`'s damaged amend (`baf93ac`) — it becomes moot once the line is reconciled; nothing of value is lost (its only delta was the accidental deletion).

## Gate C — PR-3 fee integrity re-implementation (P2-1; on `pr3-recovery-baseline` or post-Gate-B main)

1. Verify branch presence (resets!). Re-implement **Gate-1** from the preserved specification: canonical admission fee configuration layer (School.settings normalization, pure calculation engine, three-state semantics, client/server adapters, focused tests A–J).
2. Approval checkpoint (STOP for review, as originally specified).
3. Re-implement **Gate-2**: authenticated `POST /api/admissions/fee-snapshot` server-authoritative boundary (session-derived schoolId; client fee input never authoritative), official-snapshot hook, three-state document rows (F1–F8 fixed), document wiring, demo-only fee seeding (Hawkings, isDemo-asserted, idempotent, explicit), removal of fabricated defaults, security/unit tests.
4. Adversarial review of the exact blockers previously specified (discount authority, optional-charge authorization, tenant/authorization, test reconciliation, document parity, demo-seed safety).
5. Regression tests per Audit 6 §B.5.

## Gate D — Integrations & release automation (user-credential-gated; P1-4/P1-6/P2-3)

1. GitHub: workflow-scoped PAT → un-park `ci.yml` (its seed step was corrected in 8C-D); branch protection hardening as desired.
2. Vercel: verify which SHA is live on both plane projects; connect Git integration (or deploy deliberately); verify production health + SHA parity.
3. Supabase: read-only production reconciliation (counts, referential integrity, financial consistency, RLS advisor).
4. Resend/Razorpay: credential validity + webhook/event verification through their dashboards.
5. Credential rotation runbook (per Phase 8C §13/§47) once integration work completes.

## Gate E — Module completion backlog (P2-2/4/5; post-Gate-C)

R4 store-family server hydration (messages → calendar → library/transport → inventory/certificates/downloads); finance expense/ledger model; payroll model — in that dependency order, each with its data-honesty tests.

## What NOT to do (standing constraints)

- Do not merge `sandbox/v2-rebuild` into any production line.
- Do not re-seed or migrate any production/Supabase database from this sandbox.
- Do not run seeds before the Gate-A approval checkpoint.
- Do not push directly to protected `main`.
- Do not leave implementation work uncommitted across phase boundaries.

## Durability note for THIS audit's artifacts

`audit/*.md` and the recreated `worklog.md` are untracked files — they survive until the next workspace reset. Commit them at the first approved gate (they contain no secrets; all values were masked).
