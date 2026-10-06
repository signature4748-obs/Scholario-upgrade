# SSL & Network Security Audit — PostgreSQL SSL enforcement + Supabase network restrictions

> **Scope:** determine whether SCHOLARIO can safely enable (1) PostgreSQL SSL
> enforcement and (2) Supabase network restrictions, without breaking Prisma,
> Vercel serverless functions, migrations, Storage, Realtime Broadcast, health
> checks or production login.
>
> **Type:** AUDIT ONLY. No production setting was changed. No code was
> modified. No grant/RLS/schema/authentication change was made.
>
> **Date:** 2026-10-06 (UTC). **Vantage:** the operator sandbox
> (`/home/z/my-project`); at audit time both production planes were deployed
> at `main@ba5e26c`. This report ships as a docs-only commit
> (`audit: ssl and network security`) on top of that exact SHA — zero code,
> schema, grant or configuration change rides with it.
>
> **Classification: B — READY FOR SSL ENABLEMENT WITH OWNER ACTION.**
> Network restrictions: **NOT RECOMMENDED** under the current Vercel
> architecture (see §6).
>
> **UPDATE 2026-10-06T17:12Z — RESOLVED: SSL enforcement is now ENABLED**
> (owner-approved; activation record in §11). Classification is now
> **A — SSL enforcement ENABLED, production verified**; network restrictions
> remain OFF (not recommended).

---

## 0. Executive summary

| Question | Answer | Evidence |
| --- | --- | --- |
| Is Postgres TLS-capable today? | **Yes** — server `ssl = on`, min TLSv1.2, PG 17.11 | live SQL via pooler (§4) |
| Does Supavisor accept TLS on both ports? | **Yes** — TLSv1.3 / `TLS_AES_256_GCM_SHA384`, chain `Supabase Root 2021 CA` | openssl STARTTLS probes (§4.1) |
| Is SSL enforcement ON? | **No** — plaintext clients are accepted on 5432 and 6543 today | behavioral probes (§4.2) |
| Does production Prisma already use TLS? | **Yes** — Prisma's default is `prefer`: it sends the SSLRequest FIRST and only falls back to plaintext if the server refuses TLS; Supavisor never refuses | wire-level proxy experiment (§4.3) |
| Will Prisma keep working with enforcement ON? | **Yes** — both `prefer` (default) and `require` connect successfully to the pooler | live tests (§4.3) |
| Will the Management-API migration channel be affected? | **No** — it is HTTPS to `api.supabase.com`, never a Postgres wire connection | `scripts/prod-migration/lib.ts` (§1) |
| Will Storage / Realtime Broadcast be affected? | **No** — HTTP(S) APIs enforce TLS already and are outside the Postgres/Supavisor toggle | official docs + live TLS check (§5) |
| What breaks? | The **DR logical-dump channel only if its DSN is wrong**: node-pg ≥8.23 treats URL `sslmode=require` as verify-full → fails on Supabase's private CA. Correct DSN verified: `…?uselibpqcompat=true&sslmode=require` | live tests (§4.4) |
| Downtime when toggling enforcement? | **Brief database reboot** (seconds on this ~67 MB DB; plan for minutes) | official docs (§3.1) |
| Can network restrictions be enabled? | **No — not safely.** Vercel Functions egress through a dynamic pool that changes between requests; there is nothing stable to allowlist | Vercel KB, Nov 2025 (§6) |

---

## 1. Phase 1 — Repository connection audit

Every database connection path in the repository (no credentials involved;
values are env-held by design):

| # | Path | Client | Host / port (production) | Pool mode | SSL config source | Used in production? | Bypasses Supavisor? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `src/lib/db.ts` → PrismaClient (all app queries, `/health/ready` `$queryRaw SELECT 1`) | Prisma query engine (Rust) | `aws-0-ap-south-1.pooler.supabase.com:5432` | **session** (pool_size 15), `connection_limit=2`, serverless global-reuse + transient retry (P1001/P1002/P1006/P1008/P1017) | `DATABASE_URL` query params only — no TLS code | **Yes — both Vercel planes** | No |
| 2 | Vercel build: `prisma generate && prisma migrate deploy && next build` (`package.json` build script) | Prisma migration engine | same `DATABASE_URL` (pooler 5432) | session | same | **Yes — every deploy of all 3 projects** (idempotent no-op today: 15/15 applied) | No |
| 3 | `scripts/prod-migration/{preflight,apply,verify}.ts` — the AUTHORITATIVE migration pipeline | `fetch` → Supabase **Management API** `POST /v1/projects/{ref}/database/query` | `api.supabase.com:443` (HTTPS) | n/a | TLS by definition (HTTPS) | **Yes — owner-run releases** (via GitHub Actions `production` env `SUPABASE_ACCESS_TOKEN`) | Yes (not a Postgres connection at all) |
| 4 | `scripts/db-conn.ts` → `db-backup.ts`, `db-restore-verify.ts`, `db-perf-probe.ts` (ops scripts) | node-pg `Client` | `.env` `DATABASE_URL` — local dev DB | one client per script | URL only; **refuses production** (`DATABASE_ENV=production` or Supabase-host fail-safe) | No (local). The DR prod dump is owner-run from a separate env dir | No |
| 5 | `tests/helpers/db.ts` — all suites | PrismaClient, `connection_limit=3` | `DATABASE_URL` — local dev DB | session (budget 13/15 documented) | URL only | No (local/CI) | No |
| 6 | Local dev server + `mini-services/postgres-db` (embedded PG 18.4, port 5432 loopback) | Prisma / embedded cluster | local (currently SQLite file in `.env` — pre-existing local mismatch, unrelated) | n/a | n/a | No | No |
| 7 | Realtime: `src/lib/realtime/{client,publish}.ts` | `@supabase/realtime-js` WSS + REST broadcast | `SUPABASE_URL` `/realtime/v1` (443) | n/a | wss/https always | Yes | Yes (HTTP plane, not Postgres wire) |
| 8 | Storage: `src/lib/storage/supabase.ts` | `fetch` REST | `SUPABASE_URL` `/storage/v1` (443) | n/a | https always | Yes | Yes (HTTP plane) |

**Negative findings (verified by grep, not just absence):**

- No `directUrl` / `shadowDatabaseUrl` in `prisma/schema.prisma` — Prisma has
  exactly ONE datasource URL: `env("DATABASE_URL")`.
- No `new Pool` / `new Client` / `pg` import anywhere in `src/` — the
  application talks to Postgres ONLY through Prisma.
- No raw Postgres connection in any component, hook, or API route.
- No Supabase Management API database connections outside `scripts/prod-migration/*`.
- `.env` (sandbox) holds a local SQLite file URL — production credentials are
  **not** in any repo file, shell env, or script (`DATABASE_URL` on Vercel is a
  Sensitive env var; the DB password is owner-held).
- Backup/restore scripts are production-refusing by design; production backup
  layers are Supabase platform backups (pending owner action, `docs/DISASTER_RECOVERY.md` §6)
  plus the owner-run logical dump **over the pooler** (§4.4 below).

**Migration-channel answer:** production migrations do NOT use the same
connection path as runtime in the authoritative pipeline (Management API,
HTTPS). The Vercel build-time `prisma migrate deploy` DOES use the exact same
pooler URL and engine as runtime.

---

## 2. Phase 2 — Live production connection audit (read-only evidence)

Captured 2026-10-06T14:50–15:05 UTC via the pooler (postgres role, read-only
queries only):

1. **Active production endpoint** (runtime + Vercel-build migrations):
   `aws-0-ap-south-1.pooler.supabase.com:5432`, user
   `postgres.kbyknezedewvgrnqervj`, database `postgres`,
   `connection_limit=2` — per `docs/VERCEL_PROJECTS.md` §2 and the
   `.env.example` template. DNS: **IPv4 only** (2× AWS ELB A records,
   ap-south-1).
2. **Vercel uses Supavisor: YES** — session mode (5432), not transaction mode.
3. **Port: 5432 session mode.** 6543 (transaction mode) is documented as an
   alternative in `.env.example` but is not used by either plane.
4. **SSL negotiated at the connection layer: YES at the client↔pooler hop**
   (Prisma `prefer` sends SSLRequest first; Supavisor completes TLSv1.3 — §4).
   The Supavisor→Postgres internal hop is **non-TLS** (Supabase internal
   network; see the `pg_stat_ssl` nuance in §4.5).
5. **PostgreSQL ssl state:** `ssl = on`, `ssl_min_protocol_version = TLSv1.2`,
   no max (server accepts up to TLSv1.3). Server version **17.11** confirmed.
6. **SSL enforcement setting: OFF** — behavioral proof: a client that
   explicitly disables TLS (`sslmode=disable`) is **accepted** on both 5432
   and 6543 today (§4.2). (Owner statement concurs; Management API state
   unreadable from this vantage — no access token in the sandbox.)
7. **Active non-SSL connections:** none from external clients. All current
   backends are Supabase-internal: Supavisor server connections (ssl=false,
   internal IPv6 source), PostgREST/`authenticator`, pg_cron, pg_net,
   postgres_exporter, supabase_admin (several on ::1 with ssl=true).
8. **pg_stat_ssl:** aggregate 5× `ssl=false` / 3× `ssl=true`; per-backend
   detail captured in the probe transcript. `pg_hba_file_rules` is **not
   readable** by the `postgres` role on Supabase (not a true superuser) —
   documented limitation; enforcement state was proven behaviorally instead.
9. **Prisma SSL configuration requirement: none.** Unset `sslmode` defaults to
   prefer (TLS attempted — proven in §4.3); explicit `?sslmode=require` also
   works. Pinning `sslmode=require` in the Vercel `DATABASE_URL` is
   recommended-but-optional (§5, owner action 1).
10. **Migrations vs runtime:** Vercel-build migrations = same pooler path and
    engine as runtime. Authoritative production-migration pipeline =
    Management API HTTPS (never a Postgres socket).

Live production health during the audit (unchanged by any probe — all
read-only): both planes `/health/ready` → 200 `database:ok` (273 ms / 228 ms);
`/platform/login`, `/s/green-valley/login`, `/s/hawkings-prithvipur/login`,
`/login` → 200; cross-plane isolation 404s intact; `_prisma_migrations`
15/15 (latest `20261006123000_least_privilege_grants` @ 2026-10-06T14:23:33Z).

---

## 3. Phase 3 — Supabase configuration audit

### 3.1 SSL enforcement (official docs, verified current)

From `https://supabase.com/docs/guides/platform/ssl-enforcement`:

- A project "supports connecting to the Postgres DB without SSL enabled to
  maximize client compatibility"; enforcement prevents non-SSL clients.
- **Scope of the toggle:** "Disabling SSL enforcement only applies to
  connections to Postgres, Supavisor (shared Connection Pooler) and PgBouncer
  (dedicated Connection Pooler); all HTTP APIs offered by Supabase
  (e.g., PostgREST, Storage, Auth) automatically enforce SSL on all incoming
  connections." → **the toggle governs exactly the surfaces we use for
  Postgres traffic (pooler) and nothing our browser-facing planes rely on.**
- **Enabling/updating triggers a fast database reboot** — seconds on small
  projects, longer on larger ones. (Dashboard wording: restarts only the
  database, a few minutes of downtime.) Our DB is ~67 MB / 8,859 rows.
- Management: dashboard (Database Settings → SSL Configuration → "Enforce SSL
  on incoming connections"), Management API
  `GET/PUT /v1/projects/{ref}/ssl-enforcement` with
  `{"requestedConfig":{"database":true}}`, or CLI
  `supabase ssl-enforcement`. **Requires Owner/Admin.**

### 3.2 Network restrictions (official docs, verified current)

From `https://supabase.com/docs/guides/platform/network-restrictions`:

- Restrictions control which IP ranges can connect to **Postgres and its
  pooler** ("all connection routes, whether pooled or direct"), enforced
  **before traffic reaches the database**; connections still authenticate.
- **Limitations (verbatim, decisive for §6):** "Network restrictions apply to
  Postgres and the database pooler. They don't apply to HTTPS APIs such as
  PostgREST, Storage, and Auth, or to Supabase client libraries like
  supabase-js."
- If direct connections resolve to IPv6, **both IPv4 and IPv6 CIDRs** must be
  allowlisted. Removing restrictions = `update --db-allow-cidr 0.0.0.0/0
  --db-allow-cidr ::/0`. Requires Owner/Admin; CLI ≥1.22, `--experimental`.

### 3.3 Current exposure state of project `kbyknezedewvgrnqervj`

| Surface | Address | Reachability from audit vantage |
| --- | --- | --- |
| Direct database | `db.kbyknezedewvgrnqervj.supabase.co:5432` | **IPv6-only** (AAAA `2406:da1a:b00:1300:…`); no IPv4 → **IPv4 add-on not purchased**. Sandbox has no IPv6 egress (`ENETUNREACH`) → direct probes impossible from this vantage (documented limitation; production does not use this path) |
| Supavisor pooler | `aws-0-ap-south-1.pooler.supabase.com:5432/6543` | Public IPv4 (AWS ELB) — accepts **both TLS and plaintext today** (enforcement OFF) |
| API origin (PostgREST/Storage/Realtime REST) | `kbyknezedewvgrnqervj.supabase.co:443` | IPv4 via Cloudflare; live TLS check: **TLSv1.3, verification OK** |
| Management API | `api.supabase.com:443` | Public HTTPS, bearer-token protected |

- **Allowed IP ranges:** effectively unrestricted — the audit vantage
  (arbitrary sandbox IP) and Vercel's dynamic pool both connect freely;
  state consistent with "restrictions never applied" (docs: empty CIDR list +
  `applied=false` ⇒ all IPs can connect). Exact dashboard state requires the
  owner's view (no access token in the sandbox).
- **Management API exposure:** token-gated (HTTPS), not IP-restricted — by
  design and unaffected by anything in this phase.

---

## 4. Phase 4 — SSL compatibility tests (all read-only)

### 4.1 TLS acceptance at the pooler front door

```
openssl s_client -starttls postgres -connect aws-0-ap-south-1.pooler.supabase.com:5432
  → CONNECTION ESTABLISHED, Protocol version: TLSv1.3,
     Ciphersuite: TLS_AES_256_GCM_SHA384, chain: Supabase Root 2021 CA
openssl s_client -starttls postgres -connect …:6543   → identical result
```

The pooler **offers and completes TLS on both session (5432) and transaction
(6543) ports today**. (Chain root is Supabase's own CA — the reason
verification-based modes need their CA; `sslmode=require` semantics =
encrypt-without-verify, which is the standard Supabase posture.)

### 4.2 Plaintext acceptance (enforcement OFF — behavioral proof)

node-pg with `ssl:false` (equivalent of `sslmode=disable`):

| Endpoint | Result |
| --- | --- |
| pooler 5432 (session) | **connect OK (plaintext accepted)** |
| pooler 6543 (transaction) | **connect OK (plaintext accepted)** |
| direct 5432 | unreachable from vantage (IPv6-only host, no v6 egress) |

→ SSL enforcement is **OFF** today at both client-facing Postgres surfaces.
This is the exact behavior that the enforcement toggle removes.

### 4.3 Prisma (the production client) — wire-level experiment

A local TCP proxy on a **non-loopback** sandbox IP logged the first packet of
each Prisma engine connection and answered any TLS attempt with `'N'`
(server-refuses-SSL), relaying plaintext to the real pooler:

| Prisma `DATABASE_URL` | First packet on the wire | After `'N'` refusal | Verdict |
| --- | --- | --- | --- |
| **no `sslmode` param (production parity)** | `SSLRequest` (8 bytes, `04D2162F`) | **continued in plaintext** (query OK) | **`prefer` semantics — TLS is attempted FIRST; plaintext only if the server refuses** |
| `?sslmode=require` (control) | `SSLRequest` | **aborted** — "Error opening a TLS connection: … server does not support TLS" | require semantics — validates the method |

Combined with 4.1 (Supavisor always completes the TLS handshake) this proves:
**production Prisma connections are already encrypted today** (client↔pooler,
TLSv1.3), with zero configuration. Under enforcement nothing changes for
them — the server answer to SSLRequest stays `'S'`.

Direct-to-pooler Prisma tests (no proxy) also pass both with no `sslmode`
and with `sslmode=require` (both `SELECT 1` OK).

### 4.4 node-pg channels (ops scripts / DR logical dump)

pg 8.23.1 URL parsing (verified live, matches pg-connection-string warning):

| DSN form on the pooler | Result |
| --- | --- |
| no `sslmode`, no `ssl` option | connects **plaintext today** (would be rejected under enforcement) |
| `?sslmode=require` | **FAILS — "self-signed certificate in certificate chain"** (pg ≥8.11 treats require as verify-full alias) |
| `?uselibpqcompat=true&sslmode=require` | **connects with TLS — OK** (verified) |
| programmatic `ssl: { rejectUnauthorized: false }` | connects with TLS — OK (used by the audit probes) |

→ The only production-reaching node-pg channel is the owner-run DR logical
dump (`docs/DISASTER_RECOVERY.md` §5 layer 2, run from an isolated env dir over the
pooler). **Post-enforcement, that DSN must use
`?uselibpqcompat=true&sslmode=require`** (noted in the DR doc by this audit —
docs change only, no code). All other node-pg consumers are local-dev/CI and
connect to local Postgres — unaffected.

### 4.5 The `pg_stat_ssl` nuance (why the view shows `ssl:false` through the pooler)

`SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()`
through Supavisor returns `{"ssl":false,…}` **even for a TLS-forced client** —
because the visible backend is Supavisor's internal server-side connection,
not the client connection. This was confirmed by experiment (identical
`ssl:false` row for TLS and plaintext clients). The internal hop
(Supavisor→Postgres, private IPv6 network) is non-TLS **by Supabase design**;
the enforcement toggle governs the client-facing hop. True client-side TLS
state is proven by the STARTTLS handshake (4.1) and the wire-level proxy
experiment (4.3). On a **direct** connection, `pg_stat_ssl` would show the
real client state — untestable from this vantage (no IPv6 egress), and unused
by production.

---

## 5. Phase 5 — SSL enforcement impact analysis (if the toggle is turned ON)

### PRODUCTION

| Surface | Impact | Why |
| --- | --- | --- |
| Vercel runtime Prisma (both planes) | **none — keeps working** | prefer/require both complete TLS today; server keeps answering `'S'` |
| Vercel build `prisma migrate deploy` | **none** | same engine, same URL, same TLS behavior |
| Authoritative migration pipeline | **none** | Management API HTTPS, not a Postgres connection |
| `/health/ready`, heartbeat | **none** (rides Prisma) | probe = `db.$queryRaw SELECT 1` |
| Production login / tenant resolution | **none** | same Prisma path |
| Storage (school-media signed URLs, public-media) | **none** | HTTPS API, TLS already enforced there (docs + live check) |
| Realtime Broadcast (WSS + REST publish) | **none** | same |
| DR logical dump (owner-run) | **breaks unless DSN corrected** | §4.4 — use `uselibpqcompat=true&sslmode=require` |
| **Downtime from the toggle itself** | **brief DB reboot** | official docs; seconds expected on ~67 MB, plan minutes; `/health/ready` will 503 during it and `withDbRetry` absorbs the blips; schedule a low-traffic window |

### DEVELOPMENT (Supabase branches / staging projects)

Each branch/staging project has its **own** SSL-enforcement state — enabling
it in production changes nothing for them, and testing it on a branch changes
nothing in production (§7).

### LOCAL

Unaffected. Local dev uses a local database (embedded PG / SQLite file in
`.env`); no Supabase Postgres connection exists locally.

### CI

Unaffected. Tests run against local Postgres; release workflows use the
Management API (HTTPS).

---

## 6. Phase 6 — Network restrictions analysis

**Do Vercel serverless functions have stable outbound IPs? NO.**

Vercel Knowledge Base — *"How can I allowlist IP addresses for a deployment?"*
(Nov 2025), verified current:

> "By default, Vercel routes outbound requests from your builds and Vercel
> Functions through a **dynamic range of IP addresses**, so there's no fixed
> address to add to that allowlist… Dynamic egress: outbound requests from
> builds and Vercel Functions can leave from **any address in the pool**,
> which can change between requests."

### Why IP restriction is unsafe for this architecture

- Both production planes connect to Postgres **through the Supavisor pooler
  from Vercel's dynamic egress pool**. Any allowlist we could write today
  would be a guess; Vercel traffic can leave from any pool address and
  **changes between requests** → an "allowlist" either blocks production
  intermittently (broken site) or degenerates to `0.0.0.0/0` (fake security).
- The task rules out introducing NAT gateways, proxies or new infrastructure
  — correct for this phase; and none would be needed for the security goal,
  because the database's real protection layers are already in place:
  **SCRAM-SHA-256 password auth + TLS (once enforced) + least-privilege
  grants (applied 2026-10-06) + deny-by-default RLS (112/112)**.
- Additional official facts that make restrictions unattractive here:
  restrictions do **not** cover the HTTPS APIs (PostgREST/Storage/Auth) — the
  browser-facing surfaces stay open regardless — and our direct endpoint is
  IPv6-only (would additionally need v6 CIDRs for any direct-path filtering).

**Verdict: Network restrictions = UNSAFE / NOT RECOMMENDED under the current
architecture. Do not enable. Do not fabricate an allowlist.**

### Documented alternatives (NOT introduced, for a future decision only)

1. **Vercel Static IPs** (Pro/Enterprise, GA Oct 2025): routes Functions
   egress (and optionally build egress) through **consistent regional IP
   pairs** via a managed NAT in a shared VPC. *If* the team later adopts it,
   the regional pair(s) (e.g. `bom1` adjacent to `ap-south-1`) become the
   honest allowlist for Supabase network restrictions. Requires a plan check
   (team `signature4748-2940`) and a cost/Private-Data-Transfer evaluation.
2. **Vercel Secure Compute** (Enterprise): dedicated VPC + static IP pair +
  optional VPC peering.
3. **Supabase PrivateLink** (Enterprise): private connectivity, bypasses
  public exposure entirely.

None of these are changes of this phase. A future static-egress architecture
would be its own reviewed phase.

---

## 7. Phase 7 — Safe test plan (PREPARED ONLY — not executed)

Target environment: a **Supabase branch** (development). Branches are
environments, never school tenants — exactly one branch is needed for this
test.

1. **Create/confirm one dev branch** of project `kbyknezedewvgrnqervj`
   (Supabase dashboard → Branches; or `supabase branches create`). Note its
   pooler endpoint and password.
2. **Baseline probes on the branch (enforcement still off):** run §4.1/§4.2
   probes against the branch pooler (STARTTLS OK; plaintext accepted) —
   proves the test harness discriminates.
3. **Enable SSL enforcement on the branch only** (branch Database Settings →
   SSL Configuration, or Management API against the branch ref). Expect the
   branch DB's brief reboot.
4. **Negative probe:** `sslmode=disable` connection attempt to the branch
   pooler → must now be **rejected** (this is the pass condition; expect a
   TLS/SSL-required error, not auth success).
5. **Prisma query:** `DATABASE_URL=<branch pooler 5432, no sslmode>` →
   `$queryRaw SELECT 1` must succeed (proves prefer semantics).
6. **Migration status:** `DATABASE_URL=<branch pooler> bunx prisma migrate
   status` → must report 15/15 applied, zero pending, no drift.
7. **Application health:** point a **preview deployment** of `scholario-app`
   (Vercel preview env `DATABASE_URL` = branch pooler) at the branch →
   `/health/ready` 200 `database:ok`.
8. **Login + tenant resolution:** preview `/s/green-valley/login` 200 and a
   real login round-trip; verify tenant lookup query in logs.
9. **Storage + Realtime:** fetch one `public-media` object (200); open the
   realtime config route + subscribe a broadcast channel and deliver a
   service-role REST broadcast (frame received).
10. **Verify zero TLS errors** in preview function logs (no
    `self-signed certificate`, no `server does not support TLS`, no P1001/P1017
    storms). Only after all ten steps pass, consider production (§8).

Production-day runbook (after owner approval): schedule low-traffic window →
optionally pin `sslmode=require` in the Vercel `DATABASE_URL`s and redeploy
first (recommended ordering so the pin is active before the toggle) → toggle
enforcement (dashboard or `PUT /v1/projects/kbyknezedewvgrnqervj/ssl-enforcement`
`{"requestedConfig":{"database":true}}`) → expect the brief reboot →
re-run the §2 live matrix (health, logins, cross-plane 404s) + a Prisma CRUD
probe + the §4.2 negative probe (now must fail) → confirm both planes green.

---

## 8. Phase 8 — NO-CHANGE GATE (awaiting explicit owner approval)

**CURRENT**
- SSL enforcement = **OFF** (verified behaviorally: plaintext accepted on
  5432/6543; owner-stated)
- Network restrictions = not applied (effectively unrestricted ingress to
  Postgres/pooler)

**TARGET (this gate)**
- SSL enforcement = **ON** for database
- Network restrictions = **unchanged (OFF)** — not recommended, §6

**Expected impact (exact evidence):**
- Prisma runtime + build migrations: no impact — already TLS, prefer/require
  both verified against the live pooler (§4.1–§4.3)
- Storage / Realtime / PostgREST: no impact — HTTP plane enforces TLS
  independently (§3.1, live TLSv1.3 verification OK)
- Migration pipeline (Management API): no impact (HTTPS)
- DR logical dump: requires the corrected DSN
  (`?uselibpqcompat=true&sslmode=require`) — documented in
  `docs/DISASTER_RECOVERY.md` §5 by this audit
- **One brief database reboot at toggle time** (seconds expected on ~67 MB;
  plan minutes) — `/health/ready` 503 during it, `withDbRetry` absorbs blips

**Production connection (endpoint type):** Supavisor **session-mode pooler**,
`aws-0-ap-south-1.pooler.supabase.com:5432`, IPv4 AWS ELB, user
`postgres.<ref>`, `connection_limit=2`, TLS already negotiated (TLSv1.3).

**Migration connection (endpoint types):**
(a) authoritative pipeline = Management API HTTPS (unaffected);
(b) Vercel-build `prisma migrate deploy` = same Supavisor session pooler as
runtime (unaffected, TLS already negotiated).

**Rollback (exact procedure):** dashboard Database Settings → SSL
Configuration → disable "Enforce SSL on incoming connections", or
`PUT /v1/projects/kbyknezedewvgrnqervj/ssl-enforcement` with
`{"requestedConfig":{"database":false}}` (or CLI
`supabase ssl-enforcement update --disable-db-ssl-enforcement`). Causes the
same brief reboot; no schema, data, grant, RLS or code change is involved, so
nothing else needs undoing. Plaintext acceptance returns immediately after.

**Network restrictions:** **NOT RECOMMENDED** (unsafe — Vercel dynamic
egress; §6).

**Nothing above was executed by the audit itself. Awaiting explicit owner
approval before any production change.**

**RESOLUTION (2026-10-06, later the same day):** owner approval was granted;
the toggle was found ENABLED at execution time (first confirmed
2026-10-06T17:12:53Z — activation record §11, all checks green). Network
restrictions remain OFF per the §6 recommendation.

---

## 9. Final report (14 items)

1. **Current SSL state:** enforcement OFF (behaviorally proven + owner
   stated); Postgres `ssl=on`, TLSv1.2–1.3 capable; plaintext accepted on
   both pooler ports.
2. **Actual TLS usage:** production Prisma = TLS **today** (prefer →
   SSLRequest first; Supavisor completes TLSv1.3/AES-256-GCM). node-pg DR
   channel = plaintext today. Management API/migrations = TLS (HTTPS).
   Storage/Realtime/PostgREST = TLS (HTTPS, verification OK).
3. **Connection paths:** 8 inventoried (§1); production uses exactly: Prisma
   → Supavisor 5432 session (runtime + build migrations) and Management API
   HTTPS (authoritative migrations).
4. **Pooler/direct usage:** pooler session 5432 exclusively; direct endpoint
   is IPv6-only and unused (no IPv4 add-on).
5. **Prisma compatibility:** proven compatible under enforcement (prefer and
   require both tested live; wire-level semantics proven).
6. **Migration compatibility:** Vercel-build migrations compatible (same
   engine/URL); Management-API pipeline unaffected (HTTPS).
7. **Backup/restore compatibility:** Supabase platform backups unaffected
   (still pending as an owner action per DR doc); logical dump needs the
   `uselibpqcompat=true&sslmode=require` DSN (docs updated; no code change).
8. **Vercel compatibility:** both planes verified healthy during the audit;
   no impact from enforcement (TLS already in use).
9. **Network restriction analysis:** UNSAFE/NOT RECOMMENDED — Vercel dynamic
   egress pool changes between requests; alternatives documented only
   (Vercel Static IPs / Secure Compute / PrivateLink).
10. **Recommended production setting:** SSL enforcement **ON**; network
    restrictions **OFF**; optionally pin `sslmode=require` on the Vercel
    `DATABASE_URL`s first.
11. **Exact change required:** dashboard toggle or Management API
    `PUT /v1/projects/kbyknezedewvgrnqervj/ssl-enforcement
    {"requestedConfig":{"database":true}}` (Owner/Admin) at a low-traffic
    window. Zero code/schema changes.
12. **Exact rollback:** `PUT …/ssl-enforcement {"requestedConfig":{"database":false}}`
    (or dashboard toggle) — brief reboot, nothing else to undo (§8).
13. **Risks:** brief reboot (health-check 503s, transient P100x absorbed by
    retry); DR-dump DSN misuse (mitigated: documented); engine-default drift
    (mitigated: optional `sslmode=require` pin); sandbox vantage limits
    (direct endpoint and pg_hba unreadable — mitigated by behavioral proofs).
14. **Owner action required:** (1) optional: pin `sslmode=require` in
    `DATABASE_URL` on all three Vercel projects + redeploy; (2) optionally run
    the §7 branch test; (3) approve + perform the enforcement toggle in a
    scheduled window (Owner/Admin dashboard or Management API); (4) post-toggle
    verification (re-run this audit's live matrix — read-only probes on
    request); (5) keep network restrictions OFF unless a future static-egress
    phase is deliberately adopted; (6) pre-existing inherited actions (Resend
    key, `scholario-production` decommission, Pro/PITR backup decision) are
    unchanged and out of scope here.

**Classification: B. READY FOR SSL ENABLEMENT WITH OWNER ACTION.**

---

## 10. Method appendix (reproducible, read-only, secret-free)

- SQL probes (via pooler, postgres role): `pg_stat_ssl` self + aggregate +
  join with `pg_stat_activity`; `pg_settings` ssl*; `_prisma_migrations`
  census; `current_setting('server_version')`; `inet_server_addr()/port()`.
  (`pg_hba_file_rules` → permission denied — documented.)
- TLS probes: `openssl s_client -starttls postgres` (pooler 5432/6543, API
  origin 443).
- Behavioral enforcement probe: node-pg `ssl:false` connect matrix.
- Prisma TLS-semantics probe: non-loopback TCP proxy classifying the first
  packet (SSLRequest vs startup) and answering `'N'`; control run with
  `sslmode=require`.
- node-pg DSN matrix: `sslmode=require` vs `uselibpqcompat=true&sslmode=require`.
- HTTP checks: both planes `/health/ready`, login doors, cross-plane 404s.
- Docs (fetched 2026-10-06, official):
  `supabase.com/docs/guides/platform/ssl-enforcement`,
  `supabase.com/docs/guides/platform/network-restrictions`,
  `vercel.com/kb/guide/how-to-allowlist-deployment-ip-address`,
  `vercel.com/changelog/static-ips-are-now-available-for-more-secure-connectivity`,
  `vercel.com/changelog/route-build-traffic-through-static-ips`.
- No credentials, tokens, or passwords are recorded in this document.

---

## 11. Activation record — SSL enforcement ENABLED (2026-10-06)

> Owner approval was granted ("Enable Supabase Postgres SSL enforcement for
> production"). At execution time the toggle was found **already ON** — it
> was flipped outside this session (this sandbox holds no Management API
> token and performed zero changes; Owner/Admin dashboard access is the only
> other holder). The observed state equals the approved target state, so this
> session proceeded directly to verification and documentation.

**Activation window (bounded by live behavioral probes):**

- Last confirmed **OFF**: 2026-10-06 ~15:05 UTC (§4.2 — plaintext accepted on
  pooler 5432 and 6543)
- First confirmed **ON**: **2026-10-06T17:12:53Z** (execution probe —
  plaintext REJECTED on both pooler ports with
  `ESSLREQUIRED: SSL connection is required for user: postgres`). The exact
  toggle time is not observable from this vantage (no Management API token;
  `currentConfig` unreadable) — recorded honestly as the bounded window
  15:05–17:12 UTC.

**Post-enforcement verification (all read-only, 2026-10-06T17:12–17:14Z):**

| # | Check | Result |
| --- | --- | --- |
| 1 | Plaintext (ssl:false) pooler :5432 | **REJECTED — ESSLREQUIRED** ✓ enforcement effective |
| 2 | Plaintext (ssl:false) pooler :6543 | **REJECTED — ESSLREQUIRED** ✓ |
| 3 | TLS (`uselibpqcompat=true&sslmode=require`) pooler :5432 | connect + query OK |
| 4 | TLS (`uselibpqcompat=true&sslmode=require`) pooler :6543 | connect + query OK |
| 5 | Prisma **production-parity** (no sslmode — the exact Vercel `DATABASE_URL` form) | connect OK 1387 ms · `SELECT 1` OK · `pg_stat_ssl` = **ssl=true, TLSv1.3, TLS_AES_256_GCM_SHA384** |
| 6 | Prisma `sslmode=require` (optional pin form) | connect OK · `SELECT 1` OK |
| 7 | PostgreSQL settings via pooler | `ssl=on`, min TLSv1.2, server 17.11 |
| 8 | Supavisor/DB connectivity (A/B) | checks 3–7 above |
| 9 | `scholario-platform` `/health/ready` | **200** `database:ok` (224 ms) |
| 10 | `scholario-app` `/health/ready` | **200** `database:ok` (212 ms) |
| 11 | Green Valley door `/s/green-valley/login` | **200** |
| 12 | Hawkings door `/s/hawkings-prithvipur/login` | **200** |
| 13 | Authenticated API smoke: `POST /api/auth/login` (wrong credentials) | clean **401** `{"ok":false,"error":"Invalid email or password","code":"AUTH_REQUIRED"}` — exercises the full Prisma User lookup + scrypt verify + audit-write path; no 5xx |
| 14 | Cross-plane isolation | `/s/green-valley/login` on platform → **404**; `/platform/login` on app → **404** |
| 15 | Direct endpoint `db.<ref>.supabase.co:5432` | not resolvable at this time (NXDOMAIN, A and AAAA, via authoritative DNS) — platform-side observation; unused by production, which runs the IPv4 Supavisor path (checks 3–7) |

**Notes:**

- `pg_stat_ssl` through the pooler now reports `ssl=true` (TLSv1.3) for the
  probe backend — at audit time the visible Supavisor→Postgres hop showed
  `ssl=false` (§4.5). Post-activation, the pooler's server-side connection
  is TLS as well. The client-facing behavior is what the toggle governs:
  plaintext is now refused at the front door.
- The DR logical-dump DSN requirement is now **operative**: node-pg dump/ops
  connections MUST use `?uselibpqcompat=true&sslmode=require` (a bare or
  no-sslmode DSN is now rejected — verified live, check 1). Recorded in
  `docs/DISASTER_RECOVERY.md` §5 layer 2.
- No external incident was observed around the toggle: all checks healthy in
  the 17:12–17:14Z window; any reboot blips were absorbed by `withDbRetry`
  as predicted in §5.
- Prisma production connections continue to work unchanged — confirmed three
  ways: sandbox Prisma probe with the exact production DSN form (check 5),
  both planes' `/health/ready` Prisma probes (checks 9–10), and the
  production login API round-trip (check 13).
- Nothing else changed: no `DATABASE_URL`, no Vercel env, no Prisma schema,
  no application code, no credentials, no RLS/grants, no network restrictions
  (still OFF — not recommended, §6).

**Final classification:**

- **SSL enforcement: ENABLED**
- **Network restrictions: NOT ENABLED** (remains not recommended — §6)
- **Production health: VERIFIED**
