# Platform Operations Center

> The Super Admin observability, usage & limits, error diagnosis and
> service-health surface — `/platform/operations` (capability
> `ops.read`). Everything in the center is REAL data with a source and
> an observation time; anything the connected provider APIs/plans do
> not expose is rendered **honestly as unavailable** — never as zero,
> never as healthy, never fabricated.

## Where it lives

| Piece | Location |
| --- | --- |
| Console page | `src/app/platform/(console)/operations/page.tsx` → `src/components/platform/modules/operations/` (one module per tab) |
| API routes | `src/app/api/platform/operations/*` (+ `src/app/api/cron/ops-sync/route.ts` for the Vercel cron) |
| Core libs | `src/lib/ops/` — `types.ts` (normalized metric model), `fetch.ts` (bounded provider HTTP), `sync.ts` (the only snapshot writer), `errors.ts` (fingerprints + capture), `alerts.ts` (thresholds + dedup), `health.ts` (check suite), `usage-meter.ts` (tenant attribution), `diagnose.ts` (rules), `coverage.ts` (coverage map), `quota.ts` (pure quota math) |
| Provider adapters | `src/lib/ops/providers/` — `vercel.ts`, `supabase.ts`, `resend.ts` |
| Schema | 9 additive models, migration `20261021000000_platform_operations_center` |
| Tests | `tests/unit/ops-*.test.ts`, `tests/security/ops-isolation.test.ts` |

## Capability model

`ops.read` (root admins hold it implicitly; non-root admins need an
explicit grant; unknown keys fail closed — `src/lib/platform/permissions.ts`).
The middleware's platform-API boundary + `withPlatform` enforce it on
every server request; hiding the nav entry for non-holders is UX only.

## The six tabs

1. **Overview** — tenant KPIs, platform auth failures (7d), DB
   connectivity, unresolved incidents, email outbox (accepted ≠
   delivered), latest production deployments, usage vs reported limits,
   open alerts, per-provider data freshness.
2. **Usage & Limits** — provider metrics from STORED snapshots (never a
   live provider call on the read path), per-metric value/limit/%
   consumed/remaining/collected-at/staleness, sync-run history, and the
   manual **Sync now**. Missing metrics show the honest reason
   (plan-restricted / endpoint-unavailable / not-configured /
   not-reported) with a link to the provider dashboard.
3. **Errors & Incidents** — fingerprinted error groups (5xx API
   failures, cross-tenant denials, provider sync failures, failed
   health checks, webhook failures) with filters, pagination,
   occurrence history, related audit rows, ack/resolve (audited) and
   the **rule-based diagnosis** (confirmed / likely /
   insufficient-evidence — each verdict lists its exact evidence and
   the next safe step).
4. **Service Health** — liveness/readiness/dependency split; the check
   suite (db connectivity, db size, config presence, Resend API,
   Supabase Management API, Vercel API, email failure rate, sync
   freshness) runs on demand and persists to `MonitoringCheck`;
   threshold settings editor (audited); alert list with ack/resolve.
5. **School Usage** — per-school app-measured metrics (API operations
   via atomic daily counters, DAU/MAU from activity markers, logins
   from `ActivityLog`, emails from `EmailDelivery`, uploads from
   `UploadedFile`) with date ranges + drill-down. Shared provider
   usage is explicitly NOT attributed per school.
6. **Audit & Diagnostics** — the monitoring-coverage map
   (instrumented / partial / not instrumented, with mechanisms and
   gaps), ops action history from the platform audit trail, retention
   state + manual cleanup, and the honest known-gaps list.

## Data flow contracts

- **Reads never call providers.** Dashboards read
  `ProviderUsageSnapshot`; freshness is computed at read time. Stale
  data schedules a background refresh via Next `after()` (the response
  is never delayed), a manual Sync runs the adapters live, and the
  daily Vercel cron (`vercel.json` → `/api/cron/ops-sync`, guarded by
  `OPS_CRON_SECRET` or a platform session) keeps a baseline.
- **Error capture is centralized**, not per-route: the `api()`
  envelope already funnels every API failure through `classifyError`;
  the operations center records the incident-meaningful classes (5xx,
  `TENANT_MISMATCH`, `EXTERNAL_SERVICE_FAILURE`) and deliberately
  ignores benign 4xx security surface. Capture is fire-and-forget —
  monitoring can never become a new failure mode.
- **Tenant attribution is server-derived only**: usage metering uses
  the authenticated identity from `withUser` (never a client-supplied
  school id), with atomic upsert increments.
- **Alerts dedup by `(type, metricKey)`**: one open alert per breached
  metric; escalations re-surface acknowledged alerts; returns within
  threshold auto-resolve; every transition is audited
  (`platform.ops.alert.*`).

## Environment (server-only)

| Variable | Purpose |
| --- | --- |
| `OPS_VERCEL_TOKEN` | Vercel API (projects + deployment facts). Unset → "Not configured" honestly. |
| `OPS_VERCEL_TEAM_ID` / `OPS_VERCEL_PROJECTS` | Optional scoping. |
| `OPS_SUPABASE_ACCESS_TOKEN` | Supabase Management API (per-service platform health). |
| `OPS_CRON_SECRET` | Cron endpoint bearer secret. |
| `SUPABASE_PROJECT_REF` | Optional ref override (derived from `SUPABASE_URL`). |

`RESEND_API_KEY` / `DATABASE_URL` are reused from the existing stack.

## Verified provider availability (live-probed 2026-10-20)

| Provider | Available | Not available (shown honestly) |
| --- | --- | --- |
| Vercel | projects, production deployments (states + SHAs + URLs), domains | usage metrics — API answers `plan_upgrade_required` (Hobby team): **"Not available through the connected API/plan"** + dashboard link |
| Supabase | project identity, per-service health (db/storage/auth/realtime/rest/pooler), database size + connections via direct SQL | usage/quotas (egress, MAU, storage, invocations) — Management API 404s on this account |
| Resend | domain verification status, per-message `last_event` (real delivery evidence), counted outcomes | plan send quota — not exposed by the API |

**Costs are never estimated** from usage — no billing API is connected;
usage-to-cost conversion would be fabrication (the UI states this).

## Retention

| Data | Kept |
| --- | --- |
| Usage snapshots | 90 days (pruned by the retention job) |
| Error occurrence events | 14 days (group counters persist) |
| Monitoring-check history | 30 days |
| Error groups, alerts (current episode), audit rows, usage rollups | permanent |

## Honest known gaps (also rendered in the UI)

- Browser-side exceptions are not collected server-side (render errors
  surface through the log stream — `src/instrumentation.ts` documents
  the edge-sandbox constraint).
- No alert notification channel is configured (alerts are visible in
  the dashboard + audit trail only).
- Shared provider usage (bandwidth/compute/egress) cannot be attributed
  per school — by provider API design.
