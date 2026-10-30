/**
 * ROOT-ADMIN ROUTING REPAIR — Route inventory + build-exclusion guards.
 *
 * THE PRODUCTION INCIDENT THIS FILE GUARDS AGAINST (2026-10-21):
 *   .vercelignore contained the unanchored pattern `audit` (intended to
 *   exclude the ROOT-LEVEL documentation folder audit/). Gitignore-style
 *   patterns match at ANY depth, so Vercel's source upload silently
 *   dropped FOUR runtime source directories:
 *     · src/app/platform/(console)/audit      — the Super Admin Audit Log page
 *     · src/app/api/platform/audit            — its API
 *     · src/app/api/homework/[id]/audit       — school-plane API
 *     · src/app/api/exams/[id]/audit          — school-plane API
 *   Every Vercel build then 404'd those routes in production while local
 *   dev and CI (which never read .vercelignore) stayed green. Reported
 *   as "Opening Audit Log produces Page not found".
 *
 * WHAT THIS SUITE ENFORCES (three layers, all hermetic — no server):
 *   1. Route inventory — every console sidebar destination and every
 *      internal href/router.push target found in platform sources must
 *      resolve to a page or API route that ACTUALLY EXISTS in the App
 *      Router tree (route groups translated, params wildcarded).
 *   2. .vercelignore anchoring — every exclusion pattern must be
 *      root-anchored (`/name`) or a trailing suffix glob (`*.log`);
 *      bare names are rejected outright (they match any depth), and no
 *      pattern may match ANY runtime-required file under src/, public/,
 *      prisma/ or the root build files.
 *   3. Recovery-surface pins — the platform 404 boundary exists and
 *      recovers INSIDE the control plane (→ /platform), the console
 *      logo links to the canonical Overview, and the four swallowed
 *      routes exist as tracked sources (the incident's exact routes).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { REPO_ROOT as ROOT } from '../helpers/repo-root'

// ── helpers ─────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const APP = join(ROOT, 'src', 'app')

interface RouteSpec {
  /** URL path, '*' for each [param] segment. */
  path: string
  /** 'page' | 'api' */
  kind: 'page' | 'api'
}

/** Translate an App Router file path to its URL route spec. */
function fileToRoute(file: string): RouteSpec | null {
  const rel = relative(APP, file).split('\\').join('/')
  const segments: string[] = []
  for (const seg of rel.split('/')) {
    if (seg === '(console)' || (seg.startsWith('(') && seg.endsWith(')'))) continue // route group
    segments.push(seg)
  }
  const last = segments[segments.length - 1]
  const kind: 'page' | 'api' = last === 'page.tsx' ? 'page' : last === 'route.ts' ? 'api' : null as unknown as 'page'
  if (kind !== 'page' && kind !== 'api') return null
  segments.pop()
  const path =
    segments.length === 0
      ? '/'
      : '/' +
        segments
          .map((s) => (s.startsWith('[') && s.endsWith(']') ? '*' : s))
          .join('/')
  return { path, kind }
}

const allAppFiles = walk(APP)
const PAGES = new Map<string, RouteSpec>()
const APIS = new Map<string, RouteSpec>()
for (const f of allAppFiles) {
  const spec = fileToRoute(f)
  if (!spec) continue
  ;(spec.kind === 'page' ? PAGES : APIS).set(spec.path, spec)
}

/** Does `target` (query stripped) resolve against the built route sets? */
function routeExists(target: string): boolean {
  let path = target.split('?')[0]
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (path === '') path = '/'
  const segs = path === '/' ? [] : path.slice(1).split('/')
  const trySet = (set: Map<string, RouteSpec>): boolean => {
    if (set.has(path)) return true
    // wildcard params: every '*' segment matches any single segment
    for (const spec of set.values()) {
      const rSegs = spec.path === '/' ? [] : spec.path.slice(1).split('/')
      if (rSegs.length !== segs.length) continue
      let ok = true
      for (let i = 0; i < rSegs.length; i++) {
        if (rSegs[i] !== '*' && rSegs[i] !== segs[i]) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    return false
  }
  if (path.startsWith('/api/')) return trySet(APIS)
  return trySet(PAGES)
}

// ── 1 · sidebar route inventory ─────────────────────────────────────────

describe('ROUTE INVENTORY · sidebar + navigation sources', () => {
  const shellSrc = readFileSync(join(ROOT, 'src/components/platform/console-shell.tsx'), 'utf8')

  test('the console NAV is the canonical grouped destinations (fixed order), each resolving to an existing App Router page', () => {
    // PAYMENTS & GATEWAYS REDESIGN (2026-10-30): the subscription cluster
    // became first-class nav — Subscriptions · Plans & Pricing ·
    // Payments & Gateways · Access Codes under a labelled Revenue group,
    // plus Reports & Audit in Oversight. The flat ten-item NAV became the
    // grouped NAV_GROUPS structure; the canonical ORDER is still asserted
    // here so accidental reshuffles fail loudly.
    const navEntries = [...shellSrc.matchAll(/\{ href: '([^']+)', label: '([^']+)', icon: \w+(?:, permission: '([^']+)')? \}/g)]
    expect(navEntries.length).toBe(14)
    const expected = [
      ['/platform', 'Overview'],
      ['/platform/schools', 'Schools'],
      ['/platform/subscriptions', 'Subscriptions'],
      ['/platform/plans', 'Plans & Pricing'],
      ['/platform/payments', 'Payments & Gateways'],
      ['/platform/codes', 'Access Codes'],
      ['/platform/admins', 'Users & Access'],
      ['/platform/support', 'Support'],
      ['/platform/announcements', 'Announcements'],
      ['/platform/reports', 'Reports & Audit'],
      ['/platform/audit', 'Audit Log'],
      ['/platform/settings', 'Settings'],
      ['/platform/sessions', 'My Sessions'],
      ['/platform/operations', 'Operations'],
    ]
    navEntries.forEach((m, i) => {
      expect(m[1]).toBe(expected[i][0])
      expect(m[2]).toBe(expected[i][1])
      expect(routeExists(m[1])).toBe(true)
    })
  })

  test('every internal href/router target in platform sources resolves to a real route (no stale/obsolete paths)', () => {
    const files = [
      ...walk(join(ROOT, 'src/components/platform')).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts')),
      ...walk(join(ROOT, 'src/app/platform')).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts')),
    ]
    const targets = new Set<string>()
    const hrefRe = /href=\{?["'`]([^"'`]+)["'`]/g
    const pushRe = /router\.(?:push|replace)\(\s*["'`]([^"'`]+)["'`]/g
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(hrefRe)) targets.add(m[1])
      for (const m of src.matchAll(pushRe)) targets.add(m[1])
    }
    const bad: string[] = []
    for (const raw of targets) {
      if (!raw.startsWith('/')) continue // anchors, mailto, query-only
      if (raw.startsWith('/#')) continue
      let t = raw
      if (t.includes('${')) t = t.slice(0, t.indexOf('${')) // template prefix
      if (t.endsWith('/')) t = t.slice(0, -1)
      if (t === '') continue
      if (t.includes('*')) {
        // wildcard path: resolve by prefix (t ends with '/' already)
        if (![...PAGES.keys(), ...APIS.keys()].some((p) => p === t || p.startsWith(t))) bad.push(raw)
        continue
      }
      if (!routeExists(t)) bad.push(raw)
    }
    expect(bad).toEqual([])
  })

  test('the console logo is a link to the canonical Overview (/platform) — in collapsed, expanded and drawer forms', () => {
    const logoLinks = [...shellSrc.matchAll(/href="\/platform"\s+aria-label="SCHOLARIO Control Plane — back to Overview"/g)]
    // Desktop collapsed + desktop expanded share ONE source block since
    // the 2026-10 shell rewrite (renderSidebarHeader(compact) renders the
    // same <Link> for both forms — the canonical-Overview target cannot
    // diverge between them), plus the mobile drawer's own <Link>.
    // Both desktop forms + the drawer = 2 source occurrences covering
    // all three rendered forms.
    expect(logoLinks.length).toBe(2)
    // The shared desktop header link must exist unconditionally — the
    // collapsed form must never lose the canonical-Overview target.
    expect(shellSrc).toContain('renderSidebarHeader(collapsed)')
  })

  test('the four routes swallowed by the 2026-10-21 vercelignore incident exist as tracked sources', () => {
    expect(existsSync(join(APP, 'platform/(console)/audit/page.tsx'))).toBe(true)
    expect(existsSync(join(APP, 'api/platform/audit/route.ts'))).toBe(true)
    expect(existsSync(join(APP, 'api/homework/[id]/audit/route.ts'))).toBe(true)
    expect(existsSync(join(APP, 'api/exams/[id]/audit/route.ts'))).toBe(true)
  })
})

// ── 2 · recovery surfaces ──────────────────────────────────────────────

describe('ROUTE INVENTORY · 404 recovery is plane-aware (never bounces platform operators to school surfaces or login)', () => {
  const nf = readFileSync(join(APP, 'not-found.tsx'), 'utf8')

  test('the root not-found is gated on the deployment plane (the same env-driven PLANE the middleware uses)', () => {
    expect(nf).toContain("import { PLANE } from '@/lib/plane'")
    expect(nf).toContain("if (PLANE === 'platform')")
  })

  test('the PLATFORM variant recovers INSIDE the control plane — Overview first, sign-in second, and NO bare "/" link (that path IS the login bounce on the platform plane)', () => {
    const platformVariant = nf.slice(0, nf.lastIndexOf('return ('))
    expect(platformVariant).toContain('href="/platform"')
    expect(platformVariant).toContain('Back to Overview')
    expect(platformVariant).toContain('href="/platform/login"')
    // THE school-portal/login-bounce bug: no bare "/" recovery link in
    // the platform variant (on the platform plane "/" 307s to the login
    // page — the "Go to Home sends me to sign-in" report).
    expect(platformVariant).not.toMatch(/href=(["'])\/\1/)
  })

  test('the SCHOOL/unified variant keeps the original portal recovery ("/" is the correct home there)', () => {
    expect(nf).toContain('Return to home')
    expect(nf).toContain('href="/"')
  })

  test('the session provider redirects to /platform/login ONLY on a real 401 (5xx/network resolve to the retryable unavailable state)', () => {
    const provider = readFileSync(join(ROOT, 'src/components/platform/platform-client.tsx'), 'utf8')
    // exactly three login redirects exist in the provider: the 401
    // branch, logout and logoutAll — the 5xx/network 'unavailable'
    // path NEVER redirects (the false-logout bug class)
    expect(provider.match(/router\.replace\('\/platform\/login'\)/g)?.length).toBe(3)
    expect((provider.match(/outcome === 'unauthenticated'/g) ?? []).length).toBe(1)
    expect((provider.match(/setUnavailable\(true\)/g) ?? []).length).toBe(2) // 5xx + network exception — never a redirect
  })
})

// ── 3 · .vercelignore guard (THE incident regression) ───────────────────

describe('ROUTE INVENTORY · .vercelignore build-exclusion guard', () => {
  const RUNTIME_ROOTS = ['src', 'public', 'prisma'] as const
  const RUNTIME_ROOT_FILES = [
    'package.json',
    'bun.lock',
    'next.config.ts',
    'tsconfig.json',
    'postcss.config.mjs',
    'components.json',
    'next-env.d.ts',
    'eslint.config.mjs',
    'vercel.json',
  ]
  const vercelignore = readFileSync(join(ROOT, '.vercelignore'), 'utf8')
  const patterns = vercelignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  /** Runtime-required files (relative to repo root). */
  const runtimeFiles: string[] = [
    ...RUNTIME_ROOTS.flatMap((r) => walk(join(ROOT, r)).map((f) => relative(ROOT, f).split('\\').join('/'))),
    ...RUNTIME_ROOT_FILES.filter((f) => existsSync(join(ROOT, f))),
  ]
  expect(runtimeFiles.length).toBeGreaterThan(1000)

  /**
   * Gitignore-subset matcher (the semantics Vercel applies, documented
   * subset — anything exotic throws so a human reviews it):
   *   /name  → repository-root-anchored (file or directory subtree)
   *   *.log  → suffix glob on the basename (any depth)
   *   name   → matches at ANY depth (the incident class — forbidden by
   *            the anchoring test below, but still evaluated here as
   *            defense in depth)
   */
  function matches(pattern: string, relPath: string): boolean {
    if (pattern.startsWith('/')) {
      const p = pattern.slice(1)
      return relPath === p || relPath.startsWith(p + '/')
    }
    if (pattern.includes('*')) {
      if (pattern.includes('/')) throw new Error(`unsupported .vercelignore pattern (glob with slash): ${pattern}`)
      const suffix = pattern.slice(pattern.indexOf('*') + 1)
      const base = relPath.split('/').pop() ?? ''
      return base.endsWith(suffix) && base.length > suffix.length
    }
    // bare name — any-depth segment match (exactly what swallowed audit/)
    return relPath.split('/').some((seg) => seg === pattern)
  }

  test('every exclusion pattern is root-anchored or a basename suffix — bare names are forbidden (2026-10-21 incident class)', () => {
    const offenders = patterns.filter((p) => !p.startsWith('/') && !/^\*[^/]*$/.test(p))
    expect(offenders).toEqual([])
  })

  test('no .vercelignore pattern matches ANY runtime-required source file', () => {
    const swallowed: Array<{ pattern: string; file: string }> = []
    for (const p of patterns) {
      for (const f of runtimeFiles) {
        if (matches(p, f)) swallowed.push({ pattern: p, file: f })
      }
    }
    expect(swallowed).toEqual([])
  })

  test('the guard actually detects the incident: the old bare "audit" pattern would have swallowed the Audit Log sources', () => {
    // Defense-in-depth proof that the matcher above has real teeth:
    // replay the OLD pattern against the runtime file list and expect
    // the four swallowed routes to be exactly what it catches.
    const hits = runtimeFiles.filter((f) => matches('audit', f))
    expect(hits).toContain('src/app/platform/(console)/audit/page.tsx')
    expect(hits).toContain('src/app/api/platform/audit/route.ts')
    expect(hits.some((f) => f.includes('api/homework/[id]/audit'))).toBe(true)
    expect(hits.some((f) => f.includes('api/exams/[id]/audit'))).toBe(true)
  })
})
