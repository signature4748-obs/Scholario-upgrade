/**
 * payments/gateway-shared — pieces shared by the tenant (school fee)
 * gateway and the platform gateway: the single AES-256-GCM secret-box
 * implementation and the browser-safe view projection.
 *
 * SERVER-ONLY: carries decryptSecret. Never import from client code.
 */
import { decryptSecret, encryptSecret } from './tenant-gateway'

export { decryptSecret, encryptSecret }

/** Derive the checkout mode from a Razorpay public key id (public info). */
export function razorpayMode(publicKeyId: string | null | undefined): 'live' | 'test' | null {
  if (!publicKeyId) return null
  return publicKeyId.startsWith('rzp_test_') ? 'test' : 'live'
}

/**
 * Browser-safe gateway view — the projection EVERY gateway reader uses.
 * Secrets are structurally impossible here (no cipher fields exist).
 */
export interface GatewayView {
  provider: string | null
  publicKeyId: string | null
  mode: 'live' | 'test' | 'sandbox' | null
  status: string
  lastVerifiedAt: string | null
  /** Whether a webhook secret is configured (boolean only — never the value). */
  webhookSecretConfigured: boolean
}

export function sharedView(
  provider: string,
  publicKeyId: string | null,
  status: string,
  lastVerifiedAt: Date | null,
  webhookSecretConfigured = false,
): GatewayView {
  return {
    provider,
    publicKeyId,
    mode: razorpayMode(publicKeyId),
    status,
    lastVerifiedAt: lastVerifiedAt?.toISOString() ?? null,
    webhookSecretConfigured,
  }
}
