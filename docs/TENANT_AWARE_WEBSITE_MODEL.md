# Tenant-Aware Website Model

> **Status: implemented (PHASE 7.5).** The architecture resolves the
> school tenant from the request **server-side** before any content is
> served — the domain identifies the school, not a user selection. This
> document describes the actual resolution pipeline, the authenticated
> tenant model, and how the sandbox maps onto the future per-domain
> production deployment.

---

## 1. The resolution pipeline

```
request (host / slug)
      ↓
resolvePublicSchool(req)            src/lib/tenant/resolution.ts
      ↓
ResolvedTenant { schoolId, slug, via: 'domain' | 'slug' | 'single' | 'demo' }
      ↓
school configuration (School row: identity + branding + settings)
      ↓
school website content (websiteContent + gallery + announcements)
      ↓
school branding (colors, logo, favicon) → rendered site
```

Priority order (first match wins):

1. **Domain (Host header)** — the production path. A real configured
   `School.domain` value must match the normalized host **exactly**
   (no suffix guessing — cross-tenant ambiguity is never tolerated; a
   sandbox host like `localhost` never resolves a school).
2. **`?slug=`** — an explicit, tenant-chosen link identity
   (`bluebell-academy`). An explicit but *unknown* slug fails-safe
   (no demo fallback leak, no school enumeration).
3. **Single ACTIVE school in the DB** — a fresh single-tenant deployment
   resolves without any parameter.
4. **Registered demo school** — sandbox/marketing default.

Consumers of the resolver: `/api/schools/public` (website payload +
login branding + notice board), `/api/public/notices/rss`,
`/api/public/website/media/[fileId]`, and the public admissions form
(inquiries are attributed to the **resolved** school slug — the old
hardcoded `demo-school` attribution bug is fixed).

---

## 2. Authenticated tenant = the session, never the client

- The login form posts **credentials only**. There is no school
  selector, no school list, no other-tenant discovery: the user→school
  binding comes from the `User.schoolId` row.
- Every school-scoped API derives the tenant from the session via
  `schoolScoped(user)`; a client-provided `schoolId` is **never read**.
  Cross-tenant ids fail-safe 404/403 with sanitized envelopes (pinned by
  the Phase 2 suite; re-pinned for the new Phase 7.5 surfaces).
- Client localStorage families are namespaced per tenant through the
  tenant registry (`lib/tenant/schools.ts`) — School A's and School B's
  browsers never share store state.
- Login branding is fetched **once** from `/api/schools/public` (no
  slug — tenant-resolved): the login page shows the resolved school's
  name, tagline, affiliation, logo, and brand color.

---

## 3. Login UX boundaries (verified)

The school login surface exposes:

- the resolved school's branding and identity;
- the school platform experience (demo credential chips are
  development-gated only);
- the Phase 6 **read-only platform announcements banner** (platform-wide
  maintenance notices — explicitly not a platform entry point).

It does **not** expose: any Super Admin / Platform Admin option, any
school selector, any other tenant's name, count, or content. (Pinned by
test #6 of the Phase 7.5 suite and grep-audited in Phase 5/6 work; the
platform plane lives exclusively at `/platform/*` behind its own MFA
login.)

---

## 4. Sandbox ↔ production mapping

| Production (future Supabase/Vercel phase) | Sandbox today |
|---|---|
| `school-a-domain` Host header → resolver hit (`via: 'domain'`) | `?slug=school-a` or single/demo fallback (`via: 'slug' / 'single' / 'demo'`) |
| Per-school DNS + apex domains stored on `School.domain` | `School.domain` stored, matched exactly, exercised by the resolver tests |
| Per-school SSL/gateway (Vercel domains) | One preview origin serves both tenants tenant-scoped server-side |
| Public media via CDN + signed URLs | Opaque-id public media route with publication rules |

The resolver is the **only** place host→tenant mapping lives; the
Supabase/Vercel phase wires real domains into the same function with zero
renderer changes. No per-school codebases, no per-school infrastructure
projects exist.

---

## 5. What this guarantees (and what it doesn't)

Guarantees (pinned by tests):

- School A's website content/gallery/announcements can never resolve as
  School B's (server-side tenant filtering on every public surface);
- a user cannot switch tenants by sending a foreign `schoolId`;
- an unknown/foreign slug never leaks the existence of another school;
- login never exposes the platform plane or other tenants.

Deliberate sandbox-only affordances (development-gated, documented in
DATA_SOURCE_MAP register): the demo school fallback and the demo
credential chips — both vanish in production configuration.

Not yet implemented (future phases): real domain provisioning UI on the
platform plane, per-domain SSL, and signed/private asset storage.
