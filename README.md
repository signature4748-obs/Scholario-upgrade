# Scholario

Multi-tenant school management SaaS. One repository, one Postgres database,
two production deployments:

| Deployment | URL | Serves |
| --- | --- | --- |
| Platform (control plane) | https://scholario-platform.vercel.app | `/platform/*` console — schools, subscriptions, audit |
| School ERP | https://scholario-app-virid.vercel.app | `/s/<slug>/login` doors, `/login`, all school/ERP APIs |
| Legacy unified | https://scholario-production.vercel.app | **deprecated** — retained during the decommission window |

Each school is a tenant row in the shared database — no per-school repos,
projects, or databases. The `SCHOLARIO_PLANE` env var decides which half of
the route surface exists on a deployment (invalid values fail closed in
production — see `src/lib/plane.ts`).

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 + shadcn/ui
- PostgreSQL 17 on Supabase (Supavisor pooling) + Prisma ORM
- Storage & Realtime via Supabase server-side APIs
- Resend for transactional email
- Custom scrypt auth with HttpOnly cookies (no Supabase Auth) — see
  `docs/AUTH_ARCHITECTURE.md` for the decision record

## Local development

```bash
bun install
cp .env.example .env        # fill DATABASE_URL; everything else is optional
bun run db:push             # apply schema to your local Postgres
bun run dev                 # http://localhost:3000
```

Local dev runs in `unified` plane mode (both halves of the surface) with no
plane variable set.

## Tests

```bash
bunx tsc --noEmit                 # types
bun run lint                      # eslint
bun run test                      # unit + integration + api + regression + security
bun run test:e2e                  # end-to-end (needs the dev server running)
```

## Production

- Branch `main` is production; every push deploys both plane projects
  (and the deprecated legacy project) from the same commit.
- Database migrations run through the gated release pipeline — never in
  a build. See `docs/RELEASE.md`.
- Deployments, env vars, and the legacy decommission plan:
  `docs/VERCEL_PROJECTS.md`.

## Docs

| Doc | Contents |
| --- | --- |
| `docs/ARCHITECTURE.md` | System map + the 18 operational questions |
| `docs/AUTH_ARCHITECTURE.md` | Auth decision record (custom auth vs provider) |
| `docs/VERCEL_PROJECTS.md` | Deployment matrix, env vars, decommission runbook |
| `docs/SCHOOL_FACTORY.md` | Provisioning a school end-to-end |
| `docs/TENANT_ROUTING.md` | Tenant resolution + canonical school doors |
| `docs/EMAIL.md` | Resend integration + domain verification state |
| `docs/RELEASE.md` | Release pipeline and gates |
| `docs/DEPLOYMENT.md` | Day-2 operations |
