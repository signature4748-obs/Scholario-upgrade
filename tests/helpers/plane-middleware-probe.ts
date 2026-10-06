/**
 * plane-middleware-probe — child-process harness for testing the
 * deployment-plane edge gate with a SPECIFIC SCHOLARIO_PLANE value.
 *
 * The plane constant is memoized at module load (src/lib/plane.ts), so
 * one bun test process can only exercise ONE plane. This probe runs as
 * a CHILD PROCESS: it sets SCHOLARIO_PLANE from argv, imports the REAL
 * middleware, runs it against a synthetic NextRequest, and prints a
 * JSON verdict. The test file spawns it per case — every verdict is
 * the real middleware's decision, not a reimplementation.
 *
 * A module-load failure (the fail-closed plane guard throwing on an
 * invalid/missing production plane) is reported as a 500 verdict with
 * the error message — misconfiguration must NEVER quietly pass.
 *
 * Usage: bun tests/helpers/plane-middleware-probe.ts <plane> <path> [method] [nodeEnv] [allowUnified]
 *   <plane>       plane value, or the literal 'UNSET' to remove the variable
 *   [nodeEnv]     NODE_ENV for the child (default 'test')
 *   [allowUnified] any non-empty value sets SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1
 * Output: {"status":<number>,"blocked":<bool>,"contentType":<string>,"error"?:<string>}
 */
import { NextRequest } from 'next/server'

const [plane, path, method = 'GET', nodeEnv = 'test', allowUnified = ''] = process.argv.slice(2)
if (!plane || !path) {
  console.error('usage: bun plane-middleware-probe.ts <plane> <path> [method] [nodeEnv] [allowUnified]')
  process.exit(2)
}
if (plane === 'UNSET') delete process.env.SCHOLARIO_PLANE
else process.env.SCHOLARIO_PLANE = plane
if (allowUnified) process.env.SCHOLARIO_ALLOW_UNIFIED_PRODUCTION = '1'
else delete process.env.SCHOLARIO_ALLOW_UNIFIED_PRODUCTION
// The platform PAGE boundary only redirects when NODE_ENV=production;
// the probe exercises the PLANE gate specifically, so callers choose
// NODE_ENV explicitly (default 'test' keeps page redirects neutral).
process.env.NODE_ENV = nodeEnv

async function main() {
  try {
    const { middleware } = await import('@/middleware')
    const req = new NextRequest(`http://localhost:3000${path}`, { method })
    const res = await middleware(req)
    const out = {
      status: res.status,
      blocked: res.status === 404,
      contentType: res.headers.get('content-type') ?? '',
    }
    console.log(JSON.stringify(out))
  } catch (err) {
    // Module-load or handler failure = the fail-closed plane guard:
    // the surface must NOT be served on a misconfigured deployment.
    const message = err instanceof Error ? err.message : String(err)
    const out = {
      status: 500,
      blocked: true,
      contentType: '',
      error: message.slice(0, 300),
    }
    console.log(JSON.stringify(out))
  }
}

void main()
