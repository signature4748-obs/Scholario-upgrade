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
 * Usage: bun tests/helpers/plane-middleware-probe.ts <plane> <path> [method]
 * Output: {"status":<number>,"blocked":<bool>,"contentType":<string>}
 */
import { NextRequest } from 'next/server'

const [plane, path, method = 'GET'] = process.argv.slice(2)
if (!plane || !path) {
  console.error('usage: bun plane-middleware-probe.ts <plane> <path> [method]')
  process.exit(2)
}
process.env.SCHOLARIO_PLANE = plane
// The platform PAGE boundary only redirects when NODE_ENV=production;
// the probe exercises the PLANE gate specifically, so neutralize the
// page redirect to keep verdicts deterministic.
process.env.NODE_ENV = 'test'

async function main() {
  const { middleware } = await import('@/middleware')
  const req = new NextRequest(`http://localhost:3000${path}`, { method })
  const res = await middleware(req)
  const out = {
    status: res.status,
    blocked: res.status === 404,
    contentType: res.headers.get('content-type') ?? '',
  }
  console.log(JSON.stringify(out))
}

void main()
