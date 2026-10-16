/**
 * PR #31 STABILITY HARDENING — source-contract guard for the
 * legacy-compatible PlatformSetting reads.
 *
 * THE REGRESSION THIS PINS: the "core surfaces 503 on a schema-pending
 * database" defects were all caused by FULL-ROW platformSetting reads
 * (`db.platformSetting.findUnique({ where: { id: 'global' } })` with no
 * `select`): the generated SQL asks for every column INCLUDING
 * `subscriptionConfig` — added by the owner-gated pending migration
 * 20261013183000_subscription_entitlement_system — so on a
 * pre-migration database the read throws Prisma P2022, the central
 * classifier converts it to the typed SUBSCRIPTION_SYSTEM_PENDING 503,
 * and CORE, NON-subscription surfaces broke (school settings, every
 * module-guarded school route, the console Settings page, the
 * admissions-issuance toggle, the support-session launcher).
 *
 * The fix reads EXACTLY the legacy columns each call site consumes.
 * This suite pins that contract at the SOURCE level: the known call
 * sites must keep an explicit `select` — a careless refactor back to a
 * full-row read would re-break every pre-migration deployment. (The
 * behavioral result is pinned by tests/api/core-surfaces-schema-pending
 * .test.ts against the live dev server; behavioral evidence for the
 * pre-migration database itself is in the PR's verification evidence.)
 *
 * `src/lib/subscription/config.ts` is EXEMPT by design: it reads the
 * subscriptionConfig column itself and already catches the
 * pending-shape P2022 with a documented default-config fallback.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { REPO_ROOT } from '../helpers/repo-root'

/** Call sites that consume PlatformSetting — each must use an explicit
 *  column `select` (legacy-compatible) rather than a full-row read. */
const LEGACY_SELECT_CONTRACT: Array<{ file: string; why: string }> = [
  {
    file: 'src/lib/platform/module-flags.ts',
    why: 'school module guards + school-settings reads consume only `modules`',
  },
  {
    file: 'src/lib/admissions/feature-flag.ts',
    why: 'admissions issuance flag consumes only `modules`',
  },
  {
    file: 'src/app/api/platform/settings/route.ts',
    why: 'console Settings page consumes showDemoSchool/modules/supportMaxDuration',
  },
  {
    file: 'src/app/api/dashboard/route.ts',
    why: 'platform dashboard consumes only showDemoSchool',
  },
  {
    file: 'src/app/api/platform/schools/[id]/access/route.ts',
    why: 'support-session launcher consumes only supportMaxDuration',
  },
  {
    file: 'src/app/api/platform/schools/[id]/admissions-issuance/route.ts',
    why: 'flag-source resolution consumes only `modules`',
  },
]

/** The one sanctioned full-row read: this module reads the pending
 *  column itself and CATCHES the pending-shape error with a documented
 *  fallback (loadSubscriptionConfig). */
const EXEMPT = ['src/lib/subscription/config.ts']

describe('PlatformSetting legacy-compatible select contract', () => {
  test('every tracked platformSetting consumer is covered by this contract (or exempt)', () => {
    // Walk the tracked source and find every file that touches
    // platformSetting — the contract list must stay exhaustive, so a
    // NEW consumer cannot silently appear with a full-row read.
    const git = (args: string[]): string => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout?.trim() ?? ''
    const tracked = git(['ls-files', 'src/']).split('\n').filter(Boolean)
    const consumers = tracked.filter((f) => {
      const text = readFileSync(join(REPO_ROOT, f), 'utf8')
      return /platformSetting\.(findUnique|findFirst|create|update|upsert)\s*\(/.test(text)
    })
    const covered = new Set([...LEGACY_SELECT_CONTRACT.map((c) => c.file), ...EXEMPT])
    for (const f of consumers) {
      expect(covered.has(f)).toBe(true)
    }
  })

  for (const { file } of LEGACY_SELECT_CONTRACT) {
    test(`${file} — no full-row platformSetting reads`, () => {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8')
      // A full-row read = a platform query with a `where` but NO
      // `select` on the same call. Match the two full-row shapes that
      // caused the production incident:
      //   findUnique({ where: { id: 'global' } })
      //   findUnique({\n ... where ... \n })  without a select before the closing
      const fullRowFlat = /platformSetting\.find(?:Unique|First)\(\s*\{\s*where:\s*\{[^}]*\}\s*\}\s*\)/
      // Multi-line shape: findUnique({ ... }) whose argument block lacks `select:`
      const callBlocks = text.match(/platformSetting\.find(?:Unique|First)\(\s*\{[\s\S]*?\n\s*\}\s*\)/g) ?? []
      const withoutSelect = callBlocks.filter((block) => !/select\s*:/.test(block))
      expect(fullRowFlat.test(text)).toBe(false)
      expect(withoutSelect.length).toBe(0)
    })
  }
})
