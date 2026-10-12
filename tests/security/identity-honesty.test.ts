/**
 * IDENTITY-HONESTY — the last fabricated identities on authenticated
 * surfaces, pinned by this session's completion audit.
 *
 * The leaks this pins:
 *   · ACCOUNT MENU (profile-dropdown): the school context line read the
 *     STATIC tenant registry (`useActiveTenant`) — a single hardcoded
 *     Greenwood demo tenant. Every REAL tenant user (Green Valley /
 *     Hawkings principals, teachers, students) saw "Greenwood Public
 *     School" in their account menu. The sidebar already read the server
 *     session school; the dropdown now reads the SAME cascade
 *     (useShellSchoolName extracted to src/lib/hooks).
 *   · SHELL SINGLE SOURCE: the school-name hook must be shared (one
 *     import), not duplicated per surface.
 *   · CLASS LEADERSHIP: the assignment surface had NO honest banner
 *     (localStorage-only writes, no server persistence, no cross-device
 *     sync) and stamped the hardcoded 'Dr. Ananya Iyer' persona on every
 *     assignment / task / review record — the same persona the rest of
 *     the repo already retired.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

describe('IDENTITY-HONESTY · the account menu reads the real school', () => {
  test('profile-dropdown no longer consults the static tenant registry', () => {
    const src = read('src/components/shell/app-shell/profile-dropdown.tsx')
    expect(src).not.toMatch(/useActiveTenant/)
    expect(src).not.toMatch(/from '@\/lib\/tenant\/store'/)
    expect(src).toMatch(/import \{ useShellSchoolName \} from '@\/lib\/hooks\/use-shell-school-name'/)
  })

  test('the dropdown renders the shared cascade result, not a tenant record', () => {
    const src = read('src/components/shell/app-shell/profile-dropdown.tsx')
    expect(src).toMatch(/const schoolName = useShellSchoolName\(\)/)
    expect(src).not.toMatch(/activeTenant/)
  })

  test('the shared hook exists and reads server-session school → profile cascade', () => {
    const src = read('src/lib/hooks/use-shell-school-name.ts')
    expect(src).toMatch(/useCurrentUser\(\(s\) => s\.me\?\.school\?\.name\)/)
    expect(src).toMatch(/useSchoolProfile\(\)/)
    expect(src).toMatch(/return sessionSchool\?\.trim\(\) \|\| profile\.name/)
  })

  test('the shell consumes the shared hook (single source, no local duplicate)', () => {
    const src = read('src/components/shell/app-shell.tsx')
    expect(src).toMatch(/import \{ useShellSchoolName \} from '@\/lib\/hooks\/use-shell-school-name'/)
    expect(src).not.toMatch(/function useShellSchoolName/)
    // the school-profile import moved with the hook
    expect(src).not.toMatch(/from '@\/lib\/school-profile'/)
  })
})

describe('IDENTITY-HONESTY · class leadership is labeled + persona-free', () => {
  test('the assignment surface carries the honest demo banner', () => {
    const src = read('src/components/principal/modules/classes/details/class-leadership.tsx')
    expect(src).toMatch(/<DemoModuleNotice moduleName="Class Leadership" variant="demo" \/>/)
  })

  test('no hardcoded principal persona on audit trails', () => {
    const src = read('src/components/principal/modules/classes/details/class-leadership.tsx')
    expect(src).not.toContain("name: 'Dr. Ananya Iyer'")
    expect(src).not.toMatch(/PRINCIPAL\.name/)
    expect(src).toMatch(/function usePrincipalActor\(\)/)
    expect(src).toMatch(/user\?\.name\?\.trim\(\) \|\| 'Principal'/)
  })

  test('every actor-stamped record uses the session actor (assign/end/task/review)', () => {
    const src = read('src/components/principal/modules/classes/details/class-leadership.tsx')
    expect(src).toMatch(/assignedById: actor\.id, assignedByName: actor\.name/)
    expect(src).toMatch(/endPosition\(p\.id, actor\.name\)/)
    expect(src).toMatch(/assignedByName: actor\.name,/)
    expect(src).toMatch(/reviewUpdate\(u\.id, 'approved', actor\.name\)/)
    expect(src).toMatch(/resolveIssue\(i\.id, 'resolved', actor\.name/)
    expect(src).toMatch(/acknowledgeRequest\(r\.id, actor\.name\)/)
  })
})
