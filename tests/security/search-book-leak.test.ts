/**
 * SEARCH-BOOK-LEAK — command-palette fabricated-corpus regression suite.
 *
 * The bug this pins (cross-cutting audit finding): the command palette's
 * FINAL-GATE dropped local (mock) results of types
 * {student, teacher, fee, notice, parent, class, subject, exam, room,
 * material, deck, group} — but searchContent emitted fabricated library
 * books under type 'book', which the gate MISSED. Fabricated books
 * (BK001-008, "Theory of Programming" etc.) rendered in the PRODUCTION
 * palette mixed with real /api/search rows, deep-linking into the mock
 * Library module.
 *
 * Invariants under test:
 *
 *   1. GATE CONTRACT: the palette's ENTITY_TYPES gate contains 'book'
 *      (defense-in-depth — any future local emitter of book-typed rows
 *      is gated out of the rendered results).
 *   2. SOURCE RETIREMENT: search-content.ts no longer imports the mock
 *      operations corpus, and searchContent() returns NO local results
 *      for any role/query (the server search is the only entity source).
 *   3. PALETTE INTEGRITY: the local corpus path (searchEntities) yields
 *      no 'book'/'notice'-typed items for a book-flavoured query —
 *      nothing fabricated can reach the merge regardless of the gate.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'
import { searchContent } from '@/lib/search-service/search-content'
import { searchEntities } from '@/lib/search-service/search-entities'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

// ─── 1. gate contract ────────────────────────────────────────────────────

describe('SEARCH-BOOK-LEAK · the palette gate covers the book type', () => {
  test("ENTITY_TYPES includes 'book'", () => {
    const src = read('src/components/shared/command-palette/use-command-palette.ts')
    const m = src.match(/const ENTITY_TYPES = new Set\(\[([\s\S]*?)\]\)/)
    expect(m).not.toBeNull()
    const types = (m![1].match(/'([a-z]+)'/g) ?? []).map((t) => t.slice(1, -1))
    expect(types).toContain('book')
    // The original gate members stay covered (no regression of the
    // earlier FINAL-GATE fix).
    for (const t of ['student', 'teacher', 'fee', 'notice', 'parent', 'class', 'subject', 'exam', 'room']) {
      expect(types).toContain(t)
    }
  })
})

// ─── 2. source retirement ────────────────────────────────────────────────

describe('SEARCH-BOOK-LEAK · the fabricated content corpus is retired at the source', () => {
  test('search-content.ts has no mock imports', () => {
    const src = read('src/lib/search-service/search-content.ts')
    // The import statements must be gone (mentions in the retirement
    // history comment are fine — they document what was removed).
    expect(src).not.toMatch(/from\s+'@\/lib\/mock\/operations'/)
    expect(src).not.toMatch(/import\s*\{[^}]*libraryBooks[^}]*\}/)
    expect(src).not.toMatch(/import\s*\{[^}]*\bnotifications\b[^}]*\}/)
  })

  test('searchContent returns no local results for any role (honest empty)', () => {
    for (const role of ['principal', 'teacher', 'student'] as const) {
      // Queries that previously matched the fabricated corpus.
      for (const q of ['theory', 'program', 'physics', 'notice', 'circular']) {
        expect(searchContent(q, role)).toEqual([])
      }
    }
  })
})

// ─── 3. palette integrity (the merged local path) ────────────────────────

describe('SEARCH-BOOK-LEAK · nothing fabricated reaches the palette merge path', () => {
  test("searchEntities yields no 'book'/'notice'-typed local items for a book-flavoured query", () => {
    const groups = [] as never
    for (const role of ['principal', 'teacher', 'student'] as const) {
      const items = searchEntities('theory', role, groups)
      const fabricated = items.filter((i) => i.type === 'book' || i.type === 'notice')
      expect(fabricated).toEqual([])
    }
  })
})
