/**
 * scripts/prod-release/trigger-deploy-hooks.ts — DEPLOY STAGE of the
 * production release pipeline (the step behind the Release workflow's
 * `deploy` job).
 *
 * TWO-PLANE CONTRACT (Batch 2, 2026-10-10): the active production topology is
 * TWO Vercel projects — `scholario-platform` (control plane) and
 * `scholario-app` (school plane). A release deploy triggers the production
 * Deploy Hook of BOTH planes (hooks `release-gate-platform` /
 * `release-gate-school`, ref `main`). The deprecated `scholario-production`
 * has NO hook here and is never a deploy target.
 *
 * This script runs ONLY after the release gate opened (ci + config pre-flight
 * + migration pre-flight/apply/verify all green, or push mode on main) — the
 * workflow enforces that with `needs:` + the gate; the script itself assumes
 * nothing and just fires the hooks fail-closed:
 *   · BOTH hook URLs are required (missing = STOP — a one-plane release is
 *     not a release).
 *   · Each hook is POSTed with a 30s timeout; transport hiccups and 5xx are
 *     retried (3 attempts, backoff); 4xx is an immediate hard failure.
 *   · BOTH hooks are fired even if the first one fails (maximal progress on
 *     an open gate); ANY failure then exits 1 — a partially triggered
 *     release is RED, and the verify-deployment stage will catch any plane
 *     that never reached the release SHA. Fail-closed, never a shrug.
 *
 * SAFETY RULES (same contract as scripts/prod-migration/lib.ts):
 *   · The hook URLs carry deploy power — they are read from the environment
 *     and NEVER printed, logged, or written to disk; they only ever travel
 *     inside the fetch URL itself. Console lines carry plane names + HTTP
 *     codes only.
 *   · Response bodies are clipped to 200 chars before printing (Vercel hook
 *     responses carry deployment ids/build metadata — no secrets, clipping
 *     is defense in depth).
 *   · Nothing else is mutated: the script only POSTs the two hook endpoints.
 *
 * Usage (the workflow does exactly this; by hand for rehearsal only):
 *   VERCEL_DEPLOY_HOOK_URL=… VERCEL_DEPLOY_HOOK_URL_SCHOOL=… \
 *     bun scripts/prod-release/trigger-deploy-hooks.ts
 *
 * Exit codes: 0 = both hooks accepted (HTTP 200); 1 = STOP (fail-closed).
 */
const HOOK_TIMEOUT_MS = 30_000
const HOOK_RETRIES = 3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface PlaneHookSpec {
  key: 'platform' | 'school'
  label: string
  envName: string
  url: string
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    // The VALUE is absent — naming the variable is safe (secrets are values,
    // never names); the message deliberately does not echo any value.
    throw new Error(`[prod-release] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

/**
 * Fire ONE deploy hook. Returns the final HTTP code (200 = accepted).
 * Transport failures (timeout / network) and 5xx are retried with backoff —
 * a 4xx (bad request / unauthorized hook) is an immediate hard failure.
 */
async function fireHook(plane: PlaneHookSpec): Promise<{ ok: boolean; status: number; body: string }> {
  let last: { status: number; body: string } = { status: 0, body: '(no attempt completed)' }
  for (let attempt = 1; attempt <= HOOK_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HOOK_TIMEOUT_MS)
    try {
      const res = await fetch(plane.url, { method: 'POST', signal: controller.signal })
      const body = await res.text()
      last = { status: res.status, body: clip(body, 200) }
      if (res.status === 200) return { ok: true, status: res.status, body: last.body }
      if (res.status >= 500 && attempt < HOOK_RETRIES) {
        console.warn(
          `  [${plane.key}] deploy hook HTTP ${res.status} — retrying (${attempt}/${HOOK_RETRIES - 1})…`,
        )
        await sleep(1500 * attempt)
        continue
      }
      return { ok: false, status: res.status, body: last.body }
    } catch (err) {
      const e = err as Error
      last = { status: 0, body: `transport failure (${e.name}: ${clip(e.message, 120)})` }
      if (attempt < HOOK_RETRIES) {
        console.warn(
          `  [${plane.key}] transport hiccup (${e.name}) — retrying (${attempt}/${HOOK_RETRIES - 1})…`,
        )
        await sleep(1500 * attempt)
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: last.status, body: last.body }
}

async function main(): Promise<void> {
  const planes: PlaneHookSpec[] = [
    { key: 'platform', label: 'scholario-platform (control plane)', envName: 'VERCEL_DEPLOY_HOOK_URL', url: requireEnv('VERCEL_DEPLOY_HOOK_URL') },
    { key: 'school', label: 'scholario-app (school plane)', envName: 'VERCEL_DEPLOY_HOOK_URL_SCHOOL', url: requireEnv('VERCEL_DEPLOY_HOOK_URL_SCHOOL') },
  ]

  console.log('[prod-release:trigger-deploy-hooks] ═══ PRODUCTION DEPLOY HOOKS (two-plane) ═══')
  console.log(`  planes      : ${planes.map((p) => p.key).join(' + ')} (both active planes required)`)
  console.log('  hook URLs   : supplied via environment secrets — never printed')

  // Fire BOTH hooks even if the first fails (maximal progress on an open
  // gate); failures are aggregated afterwards and fail closed.
  const results = new Map<PlaneHookSpec['key'], { ok: boolean; status: number; body: string }>()
  for (const plane of planes) {
    console.log(`\n  ── plane: ${plane.label} (${plane.envName}) ──`)
    const r = await fireHook(plane)
    results.set(plane.key, r)
    console.log(`  hook response: HTTP ${r.status} ${r.ok ? '✓ accepted' : '✖'} ${r.ok ? r.body : clip(r.body, 200)}`)
  }

  const failed = [...results.entries()].filter(([, r]) => !r.ok)
  if (failed.length) {
    console.error('\n[prod-release:trigger-deploy-hooks] ✖ FAILED — deploy hook(s) rejected:')
    for (const [key, r] of failed) {
      console.error(`  [${key}] HTTP ${r.status === 0 ? 'unreachable' : r.status}: ${clip(r.body, 200)}`)
    }
    console.error(
      `  ${failed.length === planes.length ? 'Neither' : 'Only part of the'} plane(s) accepted the trigger — this run is RED.` +
        (failed.length < planes.length
          ? ' One plane may be building while the other is not: the verify-deployment stage (SHA provenance + health on BOTH planes) is the backstop that cannot pass on a partial deploy.'
          : ''),
    )
    process.exit(1)
  }
  console.log('\n[prod-release:trigger-deploy-hooks] ✓ BOTH production deploy hooks accepted — builds started on the two active planes')
}

main().catch((err) => {
  console.error(`\n[prod-release:trigger-deploy-hooks] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})

// Module marker: no imports/exports otherwise — keeps tsc from treating this
// as a global script colliding with the other prod-release scripts' helper
// names (requireEnv, clip, sleep). Zero runtime effect under bun.
export {}
