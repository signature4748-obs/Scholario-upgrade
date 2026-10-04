/**
 * payments/tenant-gateway — TENANT-SCOPED school-fee payment gateway
 * configuration (the B-domain of §3: each school's OWN provider account
 * for collecting STUDENT FEES).
 *
 * DESIGN (SaaS-HARDENING §3B):
 *   · School A → Gateway Account A, School B → Gateway Account B —
 *     configuration is stored per-tenant (SchoolPaymentGateway row) and
 *     is NEVER shared or inferred across tenants.
 *   · Secrets (key secret, webhook secret) are stored AES-256-GCM
 *     encrypted at rest and decrypted ONLY inside server code at
 *     payment-resolution time. They are NEVER returned to the browser —
 *     the public key id is the only browser-safe value (checkout needs
 *     it). The platform-configuration API also never echoes secrets
 *     back (write-only fields).
 *   · Resolution order for a school's fee checkout: the tenant's ACTIVE
 *     gateway row → the deployment-level env gateway (back-compat) →
 *     sandbox (dev) → null (offline collection only).
 *   · Provider abstraction preserved: tenant rows carry a `provider`
 *     discriminator ('razorpay' today, future providers plug in without
 *     rewriting fee logic).
 *
 * SERVER-ONLY: decrypts gateway secrets. Never import from client code.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { getPaymentProvider, RazorpayProvider, type PaymentProvider } from './provider'

/* ─────────── AES-256-GCM secret storage ─────────── */

/**
 * Stable key derivation. SCHOOL_GATEWAY_ENC_KEY is canonical; dev may
 * fall back to deriving from FILE_SIGNING_SECRET (stable across
 * restarts). With neither configured, an ephemeral process key is used
 * (dev-only posture: previously stored secrets fail loudly to decrypt
 * instead of silently mis-decrypting).
 */
function encryptionKey(): Buffer {
  const raw =
    process.env.SCHOOL_GATEWAY_ENC_KEY?.trim() ||
    process.env.FILE_SIGNING_SECRET?.trim() ||
    null
  if (raw) return createHash('sha256').update(`scholario-gateway:${raw}`).digest()
  const proc = process as unknown as { __scholarioEphemeralGatewayKey?: Buffer }
  if (!proc.__scholarioEphemeralGatewayKey) {
    proc.__scholarioEphemeralGatewayKey = randomBytes(32)
  }
  return proc.__scholarioEphemeralGatewayKey
}

export function encryptSecret(plaintext: string): { cipher: string; nonce: string } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // auth tag packed at the head of the ciphertext blob
  return {
    cipher: Buffer.concat([tag, enc]).toString('base64'),
    nonce: nonce.toString('base64'),
  }
}

export function decryptSecret(cipherB64: string, nonceB64: string): string | null {
  try {
    const blob = Buffer.from(cipherB64, 'base64')
    const nonce = Buffer.from(nonceB64, 'base64')
    if (blob.length < 16 || nonce.length !== 12) return null
    const tag = blob.subarray(0, 16)
    const body = blob.subarray(16)
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    // Wrong key (rotated env) or tampered ciphertext — fail CLOSED.
    return null
  }
}

/* ─────────── tenant resolution ─────────── */

export interface TenantGatewayView {
  /** Browser-safe projection (NO secrets) for checkout config. */
  schoolId: string
  provider: string
  publicKeyId: string | null
  mode: 'live' | 'test' | 'sandbox' | null
  status: string
}

/** Browser-safe view of a school's gateway (never secrets). */
export async function tenantGatewayView(schoolId: string): Promise<TenantGatewayView | null> {
  const row = await db.schoolPaymentGateway.findUnique({ where: { schoolId } })
  if (!row) return null
  const mode =
    row.provider === 'razorpay' && row.publicKeyId
      ? row.publicKeyId.startsWith('rzp_test_')
        ? 'test'
        : 'live'
      : null
  return {
    schoolId,
    provider: row.provider,
    publicKeyId: row.publicKeyId,
    mode,
    status: row.status,
  }
}

/**
 * Resolve the payment provider for a school's fee checkout. Tenant row
 * (ACTIVE, decryptable secret) wins; otherwise the deployment-level
 * provider; otherwise null. The returned provider carries the tenant's
 * OWN keys — orders and verifications run against the school's account.
 */
export async function getTenantPaymentProvider(schoolId: string): Promise<PaymentProvider | null> {
  const row = await db.schoolPaymentGateway.findUnique({ where: { schoolId } })
  if (row && row.status === 'ACTIVE' && row.provider === 'razorpay' && row.publicKeyId) {
    const secret = row.secretKeyCipher && row.secretKeyNonce
      ? decryptSecret(row.secretKeyCipher, row.secretKeyNonce)
      : null
    if (secret) {
      return new RazorpayProvider(row.publicKeyId, secret)
    }
    // Misconfigured tenant row (undecryptable secret) — fall through to
    // the deployment provider, never fail open to a broken checkout.
  }
  return getPaymentProvider()
}

/**
 * The webhook secret candidates for the Razorpay receiver: the global
 * env secret plus every ACTIVE tenant webhook secret (a multi-account
 * receiver verifies against all candidates; the matching secret
 * identifies the account). Secrets never leave this module's return
 * type (consumed only by the signature check).
 */
export async function webhookSecretCandidates(): Promise<Array<{ secret: string; schoolId: string | null }>> {
  const candidates: Array<{ secret: string; schoolId: string | null }> = []
  const envSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  if (envSecret) candidates.push({ secret: envSecret, schoolId: null })
  const rows = await db.schoolPaymentGateway.findMany({
    where: { status: 'ACTIVE', provider: 'razorpay', webhookSecretCipher: { not: null } },
    select: { schoolId: true, webhookSecretCipher: true, webhookSecretNonce: true },
    take: 500,
  })
  for (const row of rows) {
    if (row.webhookSecretCipher && row.webhookSecretNonce) {
      const secret = decryptSecret(row.webhookSecretCipher, row.webhookSecretNonce)
      if (secret) candidates.push({ secret, schoolId: row.schoolId })
    }
  }
  return candidates
}

/** timing-safe webhook signature match against a candidate secret. */
export function webhookSignatureMatches(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
