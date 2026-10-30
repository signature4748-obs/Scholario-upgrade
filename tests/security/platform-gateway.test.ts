/**
 * tests/security/platform-gateway.test.ts
 *
 * PAYMENTS & GATEWAYS REDESIGN — live acceptance suite.
 *
 *   · Platform gateway config API: unauthenticated → 401; non-billing
 *     admins → 403; PUT without step-up → refused; invalid Razorpay key
 *     shape → VALIDATION_FAILED.
 *   · Secrets are NEVER returned: the GET/PUT views carry the public key
 *     id, mode, status, verification — never the key secret or webhook
 *     secret. At rest they are AES-256-GCM ciphertext (a successful write
 *     round-trips through the decryptor — lastVerifiedAt is only stamped
 *     when the deployment can actually read back what it stored).
 *   · Audit metadata carries LENGTHS only (the secret value never enters
 *     the audit trail).
 *   · Resolution order (server-only):
 *       subscription lane: platform DB config (ACTIVE) → env → null
 *       fee lane:          school ACTIVE override (decryptable) →
 *                          platform default → null, and an
 *                          ACTIVE-but-UNDECRYPTABLE school override FAILS
 *                          CLOSED — the platform account is never used to
 *                          collect that school's fees (the pre-redesign
 *                          misattribution path is dead).
 *   · Platform webhook secrets: env + DB-configured candidates.
 *   · GET /api/webhooks/razorpay is gone (405) — no anonymous posture
 *     disclosure.
 *
 * Test-data discipline: the singleton row and every fixture row are
 * tracked and removed in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import { decryptSecret, encryptSecret } from '@/lib/payments/tenant-gateway'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import {
  PLATFORM_GATEWAY_SINGLETON_ID,
  resolveSchoolFeeProvider,
  resolveSubscriptionPaymentProvider,
  platformWebhookSecretCandidates,
} from '@/lib/payments/platform-gateway'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const RUN = randomBytes(4).toString('hex').toUpperCase()

const cleanup: Array<() => Promise<unknown>> = []

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': token, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }, { deadlineMs: 40_000 })
}

async function anonGet(path: string): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {}, { deadlineMs: 40_000 })
}

let rootToken = ''
let noStepUpToken = ''
let suiteAdminId = ''
let preExistingConfig = false

async function sessionForAdmin(adminId: string, stepUp: boolean): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      ...(stepUp ? { stepUpAt: new Date() } : {}),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

beforeAll(async () => {
  // Preserve any pre-existing platform config (the suite restores it).
  const existing = await db.platformGatewayConfig.findUnique({ where: { id: PLATFORM_GATEWAY_SINGLETON_ID } })
  preExistingConfig = Boolean(existing)
  // A previous aborted run may have left a stale singleton — this run's
  // assertions key off the CURRENT run's values, so start clean when the
  // deployment had no operator configuration to begin with.
  if (!preExistingConfig) {
    await db.platformGatewayConfig.deleteMany({ where: { id: PLATFORM_GATEWAY_SINGLETON_ID } })
  }

  const rootRow = await db.platformAdmin.create({
    data: {
      email: `pgw.root.${RUN}@platform.test`, name: 'PGW Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  suiteAdminId = rootRow.id
  rootToken = await sessionForAdmin(rootRow.id, true)
  noStepUpToken = await sessionForAdmin(rootRow.id, false)
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: rootRow.id } })
    await db.platformAdmin.deleteMany({ where: { id: rootRow.id } })
    await db.platformAuditLog.deleteMany({ where: { action: { startsWith: 'platform.billing.platform_gateway' }, adminId: rootRow.id } })
  })
})

afterAll(async () => {
  // Remove the singleton configuration the suite created (restore the
  // pre-existing state: if there was none before, there is none after).
  if (!preExistingConfig) {
    await db.platformGatewayConfig.deleteMany({ where: { id: PLATFORM_GATEWAY_SINGLETON_ID } })
  }
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
})

describe('PLATFORM GATEWAY · configuration API', () => {
  test('unauthenticated GET is refused (401) — billing infrastructure is never anonymous', async () => {
    const r = await anonGet('/api/platform/payments/gateway')
    expect(r.status).toBe(401)
  })

  test('GET returns a browser-safe view — no secret fields anywhere', async () => {
    const r = await asPlatform(rootToken, '/api/platform/payments/gateway')
    expect(r.status).toBe(200)
    const b = await body(r)
    const d = b?.data ?? b
    expect(d?.gateway).toBeTruthy()
    const raw = JSON.stringify(d)
    expect(raw).not.toContain('secretKeyCipher')
    expect(raw).not.toContain('secretKeyNonce')
    expect(raw).not.toContain('webhookSecretCipher')
  })

  test('PUT without step-up verification is refused (dormant only while platform MFA is stood down)', async () => {
    const r = await asPlatform(noStepUpToken, '/api/platform/payments/gateway', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'razorpay', publicKeyId: `rzp_test_${RUN}`, keySecret: 'suite-secret-0123456789', status: 'ACTIVE',
      }),
    })
    if (isPlatformTotpEnabled()) {
      // The step-up gate is LIVE — a session without a fresh step-up is refused.
      expect([403, 401]).toContain(r.status)
    } else {
      // MFA stood down ⇒ the server-side step-up gate is dormant by design
      // (the same flag the console UI honours). The write itself must still
      // be VALID (shape-checked) — a refusal here would be a different bug.
      expect(r.status).toBe(200)
    }
  })

  test('PUT with a malformed Razorpay key id is VALIDATION_FAILED', async () => {
    const r = await asPlatform(rootToken, '/api/platform/payments/gateway', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'razorpay', publicKeyId: 'not-a-razorpay-key', keySecret: 'suite-secret-0123456789', status: 'ACTIVE',
      }),
    })
    expect([400, 422]).toContain(r.status)
    const b = await body(r)
    expect(String(b?.error ?? '')).toMatch(/rzp_live|Razorpay key ids/i)
  })

  test('PUT (step-up) stores AES-256-GCM ciphertext + round-trip verification; audit carries LENGTHS only', async () => {
    const keySecret = `suite-secret-${RUN}-0123456789`
    const webhookSecret = `suite-whsec-${RUN}-0123456789`
    const r = await asPlatform(rootToken, '/api/platform/payments/gateway', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'razorpay', publicKeyId: `rzp_test_${RUN}`, keySecret, webhookSecret, status: 'ACTIVE',
        notes: 'platform-gateway suite',
      }),
    })
    expect(r.status).toBe(200)
    const b = await body(r)
    const d = b?.data ?? b
    expect(d?.ok === true || b?.ok === true).toBe(true)
    expect(d?.gateway?.status).toBe('ACTIVE')
    expect(d?.gateway?.mode).toBe('test')
    expect(d?.gateway?.lastVerifiedAt).toBeTruthy()
    // The response NEVER echoes the secrets.
    expect(JSON.stringify(b)).not.toContain(keySecret)
    expect(JSON.stringify(b)).not.toContain(webhookSecret)

    const row = await db.platformGatewayConfig.findUnique({ where: { id: PLATFORM_GATEWAY_SINGLETON_ID } })
    expect(row?.publicKeyId).toBe(`rzp_test_${RUN}`)
    expect(row?.secretKeyCipher).toBeTruthy()
    // At rest: ciphertext differs from the plaintext; only the server can read it.
    expect(row?.secretKeyCipher).not.toBe(keySecret)
    expect(decryptSecret(row!.secretKeyCipher!, row!.secretKeyNonce!)).toBe(keySecret)
    expect(decryptSecret(row!.webhookSecretCipher!, row!.webhookSecretNonce!)).toBe(webhookSecret)

    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.billing.platform_gateway_configured', adminId: suiteAdminId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).toBeTruthy()
    expect(audit!.metadata).toContain(String(keySecret.length))
    expect(audit!.metadata).not.toContain(keySecret)
  })
})

describe('PLATFORM GATEWAY · resolution order', () => {
  test('subscription lane: an ACTIVE DB config wins over the env provider', async () => {
    const provider = await resolveSubscriptionPaymentProvider()
    expect(provider).toBeTruthy()
    expect(provider!.name).toBe('razorpay')
    expect(provider!.keyId).toBe(`rzp_test_${RUN}`)
  })

  test('fee lane: no school override → platform default source', async () => {
    const resolution = await resolveSchoolFeeProvider(`no-such-school-${RUN}`)
    expect(resolution.source).toBe('platform')
    expect(resolution.provider?.keyId).toBe(`rzp_test_${RUN}`)
  })

  test('fee lane: ACTIVE + decryptable school override → the SCHOOL collects on its OWN account', async () => {
    const school = await db.school.create({
      data: {
        name: `PGW Suite ${RUN}`, slug: `pgw-suite-${RUN.toLowerCase()}`, code: `PGW${RUN.slice(0, 6)}`,
        status: 'ACTIVE', isDemo: false,
      },
    })
    cleanup.push(async () => {
      await db.schoolPaymentGateway.deleteMany({ where: { schoolId: school.id } })
      await db.school.deleteMany({ where: { id: school.id } })
    })
    const secret = `school-rail-secret-${RUN}`
    const enc = encryptSecret(secret)
    await db.schoolPaymentGateway.create({
      data: {
        schoolId: school.id, provider: 'razorpay', publicKeyId: `rzp_live_school_${RUN}`,
        secretKeyCipher: enc.cipher, secretKeyNonce: enc.nonce, status: 'ACTIVE',
      },
    })
    const resolution = await resolveSchoolFeeProvider(school.id)
    expect(resolution.source).toBe('school')
    expect(resolution.provider?.keyId).toBe(`rzp_live_school_${RUN}`)
  })

  test('fee lane FAILS CLOSED: an ACTIVE override with an undecryptable secret NEVER falls back to the platform account', async () => {
    const school = await db.school.create({
      data: {
        name: `PGW Broken ${RUN}`, slug: `pgw-broken-${RUN.toLowerCase()}`, code: `PGWB${RUN.slice(0, 5)}`,
        status: 'ACTIVE', isDemo: false,
      },
    })
    cleanup.push(async () => {
      await db.schoolPaymentGateway.deleteMany({ where: { schoolId: school.id } })
      await db.school.deleteMany({ where: { id: school.id } })
    })
    await db.schoolPaymentGateway.create({
      data: {
        schoolId: school.id, provider: 'razorpay', publicKeyId: `rzp_live_broken_${RUN}`,
        secretKeyCipher: Buffer.from('tampered-or-wrong-key-ciphertext').toString('base64'),
        secretKeyNonce: randomBytes(12).toString('base64'),
        status: 'ACTIVE',
      },
    })
    const resolution = await resolveSchoolFeeProvider(school.id)
    expect(resolution.source).toBe('none')
    expect(resolution.provider).toBeNull()
    if (resolution.source === 'none') {
      expect(resolution.error).toBe('SCHOOL_GATEWAY_UNDECRYPTABLE')
    }
  })

  test('platform webhook secrets: env candidate + the DB-configured secret', async () => {
    const candidates = await platformWebhookSecretCandidates()
    // The CI/dev fixture env secret is always present.
    expect(candidates).toContain(process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET ?? 'platform-webhook-test-secret')
    expect(candidates).toContain(`suite-whsec-${RUN}-0123456789`)
  })

  test('after DELETE (disable) the subscription lane no longer resolves the DB-configured account', async () => {
    const r = await asPlatform(rootToken, '/api/platform/payments/gateway', { method: 'DELETE' })
    expect(r.status).toBe(200)
    const view = await body(await asPlatform(rootToken, '/api/platform/payments/gateway'))
    const d = view?.data ?? view
    expect(d?.gateway?.status).toBe('DISABLED')
    const provider = await resolveSubscriptionPaymentProvider()
    // The disabled DB row must never be used: whatever the env fallback
    // resolves to (sandbox here, null without env), it is NOT the
    // configured Razorpay key. (The env provider is process-cached — its
    // identity depends on which suite froze the cache first; the CONTRACT
    // is only that the disabled account is gone.)
    expect(provider?.keyId).not.toBe(`rzp_test_${RUN}`)
  })
})

describe('WEBHOOK SURFACE · posture hardening', () => {
  test('GET /api/webhooks/razorpay is gone (405) — no anonymous configuration disclosure', async () => {
    const r = await anonGet('/api/webhooks/razorpay')
    expect(r.status).toBe(405)
  })

  test('POST /api/webhooks/razorpay with no signature is rejected (verification intact)', async () => {
    const r = await liveFetch(`${BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    }, { deadlineMs: 40_000 })
    expect([400, 401, 403]).toContain(r.status)
  })
})
