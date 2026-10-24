/**
 * SCHOOL-DOOR DECISION CONTRACT (unit) — the 2026-10 doors fix.
 *
 * THE DEFECT BEING LOCKED OUT: the school login doors used to
 * auto-replace to /?tenant=<slug> for ANY authenticated session (the
 * client cache was treated as authority), which — because the root
 * route rendered the role dashboard for every school session — made
 * the console's "Open website" link land in the PRINCIPAL panel, and
 * silently bounced a DIFFERENT tenant's session away from this
 * school's door.
 *
 * THE CONTRACT UNDER TEST (src/lib/school-door.ts — pure, plane-agnostic):
 *   · unauthenticated cache → the honest form (never a probe, never a
 *     redirect);
 *   · cached session + explicit door slug → a server-truth PROBE (the
 *     cache is a cache, never the authority);
 *   · cached session + custom-domain door (slug null — the origin IS
 *     the school, cookies are per-origin) → deliberate continue;
 *   · probe same-school → deliberate continue to '/';
 *   · probe other-school / unauthenticated / unavailable → the form
 *     for THIS school;
 *   · the continue target is EXACTLY '/' — never '/?tenant=…' (that
 *     URL means the public website now) and never a role URL.
 *
 * The live-HTTP companions (307 public link, 200 doors, honest 404s,
 * me-slug truth, websiteEnabled API) live in
 * tests/regression/public-vs-login-doors.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import {
  decideSchoolDoor,
  classifySchoolDoorProbe,
  resolveSchoolDoorProbe,
  SCHOOL_DOOR_CONTINUE_TARGET,
} from '@/lib/school-door'

describe('school-door decision — boot', () => {
  test('a logged-OUT cache renders the form (no probe, no redirect)', () => {
    const d = decideSchoolDoor({ doorSlug: 'hawkings-prithvipur', cachedAuthenticated: false })
    expect(d.phase).toBe('form')
  })

  test('a cached session on a shared-origin door defers to the server probe', () => {
    const d = decideSchoolDoor({ doorSlug: 'hawkings-prithvipur', cachedAuthenticated: true })
    expect(d.phase).toBe('probe')
  })

  test('a cached session on a CUSTOM-DOMAIN door continues (per-origin cookies)', () => {
    const d = decideSchoolDoor({ doorSlug: null, cachedAuthenticated: true })
    expect(d.phase).toBe('continue')
    if (d.phase === 'continue') expect(d.target).toBe(SCHOOL_DOOR_CONTINUE_TARGET)
  })

  test('an empty-string slug is NOT a custom domain — it can never continue', () => {
    // Only `null` means domain-resolved; a malformed door must probe
    // (and a probe against '' can never confirm ownership → form).
    const d = decideSchoolDoor({ doorSlug: '', cachedAuthenticated: true })
    expect(d.phase).toBe('probe')
    const r = resolveSchoolDoorProbe(classifySchoolDoorProbe('', { ok: true, status: 200 }, { school: { slug: '' } }))
    expect(r.phase).toBe('form')
  })
})

describe('school-door decision — probe resolution', () => {
  test('server truth: session owns THIS school → deliberate continue', () => {
    const kind = classifySchoolDoorProbe(
      'hawkings-prithvipur',
      { ok: true, status: 200 },
      { school: { slug: 'hawkings-prithvipur' } },
    )
    expect(kind).toBe('same-school')
    expect(resolveSchoolDoorProbe(kind).phase).toBe('continue')
  })

  test('server truth: session belongs to a DIFFERENT school → this school\'s form (no cross-tenant bounce)', () => {
    const kind = classifySchoolDoorProbe(
      'hawkings-prithvipur',
      { ok: true, status: 200 },
      { school: { slug: 'green-valley' } },
    )
    expect(kind).toBe('other-school')
    const d = resolveSchoolDoorProbe(kind)
    expect(d.phase).toBe('form')
  })

  test('server truth: a session with no resolvable school slug can never be confirmed → form', () => {
    const kind = classifySchoolDoorProbe('green-valley', { ok: true, status: 200 }, {
      school: { slug: null },
    })
    expect(kind).toBe('other-school')
    expect(resolveSchoolDoorProbe(kind).phase).toBe('form')
  })

  test('a 401 probe classifies the cache as STALE (unauthenticated → form)', () => {
    const kind = classifySchoolDoorProbe('green-valley', { ok: false, status: 401 }, null)
    expect(kind).toBe('unauthenticated')
    expect(resolveSchoolDoorProbe(kind).phase).toBe('form')
  })

  test('a transport failure / non-401 error is UNAVAILABLE — the form renders, the cache is never destroyed on a guess', () => {
    expect(classifySchoolDoorProbe('green-valley', { ok: false, status: 500 }, null)).toBe('unavailable')
    const timeout = classifySchoolDoorProbe('green-valley', { ok: false, status: 0 }, null)
    expect(timeout).toBe('unavailable')
    expect(resolveSchoolDoorProbe('unavailable').phase).toBe('form')
  })

  test('the continue target is EXACTLY the dashboard root — never tenant-carried, never a role URL', () => {
    // The old defect bounced doors to /?tenant=<slug>; after the fix
    // that URL means the PUBLIC WEBSITE, so no door decision may ever
    // produce it.
    expect(SCHOOL_DOOR_CONTINUE_TARGET).toBe('/')
    const boot = decideSchoolDoor({ doorSlug: null, cachedAuthenticated: true })
    const probe = resolveSchoolDoorProbe(
      classifySchoolDoorProbe('green-valley', { ok: true, status: 200 }, { school: { slug: 'green-valley' } }),
    )
    if (boot.phase === 'continue') expect(boot.target).toBe('/')
    if (probe.phase === 'continue') expect(probe.target).toBe('/')
  })
})
