/**
 * HONESTY-SWEEP — banner + fabricated-field hygiene regression suite.
 *
 * The leaks this pins (this session's module audit, cross-cutting):
 *   · DOWNLOADS: the only demo-tier module WITHOUT a DemoModuleNotice
 *     (its 5 siblings — library, transport, inventory, certificates,
 *     applications — all carry one).
 *   · TEACHER APPLICATION REVIEWS: the principal/student twins carry the
 *     honest "client-side demo state" banner; the teacher twin didn't.
 *   · TIMETABLE PUBLISH: the publication record hardcoded
 *     'Dr. Ananya Iyer' as the author — a fabricated person on an audit
 *     surface (the repo already retired her persona everywhere else).
 *   · STUDENTS CITY/STATE: the roster server-sync + add-student mapping
 *     hardcoded 'Gurugram'/'Haryana' for EVERY student (rendered on the
 *     Parents tab) although the DB carries a single address string with
 *     no city/state columns.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

describe('HONESTY-SWEEP · every demo-tier module is labeled', () => {
  test('Downloads carries the DemoModuleNotice (was the only unlabeled demo module)', () => {
    const src = read('src/components/principal/modules/downloads/index.tsx')
    expect(src).toMatch(/import \{ DemoModuleNotice \}/)
    expect(src).toMatch(/<DemoModuleNotice moduleName="Downloads"/)
  })

  test('Teacher Application Reviews carries the banner its twins already had', () => {
    const src = read('src/components/teacher/modules/applications/index.tsx')
    expect(src).toMatch(/<DemoModuleNotice moduleName="Applications & Forms"/)
  })
})

describe('HONESTY-SWEEP · no fabricated people or places in real paths', () => {
  test('timetable publish author comes from the session, not a hardcoded persona', () => {
    const src = read('src/components/principal/modules/timetable/index.tsx')
    expect(src).not.toContain("publish('Dr. Ananya Iyer')")
    expect(src).toMatch(/const author = sessionUser\?\.name\?\.trim\(\) \|\| 'Principal'/)
    expect(src).toMatch(/import \{ useAuth \} from '@\/lib\/store\/auth-store'/)
  })

  test('roster server-sync no longer fabricates city/state for every student', () => {
    const src = read('src/lib/store/students-store/server-sync.ts')
    expect(src).not.toMatch(/city: 'Gurugram'/)
    expect(src).not.toMatch(/state: 'Haryana'/)
    expect(src).toMatch(/city: '',/)
  })

  test('add-student mapping no longer fabricates city/state', () => {
    const src = read('src/lib/store/students-store/store.ts')
    expect(src).not.toMatch(/city: 'Gurugram'/)
    expect(src).not.toMatch(/state: 'Haryana'/)
  })

  test('the Parents tab renders the location line only when it exists (no ", ")', () => {
    const src = read('src/components/principal/modules/students/profile-tab-parents.tsx')
    expect(src).toMatch(/\{\(student\.city \|\| student\.state\) && \(/)
    expect(src).not.toMatch(/\{student\.city\}, \{student\.state\}/)
  })
})
