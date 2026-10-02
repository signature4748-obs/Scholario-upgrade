# SCHOLARIO-OS — Multi-Tenant Custom Domain Architecture (Phase 8B)

One application serves many schools. A school's own domain
(`school-a.com`, `school-b.in`, `school-c.edu.in`) resolves THAT school's
public website, branding and login portal — while all authenticated data
paths stay session-scoped and tenant-isolated in the same database.

```
CUSTOM DOMAIN (school-a.com)
        ↓ DNS (CNAME → cname.vercel-dns.com / A → 76.76.21.21)
VERCEL DEPLOYMENT (scholario-production, region bom1, same region as Supabase)
        ↓ Host header (normalized)
VERIFIED DOMAIN MAPPING (TenantDomain row, hostname globally unique)
        ↓
SAME SCHOLARIO APPLICATION (/ — SPA shell)
        ↓ /api/schools/public (no-store, Vary: Host)
TENANT-SCOPED PUBLIC CONTENT + LOGIN BRANDING
        ↓ login → server-side session (User.schoolId)
TENANT-SCOPED DATABASE/API (withUser/withAuthz on every route)
```

## Domain model (prisma, migration 20261002000000_phase8b_…)

`TenantDomain`: `schoolId`, `hostname` (normalized, **globally UNIQUE**),
`isPrimary`, `status` PENDING|VERIFIED, `verificationToken`,
`lastCheckedAt/lastCheckResult`, `createdAt`, `verifiedAt`.

Uniqueness is a storage-layer guarantee: duplicate domains and
cross-tenant collisions are structurally impossible (P2002 → clean 409).

## Tenant resolution (src/lib/tenant/)

`resolution.ts` — `resolvePublicSchool(req)`, priority:
1. **Host header** (normalized by `hostname.ts`: lowercase, no protocol,
   no port, no trailing dots, no leading `www.`):
   a. VERIFIED TenantDomain row → school (must be ACTIVE)
   b. legacy `School.domain` exact match (pre-8B admin path)
2. explicit `?slug=` (unknown slug fails-safe → null)
3. exactly-one-ACTIVE-school → that school
4. demo school fallback (sandbox/marketing)

Security properties: a hostile Host value can only fail to resolve —
never select another tenant; PENDING mappings never route traffic; the
`www.`/bare-host canonicalization removes ambiguity; sandbox hosts
(localhost/127.0.0.1/IPs/.local) never resolve a tenant.

**Resolution is NOT authorization.** It only selects public
branding/content. Every authenticated API derives the tenant from the
server-side session (`withUser` → `User.schoolId`) and enforces tenant
authorization independently (withAuthz + assertTenantRow + the
tenant-isolation test suites). Defense in depth.

## Cache isolation (§12)

- `/api/schools/public` → `Cache-Control: private, no-store` + `Vary: Host`
  on every response (200/404/429/500). Never CDN/proxy cached.
- `/api/public/notices/rss` → `private, max-age=60` + `Vary: Host`
  (browser-only freshness; shared caches excluded).
- Authenticated APIs use the `api()` envelope (no-store) as before.
- The app is a client-rendered SPA — no per-tenant static HTML exists to
  leak; images are per-file signed/gated URLs.
- Tested explicitly: consecutive A/B/A host requests never mix tenant
  payloads (tests/security/tenant-domains.test.ts).

## Onboarding flow (§25)

1. School is created (platform console, or future self-serve).
2. **Principal requests the domain**: School Settings → Identity →
   Custom Domain card → `POST /api/school/domains` (PENDING row minted
   with a random verification token + exact DNS instructions).
   Platform can also add it directly (`POST /api/platform/schools/[id]/domains`,
   schools.manage + step-up).
3. **DNS configuration** by the school:
   - TXT `_scholario-verify.<hostname>` = `scholario-verify=<token>`
   - CNAME `<hostname>` → `cname.vercel-dns.com` (subdomain) or
     A `<hostname>` → `76.76.21.21` (apex)
4. **Verification**: `POST /api/school/domains/[domainId]/verify`
   (principal self-service — DNS TXT proof IS the ownership act) or the
   platform verify endpoint. On TXT match → VERIFIED + verifiedAt.
5. **Platform attaches the domain to the Vercel project** (Vercel
   dashboard/API with the deployment token — runtime app code never sees
   the token). The mapping is live: the hostname now resolves the tenant.
6. The public website, login branding, notices RSS and public media gate
   all serve that school on that domain automatically.

## API surface

| Endpoint | Plane | Auth | Notes |
|---|---|---|---|
| GET /api/school/domains | school | PRINCIPAL/MANAGEMENT | own domains + instructions |
| POST /api/school/domains | school | PRINCIPAL/MANAGEMENT | request (≤10/school, rate-limited) |
| POST /api/school/domains/[id]/verify | school | PRINCIPAL/MANAGEMENT | DNS self-check, tenant-scoped 404 |
| GET/POST /api/platform/schools/[id]/domains | platform | schools.read / schools.manage+stepUp | list / add |
| POST …/domains/[id]/verify | platform | schools.manage | DNS check → VERIFIED |
| DELETE …/domains/[id] | platform | schools.manage+stepUp | remove mapping |

All writes are audit-logged (school ActivityLog DOMAIN_* vocabulary +
PlatformAuditLog platform.school.domain_*).

## Vercel note

The project (`scholario-production`, team `signature4748-2940`) is ready
for custom domains: attach the verified hostname in the Vercel project's
Domains settings (or via the Vercel API using the deployment token).
DNS records are the school's responsibility; verification state lives in
the database. Do not store user-provided URLs as trusted hostnames —
always go through the normalization + validation + TXT proof pipeline.

---

## Final acceptance: the two tenants' URLs

The production deployment serves BOTH permanent acceptance tenants from
the ONE Vercel project (no per-school deployments):

| Tenant | URL (until the school attaches a real domain) | What it is |
| --- | --- | --- |
| Hawkings High School Prithvipur | `https://scholario-production.vercel.app/?slug=hawkings-prithvipur` | the realistic demo tenant (full corpus) |
| Green Valley Public School | `https://scholario-production.vercel.app/?slug=green-valley` | the clean/real-school acceptance tenant (honest-empty) |
| Platform control plane | `https://scholario-production.vercel.app/platform` | provisioning, lifecycle, domains, readiness, audit |

The `?slug=` route is the SAFE TEMPORARY school-facing URL: it selects
PUBLIC CONTENT ONLY (public website + login branding — the tenant
resolution pipeline in `src/lib/tenant/resolution.ts`). It is NEVER an
authorization mechanism: authenticated data paths derive the tenant from
the server-side session (`withUser`), and a Host header that matches no
tenant fails closed. The bare deployment URL resolves the demo tenant
(the marketing default); an explicit unknown slug 404s.

**Attaching the real school domains later** (per-school DNS action, then):

1. The school's DNS admin points `hawkingshighschool.in` (example) at the
   Vercel project (CNAME or A records from the Vercel dashboard).
2. The platform console adds the hostname to the school
   (`POST /api/platform/schools/[id]/domains`) → the platform (or school)
   verifies ownership via the TXT record → the mapping flips to VERIFIED.
3. Host-header resolution then routes that domain to the tenant with zero
   code changes (the resolver checks VERIFIED TenantDomain rows first).
4. The `?slug=` routes keep working (they are the fallback while DNS is
   pending).

The legacy `School.domain` column remains as the admin-set pre-8B path
(`hawkings-high.scholario.app` on the demo tenant — a platform namespace
that carries no DNS authority).
