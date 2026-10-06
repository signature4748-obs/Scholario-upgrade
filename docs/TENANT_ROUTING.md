# Tenant Routing — public resolution, canonical doors, the security rule

> How a request becomes a tenant: what the URL may choose (public branding)
> and what it may never choose (authorization). Companion docs:
> `docs/ARCHITECTURE.md` (system map), `docs/CUSTOM_DOMAINS.md` (custom
> domain detail), `docs/AUTH_ARCHITECTURE.md` (school-side auth).

## 1. THE SECURITY RULE

> **PUBLIC URL identifies the tenant for public branding/content.
> AUTHENTICATED authorization derives tenant identity from the
> authenticated server-side identity/session.**

Consequences, enforced in code and pinned by tests
(`tests/security/plane-architecture.test.ts`,
`tests/security/tenant-domains.test.ts`,
`tests/security/tenant-isolation.test.ts`):

- `?tenant=`, `?slug=`, `?schoolId=` — and any Host header — **never
  switch a session's tenant**. `/api/auth/me?tenant=<foreign-slug>` with a
  real School-B session returns School B, always.
- An unauthenticated forged-tenant probe leaks nothing (401).
- Resolution selects the public website payload, login branding, RSS, and
  public media — nothing else.

## 2. The full resolution order

`resolvePublicSchool(req)` in `src/lib/tenant/resolution.ts` — the single
pipeline every public consumer funnels through:

| Priority | Source | Match | Result |
| --- | --- | --- | --- |
| 1a | **Host header** (normalized: lowercase, no protocol/port, no leading `www.`, no trailing dots) | `TenantDomain` row, `status: 'VERIFIED'`, school `ACTIVE` | `{ schoolId, slug, via: 'domain' }` |
| 1b | Host header | legacy `School.domain` exact match, school `ACTIVE` (pre-8B admin-set path, kept for compatibility) | `{ …, via: 'domain' }` |
| 2 | **Explicit query** — `?slug=` (canonical) or `?tenant=` (documented dev/deep-link fallback) | exact slug match, school `ACTIVE` | `{ …, via: 'slug' \| 'tenant' }` |
| — | anything else | no match | `null` → the **SCHOLARIO SaaS website** (the platform's own root experience) |

Hard properties:

- **Only VERIFIED domains route.** A `PENDING` mapping never serves
  traffic — you cannot squat a domain by pointing DNS at the deployment
  before the platform confirms ownership.
- **Hostnames are globally unique** per tenant (storage constraint) — no
  cross-tenant ambiguity, no resolution races.
- **Hostile Host values can only fail to resolve**, never select another
  tenant (normalization + exact-match only).
- **Sandbox hosts never resolve a tenant**: `isSandboxHost` filters
  localhost / 127.0.0.1 / raw IPs / `.local` (`src/lib/tenant/hostname.ts`).
- **Storage-side gate**: a hostname can only be ACCEPTED as a tenant domain
  if it is a well-formed public DNS name that is not an IP, not a sandbox
  host, not under a deployment suffix (`.vercel.app`, `.vercel.dev`,
  `.supabase.co`, …) and not a platform-reserved name
  (`scholario.com/.io/.cloud/.app`) — so no school can ever claim the
  platform's own domains (`isValidPublicHostname` /
  `hostnameRejectionReason`).
- An **explicit but unknown** `?slug=`/`?tenant=` fails-safe to `null` — no
  demo-school fallback, no guessing, no directory.
- The single-school and demo-fallback paths are **retired**: a school is
  reached only through its own identity (its domain, or an explicit tenant
  link).

## 3. The canonical `/s/<slug>` doors

The platform-addressable per-school URLs on the school plane
(`scholario-app`, or the unified legacy deployment):

| Route | What it is | Behavior |
| --- | --- | --- |
| `/s/<slug>/login` | **the school login door** | Slug validated server-side against the real `School` table (regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–60 chars, exact DB unique match). Unknown slug → **honest 404**, never a guessed tenant. Valid slug → the branded login page (`SchoolLoginDoor`), whose login POST binds the session to the user's real `schoolId`. |
| `/s/<slug>` | the school's canonical public URL | Server-side slug validation, then a clean **307 redirect** to `/?tenant=<slug>` — the same public-website pipeline the custom-domain path uses. |

Edge enforcement (`src/middleware.ts`), before the streaming shell flushes:

- **Decoded-path shape gate**: only the two door shapes exist. Percent-
  encoded traversal (`%2e%2e`, `%2f` — decoded and shape-checked), extra
  segments, or trailing junk → honest 404 at the edge.
- **Slug existence probe**: middleware validates the slug against the real
  `School` table via the internal public-API probe
  (`/api/schools/public?slug=…` with `x-scholario-door-probe: 1`) so an
  unknown slug is an honest 404 **status code** and a valid slug is a clean
  307 — not a soft-200 shell. Result cached per slug for **60 s**
  (bounded map, 512 entries). Probe transport failure fails **open** — the
  page components run their own server-side `notFound()`; the door never
  goes down because the probe failed.

Page components re-validate independently (`src/app/s/[slug]/page.tsx`,
`src/app/s/[slug]/login/page.tsx`) — the edge gate is an optimization and
an early 404, not the only check.

## 4. Plane interactions

| Plane | `/s/*` behavior |
| --- | --- |
| `scholario-app` (`SCHOLARIO_PLANE=school`) | doors served (§3) |
| `scholario-platform` (`SCHOLARIO_PLANE=platform`) | `/s/*`, `/login` → honest 404 at the edge — **no login door to phish on the control-plane deployment** |
| unified (legacy `scholario-production`) | doors served on the same origin (`/s/<slug>/login` relative) |

The platform console never links relatively — it computes absolute doors
from `SCHOOL_APP_BASE_URL` (`schoolLoginUrl` / `schoolPublicUrl` in
`src/lib/plane.ts`), falling back to relative paths only when the variable
is unset (local dev, the unified deployment).

## 5. Custom domain lifecycle

| Stage | State | Who acts |
| --- | --- | --- |
| 1. Request | `TenantDomain` row: `PENDING`, hostname normalized + validated, random verification token | platform console (`POST /api/platform/schools/[id]/domains`, `schools.manage` + step-up) or provisioning (customDomain in the wizard payload) — school-side `GET /api/school/domains` lists own domains + DNS instructions |
| 2. DNS proof | TXT `_scholario-verify.<hostname>` = `scholario-verify=<token>`; CNAME `<hostname>` → `cname.vercel-dns.com` (subdomain) or A → `76.76.21.21` (apex) | the school's DNS admin |
| 3. Verify | TXT match → `status: 'VERIFIED'`, `verifiedAt` set | `POST /api/platform/schools/[id]/domains/[domainId]/verify` (`schools.manage`) |
| 4. Attach | hostname attached to the Vercel project (dashboard/API with the deployment token — never app code) | platform operator |
| 5. Route | Host-header resolution serves that tenant's public website, login branding, RSS, public media — zero code changes | automatic |
| 6. Remove | mapping deleted (platform, step-up) | platform operator |

Invariants: **unverified never routes** (§2); hostname globally unique
(duplicate → P2002 → clean 409); verification state lives in the database,
never in DNS trust; the legacy `?tenant=` link keeps working as the
pre-DNS fallback. Full detail: `docs/CUSTOM_DOMAINS.md`.

## 6. Cache isolation (public tenant payloads)

| Surface | Cache policy |
| --- | --- |
| `/api/schools/public` | `Cache-Control: private, no-store` + `Vary: Host` on every status (200/404/429/500) — never CDN/proxy cached |
| `/api/public/notices/rss` | `private, max-age=60` + `Vary: Host` (browser-only freshness) |
| authenticated APIs | `api()` envelope, no-store |

The app is a client-rendered SPA — no per-tenant static HTML exists to
leak. Consecutive A/B/A host requests never mix tenant payloads
(test-pinned).

## 7. Operator quick reference

| To… | Do this |
| --- | --- |
| Preview a school's website before DNS | `https://scholario-app-virid.vercel.app/?tenant=<slug>` (or `/s/<slug>`, which 307s there). |
| Find the school's login door | `https://scholario-app-virid.vercel.app/s/<slug>/login` — or copy `loginUrl` from the platform console. |
| Diagnose a domain that "doesn't work" | Check `TenantDomain.status` first: `PENDING` never routes. Then the TXT record, then the Vercel attachment. |
| Prove a hostile Host can't hijack a tenant | Host normalization + VERIFIED-only + global uniqueness mean it can only fail to resolve — see `tests/security/tenant-domains.test.ts`. |
| Prove a forged `?tenant=` can't switch a session | `tests/security/plane-architecture.test.ts` — "forged tenant parameters never switch an authenticated session" (live HTTP, real session). |
