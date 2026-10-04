import { withUser, schoolScoped } from '@/lib/api'
import { getTenantPaymentProvider } from '@/lib/payments/tenant-gateway'

export const runtime = 'nodejs'

/// GET /api/student/payments/config
///
/// Capability probe for the student self-service checkout. Tells the UI
/// whether online payment is available at all, which provider is active
/// and (for Razorpay) the PUBLIC key id the browser needs for Razorpay
/// Checkout. Sandbox mode has no key — the confirmation is minted
/// server-side at /order time and relayed by the client to /verify.
///
/// Returns:
///   { available, provider: 'razorpay'|'sandbox'|null,
///     mode: 'live'|'test'|'sandbox'|null, keyId: string|null }
///
/// available=false → the UI must show "Online payment isn't available.
/// Please contact the school office." (outstanding amounts are computed
/// client-side from the fees list — no hint is returned here).
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user) // RLS — every student route is school-scoped

      // SaaS-HARDENING (§3B) — tenant-scoped resolution: the school's OWN
      // gateway account (if configured + ACTIVE) wins over the deployment
      // provider. Only the PUBLIC key id/mode reach the browser here —
      // secrets never leave the server.
      const provider = await getTenantPaymentProvider(schoolId)
      return {
        available: !!provider,
        provider: provider?.name ?? null,
        mode: provider?.mode ?? null,
        keyId: provider?.keyId ?? null,
      }
    },
    { roles: ['STUDENT'] }
  )
}
