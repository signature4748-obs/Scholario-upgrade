/**
 * CREDENTIAL-RESIDUE FLAG (IMPL-2) — source-contract regression.
 *
 * Migration 20261013130000 closes the honest-signal gap the
 * 20261004150000_credential_neutralization predicate could not reach:
 * legacy SUPER_ADMIN / school-less User rows kept
 * mustChangePassword = false while never completing a rotation
 * (passwordChangedAt IS NULL) — the exact residue the production
 * audit found (3 rows). Pinned here so a future migration edit or
 * reordering cannot silently drop the closure.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT } from '../helpers/repo-root'

describe('credential-residue flag migration', () => {
  test('flags every never-rotated row regardless of role/schoolId', () => {
    const sql = readFileSync(
      join(REPO_ROOT, 'prisma/migrations/20261013130000_flag_never_changed_bootstrap_users/migration.sql'),
      'utf8',
    )
    // The closure predicate must not re-introduce the SUPER_ADMIN/school-less
    // exclusions. Exclusion guards run against the EXECUTABLE statement (comment
    // prose stripped): the migration header legitimately narrates the legacy
    // predicate ("role = 'SUPER_ADMIN'", "schoolId IS NULL") — that is
    // documentation, not SQL that re-applies it.
    const body = sql.replace(/--[^\n]*/g, '').trim()
    expect(sql).toContain('UPDATE "User" SET "mustChangePassword" = true')
    expect(sql).toContain('"passwordChangedAt" IS NULL')
    expect(sql).toContain('"mustChangePassword" = false')
    expect(body).not.toMatch(/role\s*=\s*'SUPER_ADMIN'/i)
    expect(body).not.toMatch(/"role"\s*<>\s*'SUPER_ADMIN'/i)
    expect(body).not.toMatch(/"schoolId"\s+IS\s+NOT\s+NULL/i)
    expect(sql).not.toContain('schoolId IS NULL AND')
    // The executable statement is EXACTLY the closure predicate — no clause
    // added, dropped, or reordered can silently weaken the flag.
    expect(body.replace(/\s+/g, ' ')).toBe(
      'UPDATE "User" SET "mustChangePassword" = true WHERE "passwordChangedAt" IS NULL AND "mustChangePassword" = false;',
    )
  })
})
