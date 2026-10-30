/**
 * payments/platform-gateway — PLATFORM-LEVEL payment gateway configuration
 * (the Payments & Gateways redesign, 2026-10-30).
 *
 * This is the deployment's OWN provider account. It collects SCHOLARIO
 * SUBSCRIPTION payments (Model A/B online orders) and acts as the FALLBACK
 * rail for schools that have not configured their own fee gateway. It is
 * NEVER the school's fee-collecting account when the school has its own
 * ACTIVE, decryptable override — and a school override that is ACTIVE but
 * UNDECRYPTABLE fails CLOSED (audited) instead of silently charging the
 * platform's own account (the pre-redesign misattribution risk).
 *
 * DESIGN CONTRACT:
 *   · Singleton row (id 'singleton') — PlatformGatewayConfig.
 *   · Secrets (key secret, webhook secret) are stored AES-256-GCM
 *     encrypted at rest (same scheme as SchoolPaymentGateway), decrypted
 *     ONLY inside server code at resolution time, and NEVER returned by
 *     any API or audit record (length-only audit metadata).
 *   · Resolution order (explicit, server-only):
 *       fee lane          school ACTIVE override (decryptable)
 *                       → platform DB config (ACTIVE, decryptable)
 *                       → env deployment provider → null
 *       subscription lane platform DB config (ACTIVE) → env provider → null
 *   · SCHEMA-PENDING TOLERANCE: on a pre-migration database every config
 *     read degrades to "not configured" (env fallback keeps working) —
 *     the migration is applied DB-first in the release pipeline, this is
 *     belt-and-braces for dev databases.
 *
 * SERVER-ONLY: decrypts gateway secrets. Never import from client code.
 */
import { db } from '@/lib/db'
import { isSubscriptionSchemaPendingError } from '@/lib/platform/subscription-schema'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  decryptSecret,
  encryptSecret,
  sharedView,
  type GatewayView,
} from './gateway-shared'
import { getPaymentProvider, RazorpayProvider, type PaymentProvider } from './provider'

/** Fixed singleton row id (enforced in code, not by the schema). */
export const PLATFORM_GATEWAY_SINGLETON_ID = 'singleton'

const PROVIDERS = ['razorpay'] as const

/* ─────────── configuration access ─────────── */

/** Raw config row (schema-pending tolerant: null = not provisioned). */
export async function loadPlatformGatewayRow() {
  try {
    return await db.platformGatewayConfig.findUnique({
      where: { id: PLATFORM_GATEWAY_SINGLETON_ID },
    })
  } catch (e) {
    if (isSubscriptionSchemaPendingError(e)) return null
    throw e
  }
}

export interface PlatformGatewayView extends GatewayView {
  /** Whether the deployment env provider exists underneath (fallback). */
  envFallback: boolean
  /** Effective resolution note for the UI (no secrets). */
  resolution: string
}

/** Browser-safe view of the platform gateway (never secrets). */
export async function platformGatewayView(): Promise<PlatformGatewayView> {
  const row = await loadPlatformGatewayRow()
  const envProvider = getPaymentProvider()
  const base = row
    ? sharedView(row.provider, row.publicKeyId, row.status, row.lastVerifiedAt, Boolean(row.webhookSecretCipher))
    : null
  const status = base?.status ?? 'NOT_CONFIGURED'
  let resolution: string
  if (base && base.status === 'ACTIVE') resolution = 'Platform gateway (database configuration)'
  else if (envProvider) resolution = 'Deployment environment configuration (fallback)'
  else resolution = 'No online payment provider configured'
  return {
    provider: base?.provider ?? null,
    publicKeyId: base?.publicKeyId ?? null,
    mode: base?.mode ?? null,
    status,
    lastVerifiedAt: base?.lastVerifiedAt ?? null,
    webhookSecretConfigured: base?.webhookSecretConfigured ?? false,
    envFallback: Boolean(envProvider),
    resolution,
  }
}

/* ─────────── configuration writes ─────────── */

export interface SavePlatformGatewayInput {
  provider?: string
  publicKeyId: string
  keySecret: string
  webhookSecret?: string
  status: 'ACTIVE' | 'PENDING' | 'DISABLED'
  notes?: string
}

/**
 * Create or update the singleton platform gateway config. Secrets are
 * encrypted at rest; a successful write performs a decrypt ROUND-TRIP
 * (the stored ciphertext is decrypted back) and stamps lastVerifiedAt —
 * a stored secret the deployment could never read is a misconfiguration,
 * not a success. Audit metadata carries lengths only.
 */
export async function savePlatformGatewayConfig(
  input: SavePlatformGatewayInput,
  adminId: string,
  ip: string | null,
): Promise<PlatformGatewayView> {
  const provider = input.provider ?? 'razorpay'
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    throw new TypeError('unsupported provider')
  }
  if (provider === 'razorpay' && !/^rzp_(live|test)_/.test(input.publicKeyId)) {
    throw new TypeError('razorpay key id shape')
  }
  const secretEnc = encryptSecret(input.keySecret)
  // Verification = the deployment can actually read back what it stores.
  const verified = decryptSecret(secretEnc.cipher, secretEnc.nonce) === input.keySecret
  const webhookEnc = input.webhookSecret ? encryptSecret(input.webhookSecret) : null

  await db.platformGatewayConfig.upsert({
    where: { id: PLATFORM_GATEWAY_SINGLETON_ID },
    create: {
      id: PLATFORM_GATEWAY_SINGLETON_ID,
      provider,
      publicKeyId: input.publicKeyId,
      secretKeyCipher: secretEnc.cipher,
      secretKeyNonce: secretEnc.nonce,
      webhookSecretCipher: webhookEnc?.cipher ?? null,
      webhookSecretNonce: webhookEnc?.nonce ?? null,
      status: input.status,
      configuredById: adminId,
      lastVerifiedAt: verified ? new Date() : null,
      notes: input.notes ?? null,
    },
    update: {
      provider,
      publicKeyId: input.publicKeyId,
      secretKeyCipher: secretEnc.cipher,
      secretKeyNonce: secretEnc.nonce,
      webhookSecretCipher: webhookEnc?.cipher ?? null,
      webhookSecretNonce: webhookEnc?.nonce ?? null,
      status: input.status,
      configuredById: adminId,
      lastVerifiedAt: verified ? new Date() : null,
      notes: input.notes ?? undefined,
    },
  })

  await platformAuditEvent({
    adminId,
    action: 'platform.billing.platform_gateway_configured',
    targetType: 'SETTING',
    targetId: PLATFORM_GATEWAY_SINGLETON_ID,
    ip,
    reason: input.notes ?? 'Platform payment gateway configured',
    metadata: {
      provider,
      publicKeyId: input.publicKeyId,
      status: input.status,
      keySecretLength: input.keySecret.length,
      webhookSecretConfigured: Boolean(input.webhookSecret),
      verifiedRoundTrip: verified,
    },
  })

  return platformGatewayView()
}

/** Disable the platform gateway (falls back to the env provider, if any). */
export async function disablePlatformGatewayConfig(adminId: string, ip: string | null): Promise<PlatformGatewayView> {
  const row = await loadPlatformGatewayRow()
  if (row) {
    await db.platformGatewayConfig.update({
      where: { id: PLATFORM_GATEWAY_SINGLETON_ID },
      data: { status: 'DISABLED', configuredById: adminId },
    })
    await platformAuditEvent({
      adminId,
      action: 'platform.billing.platform_gateway_disabled',
      targetType: 'SETTING',
      targetId: PLATFORM_GATEWAY_SINGLETON_ID,
      ip,
      reason: 'Platform payment gateway disabled',
      metadata: { provider: row.provider },
    })
  }
  return platformGatewayView()
}

/* ─────────── provider resolution ─────────── */

/**
 * The SUBSCRIPTION lane's provider: platform DB config (ACTIVE,
 * decryptable) wins; the env deployment provider is the fallback; null =
 * online subscription payments unavailable (fail-closed order creation).
 */
export async function resolveSubscriptionPaymentProvider(): Promise<PaymentProvider | null> {
  const row = await loadPlatformGatewayRow()
  if (row && row.status === 'ACTIVE' && row.provider === 'razorpay' && row.publicKeyId) {
    const secret = row.secretKeyCipher && row.secretKeyNonce
      ? decryptSecret(row.secretKeyCipher, row.secretKeyNonce)
      : null
    if (secret) return new RazorpayProvider(row.publicKeyId, secret)
  }
  return getPaymentProvider()
}

export type FeeProviderResolution =
  | { source: 'school'; provider: PaymentProvider }
  | { source: 'platform'; provider: PaymentProvider }
  | { source: 'none'; provider: null; error?: 'SCHOOL_GATEWAY_UNDECRYPTABLE' }

/**
 * The FEE lane's provider for a school, with an EXPLICIT resolution chain:
 *   1. school's own ACTIVE gateway row (decryptable secret) — the school's
 *      account collects its own fees;
 *   2. platform DB config / env deployment provider — the fallback rail
 *      for schools without their own gateway;
 *   3. none.
 * An ACTIVE-but-UNDECRYPTABLE school override NEVER silently falls through
 * to the platform account: that would charge the platform's own gateway
 * for school-collected fees (misattributed money). It fails CLOSED with a
 * typed error the caller surfaces as an actionable, honest message.
 */
export async function resolveSchoolFeeProvider(schoolId: string): Promise<FeeProviderResolution> {
  let row: {
    status: string
    provider: string
    publicKeyId: string | null
    secretKeyCipher: string | null
    secretKeyNonce: string | null
  } | null = null
  try {
    row = await db.schoolPaymentGateway.findUnique({
      where: { schoolId },
      select: {
        status: true,
        provider: true,
        publicKeyId: true,
        secretKeyCipher: true,
        secretKeyNonce: true,
      },
    })
  } catch (e) {
    if (!isSubscriptionSchemaPendingError(e)) throw e
    row = null
  }
  if (row && row.status === 'ACTIVE' && row.provider === 'razorpay' && row.publicKeyId) {
    const secret = row.secretKeyCipher && row.secretKeyNonce
      ? decryptSecret(row.secretKeyCipher, row.secretKeyNonce)
      : null
    if (secret) return { source: 'school', provider: new RazorpayProvider(row.publicKeyId, secret) }
    // The school EXPECTS its own rail (operator configured it ACTIVE) and
    // the deployment cannot read it. Charging the platform account instead
    // would misattribute school fee money — fail closed.
    return { source: 'none', provider: null, error: 'SCHOOL_GATEWAY_UNDECRYPTABLE' }
  }
  const platform = await resolveSubscriptionPaymentProvider()
  if (platform) return { source: 'platform', provider: platform }
  return { source: 'none', provider: null }
}

/**
 * Platform subscription webhook secret candidates for
 * /api/webhooks/platform-subscription: the env secret (back-compat)
 * plus the DB-configured platform webhook secret. Used ONLY by the
 * signature check; never logged or returned.
 */
export async function platformWebhookSecretCandidates(): Promise<string[]> {
  const candidates: string[] = []
  const envSecret = process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET?.trim()
  if (envSecret) candidates.push(envSecret)
  const row = await loadPlatformGatewayRow()
  if (row?.webhookSecretCipher && row.webhookSecretNonce && row.status === 'ACTIVE') {
    const secret = decryptSecret(row.webhookSecretCipher, row.webhookSecretNonce)
    if (secret) candidates.push(secret)
  }
  return candidates
}
