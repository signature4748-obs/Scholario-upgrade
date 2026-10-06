# Disaster Recovery Runbook — Scholario

> Production disaster-recovery hardening pass, 2026-10-06. Covers the ONE
> Supabase project (`kbyknezedewvgrnqervj`, ap-south-1, PG 17.11) behind both
> Vercel planes. Live-verified today: Management API, direct SQL via the
> pooler, a full logical restore drill on an isolated local cluster.
> Supersedes `docs/BACKUP_RECOVERY.md` as the recovery RUNBOOK (that doc
> stays as tool reference + historical evidence). Prisma remains the only
> migration authority; architecture is LOCKED (one repo, two Vercel
> projects, one Supabase, custom auth, Storage, Broadcast-only Realtime).

## NEVER (read before any incident action)

- **NEVER restore over production as the first action.** Every Supabase restore path (PITR or daily) creates a NEW project; the logical JSONL path restores into a FRESH database. Production is only ever pointed at a validated recovery target afterwards.
- **NEVER run destructive SQL during an incident without an approved recovery plan.** Take a fresh `scripts/db-backup.ts` dump + note the time first; evidence before surgery.
- **NEVER assume Vercel environment-variable changes affect existing deployments.** Env vars apply only to NEW deployments — after rotating `DATABASE_URL` you MUST redeploy both projects (verified live during the 2026-10-06 env-rotation incident, docs/SUPABASE_AUDIT.md §13).
- **NEVER point production at a recovered database before validation is complete** (§12 validation gates, §15–§17 verification).

## 1. Purpose

Single source of truth for recovering the Scholario production database, its tenant data, and the two serving planes after any failure in the list at §7. It defines RPO/RTO targets, the backup layers, the exact recovery procedures, and the drill schedule that keeps them honest. A backup is not production-ready because it exists — it is production-ready because a drill restored it, verified parity, tenant isolation and financial integrity, and proved the guards still fire.

## 2. Architecture (locked — do not redesign during recovery)

| Layer | Component |
| --- | --- |
| Source | `signature4748-obs/Scholario-upgrade`, branch `main` = production |
| Serving | Vercel `scholario-platform` (control plane) + `scholario-app` (school plane, `scholario-app-virid.vercel.app`); legacy `scholario-production` parked as known-good rollback (docs/VERCEL_PROJECTS.md §7) |
| Database | Supabase project `kbyknezedewvgrnqervj` (named `scholario-production`), PG 17.11, ap-south-1, 112 public tables, 14 Prisma migrations |
| Auth | Custom server-side scrypt+cookie; `auth.users` = 0; Supabase Auth not used |
| Storage | Buckets `public-media` (public, 38 objects) and `school-media` (private, 20 objects) |
| Realtime | Broadcast only (empty publication is correct) |
| Tenants | `green-valley` (real) + `hawkings-prithvipur` (demo) |
| Ordering contract | DATABASE FIRST, APPLICATION SECOND (docs/RELEASE.md) |

## 3. RPO

| State | RPO | Basis |
| --- | --- | --- |
| Today (no platform backups) | **Unbounded** for physical disaster; minutes-to-hours for the operator-triggered JSONL dump (exists only if someone ran it and copied it off-box) | live: `backups: []`, `pitr_enabled: false` |
| Pro plan (daily backups) | ≤ 24 h | platform feature |
| PITR enabled (target) | ≤ 5 min | restore-point granularity; measured at the first post-enablement drill |

Operational target: **RPO ≤ 5 min after the owner enables PITR (§6)**. Until then, the honest statement is: any disaster loses everything since the last manual dump.

## 4. RTO

- **Verified capability (today's drill): data path = seconds.** Fresh DB + `prisma migrate deploy` (14/14) + full logical restore + verification of all 8,859 rows + 3-way money parity completed in **2 seconds** at the current corpus (11:01:48 → 11:01:50 UTC, local cluster). Load phase alone: 0.59 s.
- Platform capability: a Supabase PITR/daily restore provisions a new project (minutes, Supabase-side; size-dependent — DB is ~67 MB today).
- **Operational target (not an SLA): ≤ 2 hours end-to-end** for a full project disaster — human decision time + new-project provisioning + `DATABASE_URL` rotation + redeploy + validation. First real measurement happens at the first PITR drill; update this line then.

## 5. Backup strategy

Live state (2026-10-06, Management API `GET /v1/projects/{ref}/database/backups`):

| Item | Value |
| --- | --- |
| WAL-G infrastructure | `walg_enabled: true` |
| PITR | `pitr_enabled: false` |
| Base backups | `[]` — none exist |
| Restore points | `physical_backup_data: {}` — none exist |
| WAL archiving | LIVE: 691 segments archived, 0 failures, last 2026-10-06 10:27 UTC (`pg_stat_archiver`) — but WAL without a base backup cannot restore anything |
| DB size / rows | ~67 MB / 8,859 app rows / 2 tenants |
| Growth vs 2026-10-02 drill | 8,501 → 8,859 rows (stable corpus; largest table `Attendance` 3,280 rows unchanged since 2026-10-06 audit) |
| Storage usage | separate surface: 38 public + 20 private objects |

Layers:

1. **Supabase platform backups (pending owner action)** — daily base backups on Pro, PITR as add-on (§6). This is the only layer that survives a full project disaster.
2. **Application-level logical dump** — `scripts/db-backup.ts` → `backups/scholario-<ts>.jsonl.gz` (every public table, byte-exact dates, NUMERIC strings, FK-parents-first). Run on demand; ~40 s over the pooler. Archives contain password/session hashes — treat as secrets. **Off-box copy is a manual owner step** (the sandbox copy is ephemeral).
3. **Pre-migration snapshot** — mandatory before any production migration: run layer 2 + `scripts/prod-migration/preflight.ts` row-count snapshot (docs/RELEASE.md already enforces this in the pipeline).

Known gap (fixed today): the logical restore path aborted on tenant-guard triggers whose cross-table predicates are not FK edges (`StudyMaterial.subjectId` has a guard but no FK → load order could load the child before the referent). `scripts/db-restore-verify.ts` now disables USER triggers inside the load transaction (FK internal triggers stay live) and re-arms them before COMMIT; the drill audit re-verifies the invariants afterwards. Storage objects are NOT covered by any database backup — bucket files must be re-synced/re-uploaded separately after a full disaster (§18).

## 6. PITR strategy

Current: disabled, zero restore points (§5). Owner action required (paid — never enabled automatically):

1. Confirm the plan on the Supabase dashboard → Billing (the public Management API does not expose plan state for this token; behavior — WAL archiving live but zero base backups after 5 days — is consistent with Free tier).
2. If on Free: upgrade to **Pro** (daily backups, 7-day retention).
3. Enable the **PITR add-on** (7-day retention; ~$100/month per project on top of Pro per Supabase published pricing — confirm the exact price on the billing page before committing).
4. Expect: **no downtime, no connection-string change, no Vercel change** (WAL archiving already runs server-side; verified live today via `pg_stat_archiver`).
5. Within 24 h the first base backup appears; restore points then accumulate at minute granularity.
6. Verification (owner, after enablement): `GET https://api.supabase.com/v1/projects/kbyknezedewvgrnqervj/database/backups` with the access token → `pitr_enabled: true`, `backups` non-empty, `physical_backup_data.earliest/latest` non-null. Do NOT claim "backup working" from the toggle alone — then run the §20 drill.

## 7. Failure scenarios

| Scenario | Primary path | RPO impact |
| --- | --- | --- |
| Accidental row/table deletion | PITR restore to a new project (point before deletion) + selective SQL export of the lost rows | ≤ 5 min |
| Bad migration | Additive-only policy: re-run failed migration (nothing changed) / roll the app back via Vercel promote; DB rolls FORWARD only. Pre-migration dump (§5.3) is the data safety net | 0–24 h |
| Application bug corrupting data | PITR to point before the bug window → new project → extract affected tables → patch prod surgically | ≤ 5 min |
| Incorrect bulk import | PITR to point before the import | ≤ 5 min |
| Tenant-level accidental modification | PITR + tenant-scoped export (`WHERE "schoolId" = …`), re-apply on prod inside a transaction; guard triggers reject cross-tenant writes | ≤ 5 min |
| Database outage (platform) | Supabase-owned; watch status.supabase.com; app returns 503 via `/health/ready`; `withDbRetry` absorbs blips | platform SLA |
| Credential compromise | Rotate DB password (Supabase) → overwrite `DATABASE_URL` on BOTH Vercel projects → redeploy both → rotate `SUPABASE_SERVICE_ROLE_KEY` / `REALTIME_CHANNEL_SECRET` / `FILE_SIGNING_SECRET` similarly; PITR only if data was tampered | 0 (no data loss) |
| Full project/database disaster | §11 PITR (or §5.2 JSONL if PITR still absent) → new project → §13 rotation → §12 validation | per layer |

## 8. Incident severity

| Level | Definition | Examples |
| --- | --- | --- |
| SEV-1 | Production data loss or unrecoverable state in progress / both planes down | dropped table, corrupt migration, ransomware |
| SEV-2 | Single-tenant data issue or degraded-but-serving state | bad import for one school, storage bucket error |
| SEV-3 | Near-miss / drill finding | restore path blocked by guard triggers (found+fixed 2026-10-06) |

SEV-1 → start §10 immediately. SEV-2 → same tree, scoped. SEV-3 → file in §21, no incident response.

## 9. Authorization

Only the **project owner** may: enable paid features (§6), rotate production credentials (§7 row 7), point production at a recovery database (§13), or delete/retire any project. Drills (§20) run exclusively on isolated recovery environments (local cluster or a fresh Supabase project) and never touch production beyond a read-only dump. Anyone may take a read-only dump (§5.2).

## 10. Recovery decision tree

1. **Stop.** Confirm the failure is real (§15 probes). Do not "quick-fix" on prod.
2. **Preserve evidence:** run `cd /tmp/dr-prod && bun /home/z/my-project/scripts/db-backup.ts` (read-only) and record the UTC time — the WAL position and this dump are your recovery bounds.
3. Classify: data issue (rows wrong/missing) → 4; schema issue → 5; credentials → §7 row 7; platform outage → wait + monitor.
4. Data issue: is PITR enabled with a restore point before the event? YES → §11. NO → can the data be reconstructed from the §2 dump / app logs? YES → surgical SQL on prod (inside a transaction, after the §5.3-style snapshot). NO → full logical restore (§12) is your last resort; accept the RPO.
5. Schema issue: `DATABASE_URL=<prod> bunx prisma migrate status` — drift? Re-run deploy (idempotent); a failed migration changes nothing (single transaction). Unknown state = STOP, read-only investigation.
6. Recovery target validated (§12)? → §13 rotation + §15–§17 verification → incident closed → §21.

## 11. Point-in-time recovery procedure (PITR — after owner enables §6)

1. Supabase dashboard → project `kbyknezedewvgrnqervj` → **Database → Backups**.
2. Pick a restore point BEFORE the failure (list shows available points; earliest = first base backup).
3. Click **Restore to a new project** — this creates a NEW project with a new ref + connection string. The original project is untouched (that is the safety property; never "restore over" prod).
4. Wait for provisioning + WAL replay (minutes at this DB size).
5. Continue at §12 step 2 with the new project's connection string.

## 12. Recovery project procedure (validation in isolation)

Target: a FRESH database — either the §11 new Supabase project, or a local/CI cluster.

1. (Logical path only) Apply schema: `DATABASE_URL=<recovery-url> bunx prisma migrate deploy` → expect 14/14.
2. (Logical path only) Load + verify: `bun scripts/db-restore-verify.ts <archive>.jsonl.gz --into public` → expect every table OK, TOTAL OK, 3-way money parity OK, exit 0. (PITR path: skip 1–2 — the restore already carries schema+data.)
3. Run the §16/§17 verification SQL (RLS census, guard triggers enabled, guard predicates = 0 violations, cross-tenant INSERT probe blocked, parity sums, critical counts vs the §17 baseline).
4. App-level connect test, isolated: `DATABASE_URL=<recovery-url> SCHOLARIO_PLANE=school bun run dev` locally → login with a known account → roster + fees dashboard render. Never expose the recovered data publicly.
5. Only now proceed to §13.

## 13. Vercel DATABASE_URL rotation / redeployment procedure

1. Overwrite (Sensitive vars are write-only — never try to read them back): `DATABASE_URL` = the recovery project's pooler URL (Supavisor form; `connection_limit=2`) on **both** `scholario-platform` and `scholario-app`. Keep `DATABASE_ENV=production` and every other var as-is.
2. Redeploy both projects (Vercel dashboard → Deployments → Redeploy, or push a trivial commit) — running deployments will NOT see the new value (see NEVER #3).
3. Verify: `/health/ready` → 200 `"database":"ok"` on both planes; then §15.
4. Rollback: re-paste the previous connection string + redeploy again (the DB side has nothing to roll back).
5. Update docs/VERCEL_PROJECTS.md §2 if the Supabase ref changed.

## 14. Prisma migration verification

On the recovery target: `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;` → must be **14 rows, all finished**, names byte-identical to the `prisma/migrations/` directories (`0_init` … `20261005060000_platform_account_recovery`) — verified today on both production (live probe) and the drill restore. Drift = the recovery is stale → stop. Never run `prisma migrate reset`/`db push` against production.

## 15. Application health verification

| Probe | scholario-platform | scholario-app |
| --- | --- | --- |
| `/health/ready` | 200 `database:ok` | 200 `database:ok` |
| Own login route | `/platform/login` → 200 | `/s/green-valley/login` → 200 |
| Foreign-plane route | `/s/green-valley/login` → 404 | `/platform/login` → 404 |

Also: Supabase health `GET /v1/projects/{ref}/health?services=db&services=storage&services=realtime` → all `ACTIVE_HEALTHY` (realtime `db_connected:false` is CORRECT — broadcast only). Watch Vercel function logs for `DATABASE_FAILURE` for 24 h.

## 16. Tenant isolation verification

1. `SELECT slug, status, "isDemo" FROM "School" ORDER BY slug;` → exactly the expected tenants (today: green-valley ACTIVE real + hawkings-prithvipur ACTIVE demo).
2. Cross-tenant guard probe (inside a transaction, always rolled back): copy a Student row, flip its `schoolId` to another school, INSERT → must fail with `tenant-guard: Student references another school's row` (verified live on today's drill restore).
3. Guard census: `SELECT count(*), count(*) FILTER (WHERE tgenabled <> 'O') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal;` → triggers enabled, 0 disabled (today: 66 / 0).
4. RLS census: 112/112 tables RLS-enabled, 0 policies — deny-by-default intact.
5. Per-tenant row domains: every `"schoolId"` in Student/User/Teacher/Class/Attendance/Fee/Payment/FeeTransaction/SalaryPayment/ActivityLog must reference an existing School (audit script pattern; today: 0 violations).

## 17. Financial data verification

Today's production baseline (re-verify against prod, then the recovery must match):

| Check | Production (2026-10-06) |
| --- | --- |
| Σ Payment(SUCCESS) = Σ FeeTransaction(SUCCESS) = Σ Fee.paid | `595820.00` each — 3-way exact, NUMERIC-exact (`::text`) |
| Σ SalaryPayment.amount | recompute and compare before/after |
| Row counts | Fee 328, FeeTransaction 226, Payment 218, SalaryPayment 30, SalaryStructure 15, FeeStructure 0, Student 82, User 185, Attendance 3280, ExamMark 653, Result 30, Exam 4, Class 15, Teacher 16, ActivityLog 530, PlatformAuditLog 684, EmailDelivery 30, TenantDomain 0, SchoolSubscription 2, PlatformAdmin 2, Session 23, UploadedFile 0, School 2 |
| CHECK constraints | fee paid bounds / positive amounts still enforced post-restore (guards armed, §16.3) |

## 18. Post-recovery checks

- `/health/ready` green on both planes for 24 h (Vercel logs clean of `DATABASE_FAILURE`).
- Spot-check a login per plane + a fees dashboard number against §17.
- Storage: object counts per bucket (public-media / school-media) vs the incident-time record; re-sync missing files from the off-box copies.
- PlatformAuditLog / ActivityLog: scan the incident window for unexpected writes.
- EmailDelivery: confirm the queue is not stuck (Resend key must be valid — currently an open owner action).
- File the incident record (§21) and re-run a §20 drill against the new production within 30 days.

## 19. Communication checklist

- SEV-1: owner notifies affected tenants (email) stating scope + data-loss window (RPO honesty) + expected restore time; update this doc's incident log; post status on the login page if a plane is down.
- SEV-2: owner notifies the affected tenant only.
- Record: timeline, decision points, exact commands, verification outputs — appended to this file (§21) within 72 h.

## 20. Recovery drill schedule

| When | What |
| --- | --- |
| Within 72 h of PITR enablement | full §11–§12 drill against a restore point (first PITR-path drill; measure real RTO, update §4) |
| Quarterly | repeat the logical-path drill below |
| After any migration touching financial/tenant tables | pre-migration dump + post-deploy §16/§17 spot checks |
| After any §13 rotation | §15 probes |

Logical-path drill (executed and PASSED 2026-10-06 11:01 UTC — re-run verbatim):

```bash
# 1. dump production (read-only; from a dir whose .env points at the prod pooler)
cd /tmp/dr-prod && bun /home/z/my-project/scripts/db-backup.ts
# 2. fresh isolated database + schema
DATABASE_URL='postgresql://…recovery…' bunx prisma migrate deploy   # 14/14
# 3. restore + verify (counts, money parity, exit code)
bun scripts/db-restore-verify.ts <archive>.jsonl.gz --into public
# 4. audit: RLS/trigger census, FK orphan scan (196 constraints → 0), guard
#    predicates (0 violations), cross-tenant INSERT probe (blocked),
#    critical counts vs §17 baseline
# 5. app connect test in isolation (§12.4)
```

Latest drill evidence: 8,859/8,859 rows OK · parity 595,820.00 exact · 112/112 RLS · 66/66 guards enabled · 196 FKs, 0 orphans · cross-tenant INSERT blocked · full cycle 2 s. Prior drill: 2026-10-02 (Phase 8C-N, 44-table production corpus, RTO < 2 min, tenant-guard trigger verified).

## 21. Lessons-learned procedure

After every SEV-1/SEV-2 and every drill that finds a gap: append a dated entry here — what failed, root cause, the fix (commit SHA), what the drill caught that the audit missed, and which section of this runbook changed. Blameless; facts only. Latest entry:

- **2026-10-06** — drill caught the logical restore path aborting on tenant-guard triggers (guard predicates have no FK edges, so FK-parents-first order loaded `StudyMaterial` before its guard's referent existed). Fixed in `scripts/db-restore-verify.ts` (transactional USER-trigger disable/re-arm + `_prisma_migrations` count skip); verified by the same drill passing end-to-end. Root cause class to watch in future migrations: cross-table guards without FK edges.

## Remaining owner actions

1. **Enable Pro + PITR (§6)** — the only open SEV-1 risk left; every day without it is unbounded RPO.
2. Copy backup archives OFF the box whenever one is taken (§5.2) until platform backups exist.
3. Resend key + webhook registration (carried over — email delivery still unverified).
4. Optional hardening from the 2026-10-06 audit: least-privilege grants, `disable_signup`, SSL enforcement, `site_url` (docs/SUPABASE_AUDIT.md).

## Changes made by this hardening pass

- `docs/DISASTER_RECOVERY.md` (this file) — new.
- `scripts/db-restore-verify.ts` — drill-driven fix: tenant-guard triggers transactionally disabled for the load and re-armed before COMMIT; `_prisma_migrations` excluded from the backup-vs-restored count comparison (repo artifact, owned by `prisma migrate deploy`).
- `docs/BACKUP_RECOVERY.md` — pointer added; content unchanged.
- Zero changes to application code, Prisma schema, policies, buckets, plans or billing. Production was only ever read (backup dump + probes).
