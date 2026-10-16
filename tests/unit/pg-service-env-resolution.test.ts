/**
 * Regression (2026-10-16 post-reset hardening): the postgres-db service must
 * survive the sandbox boot script clobbering the MAIN project .env with the
 * SQLite template — by resolving the OWNING WORKTREE's .env first.
 *
 * Reproduction being guarded: after a container reset,
 * /home/z/my-project/.env contains DATABASE_URL=file:/… (the boot template)
 * while /home/z/feature-worktree/.env holds the reconstructed postgres URL.
 * The old service read only the main .env and FATAL'd at boot.
 *
 * Pure-function scope: temp files, no database, no network.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { firstPostgresUrlFrom } from '../../mini-services/postgres-db/env-resolution'

describe('firstPostgresUrlFrom — service .env resolution order', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pgenv-'))
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('prefers the worktree .env when the main .env is the boot-clobbered SQLite template', () => {
    const worktree = join(dir, 'worktree.env')
    const main = join(dir, 'main.env')
    writeFileSync(worktree, 'DATABASE_URL=postgresql://u:p@localhost:5432/scholario\n')
    writeFileSync(main, 'DATABASE_URL=file:/home/z/my-project/db/custom.db\n')
    const got = firstPostgresUrlFrom([worktree, main])
    expect(got).toBe('postgresql://u:p@localhost:5432/scholario')
  })

  test('falls back to the main .env when the worktree .env is absent', () => {
    const missing = join(dir, 'does-not-exist.env')
    const main = join(dir, 'main2.env')
    writeFileSync(main, 'DATABASE_URL=postgresql://u:p@localhost:5432/scholario\n')
    expect(firstPostgresUrlFrom([missing, main])).toBe('postgresql://u:p@localhost:5432/scholario')
  })

  test('returns null when no candidate carries a postgresql:// URL (fail-loud, no silent sqlite)', () => {
    const a = join(dir, 'sqlite.env')
    writeFileSync(a, 'DATABASE_URL=file:/x/custom.db\n')
    expect(firstPostgresUrlFrom([a, join(dir, 'nope.env')])).toBeNull()
  })

  test('tolerates quoted values and extra whitespace', () => {
    const q = join(dir, 'quoted.env')
    writeFileSync(q, '  DATABASE_URL = "postgresql://u:p@localhost:5432/scholario"  \n')
    expect(firstPostgresUrlFrom([q])).toBe('postgresql://u:p@localhost:5432/scholario')
  })
})
