import { resolve } from 'node:path'

/**
 * Path-agnostic repository root for test files (2026-10-11, CI first-run
 * fix — Task C-ci-tests).
 *
 * HISTORY: several suites hardcoded `/home/z/my-project` (the dev-sandbox
 * checkout path) for `git ls-files`, file scans and child-process spawn
 * cwd. On the CI runner the checkout lives at
 * /home/runner/work/<repo>/<repo> — every such path was ENOENT there
 * (secrets-scan returned an EMPTY tracked-file list; the plane-architecture
 * child probe died with `posix_spawn ENOENT`), so those suites failed in
 * CI while passing in the sandbox.
 *
 * This derivation starts from THIS file's own location
 * (…/<repo-root>/tests/helpers/repo-root.ts) and resolves two directories
 * up — correct on any machine, any checkout path, no env needed.
 * `SCHOLARIO_ROOT` stays available as an explicit override for exotic
 * layouts, mirroring the plane-architecture convention.
 */
export const REPO_ROOT: string =
  process.env.SCHOLARIO_ROOT && process.env.SCHOLARIO_ROOT.trim() !== ''
    ? resolve(process.env.SCHOLARIO_ROOT)
    : resolve(import.meta.dir, '../..')
