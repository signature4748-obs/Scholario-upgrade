import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/**
 * Phase 8A credential-exposure cleanup — regression guard.
 *
 * The cleanup removed every demo-credential value and demo-login shortcut
 * from all client/public surfaces. This suite pins that invariant:
 *
 *   1. The login quick-access credential file (login-page/data.tsx) stays
 *      deleted — the login surface must never carry demo accounts.
 *   2. NO tracked file in src/** (client AND server app code), prisma/**
 *      (except the single env-driven source), scripts/**, docs/**, or the
 *      root documentation may contain a demo credential VALUE or a
 *      demo-login shortcut string.
 *   3. The only permitted homes for seeded demo/fixture credential values
 *      are prisma/seed-credentials.ts (env-driven, server/test-side) and
 *      the test harness itself (tests/** — which reads the same source).
 *
 * This complements secrets-scan.test.ts (high-confidence LIVE secrets):
 * that suite guards provider keys; this one guards demo credentials.
 */

const git = (args: string[]): string => {
  const r = spawnSync('git', args, { cwd: '/home/z/my-project', encoding: 'utf8' })
  return r.status === 0 ? r.stdout.toString() : ''
}

const tracked = git(['ls-files']).split('\n').filter(Boolean)

/** Demo credential VALUES (passwords, TOTP secrets, fabricated HR literals). */
const VALUE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'demo-family password literal', re: /\bpassword123\b/ },
  { name: 'super-admin password literal', re: /\badmin123\b/ },
  { name: 'showcase principal password literal', re: /\bprincipal123\b/ },
  { name: 'showcase teacher password literal', re: /\bteacher123\b/ },
  { name: 'showcase student password literal', re: /\bstudent123\b/ },
  { name: 'platform ops password literal', re: /\bops12345\b/ },
  { name: 'tenant fixture password literal', re: /\bScholarioTest2026\b/ },
  { name: 'demo root TOTP secret', re: /\bJBSWY3DPEHPK3PXP\b/ },
  { name: 'demo ops TOTP secret', re: /\bKRSXG5CTMVRXEZLU\b/ },
  { name: 'fabricated HR credential literals', re: /\bGWS#(?:Principal|Teacher)2025\b/ },
]

/** Demo-login shortcut UI strings (the removed quick-access block). */
const SHORTCUT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'quick demo access heading', re: /quick\s+demo\s+access/i },
  { name: 'one tap to fill heading', re: /one\s+tap\s+to\s+fill/i },
  { name: 'demo accounts preview note', re: /demo\s+accounts\s+·\s+development\s+preview/i },
]

const ALL_PATTERNS = [...VALUE_PATTERNS, ...SHORTCUT_PATTERNS]

/**
 * Files allowed to carry seeded credential VALUES: the single env-driven
 * source module and the test harness (which imports it — not inlines it,
 * but allowlisted so intentional documentation in helpers stays legal).
 */
const VALUE_ALLOW = /^(prisma\/seed-credentials\.ts|tests\/)/

/** Skip binary/bulk content for speed (same convention as secrets-scan). */
const SKIP_CONTENT = /(\.(png|jpg|jpeg|webp|gif|woff2?|ttf|db|ico|svg|pdf|zip|wasm)$|^public\/tesseract\/|^qa-shots\/|^db\/uploads\/|^\.next\/)/

/** Surfaces that must contain NO demo shortcut strings at all. */
const scanFiles = tracked.filter(
  (f) =>
    !SKIP_CONTENT.test(f) &&
    !VALUE_ALLOW.test(f) &&
    (f.startsWith('src/') || f.startsWith('prisma/') || f.startsWith('scripts/') || f.startsWith('docs/') || f === 'README.md' || f === 'worklog.md' || f === '.env.example' || f === 'Caddyfile' || f.startsWith('mini-services/')),
)

describe('demo credential exposure (Phase 8A cleanup) — regression guard', () => {
  test('the login quick-access credential file stays deleted', () => {
    // Disk truth (works before/after staging): the file that carried the
    // one-tap demo credential chips must never return.
    expect(existsSync('/home/z/my-project/src/components/login/login-page/data.tsx')).toBe(false)
  })

  test('no demo credential value or demo-login shortcut in any app/seed/doc surface', () => {
    const offenders: string[] = []
    outer: for (const file of scanFiles) {
      let content: string
      try {
        content = readFileSync(`/home/z/my-project/${file}`, 'utf8')
      } catch {
        continue
      }
      for (const { name, re } of ALL_PATTERNS) {
        re.lastIndex = 0
        const m = re.exec(content)
        if (m) {
          offenders.push(`${file}: ${name} (…${m[0].slice(0, 16)}…)`)
          continue outer
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('env-driven seed credentials module exists as the single value source', () => {
    expect(existsSync('/home/z/my-project/prisma/seed-credentials.ts')).toBe(true)
    expect(existsSync('/home/z/my-project/tests/helpers/credentials.ts')).toBe(true)
    const mod = readFileSync('/home/z/my-project/prisma/seed-credentials.ts', 'utf8')
    // The module must remain env-driven (override-able), not env-blind.
    expect(mod).toContain('SEED_DEMO_PASSWORD')
    expect(mod).toContain('SEED_PLATFORM_ROOT_PASSWORD')
    expect(mod).toContain('SEED_TENANT_FIXTURE_PASSWORD')
  })

  test('.env.example documents the seed credential overrides as EMPTY placeholders', () => {
    const template = readFileSync('/home/z/my-project/.env.example', 'utf8')
    for (const key of [
      'SEED_DEMO_PASSWORD',
      'SEED_SUPERADMIN_PASSWORD',
      'SEED_PLATFORM_ROOT_PASSWORD',
      'SEED_PLATFORM_OPS_PASSWORD',
      'SEED_TENANT_FIXTURE_PASSWORD',
    ]) {
      expect(template).toContain(`#${key}=`)
    }
    // The retired demo-login feature flag must stay gone.
    expect(template).not.toContain('NEXT_PUBLIC_DISABLE_DEMO_LOGIN')
  })

  test('client source tree carries no NEXT_PUBLIC demo-login feature plumbing', () => {
    const offenders = tracked
      .filter((f) => f.startsWith('src/'))
      .filter((f) => {
        try {
          return /NEXT_PUBLIC_DISABLE_DEMO_LOGIN/.test(readFileSync(`/home/z/my-project/${f}`, 'utf8'))
        } catch {
          return false
        }
      })
    expect(offenders).toEqual([])
  })
})
