import { api } from '@/lib/api'
import { isSupabaseAuthEnabled } from '@/lib/auth/supabase'

export const runtime = 'nodejs'

/**
 * GET /api/auth/supabase/status — the school plane's HONEST capability
 * probe for the login door. The client renders the provider card only
 * when `enabled`; every capability states exactly what works today:
 *
 *   · emailPassword  — true when the provider env is configured
 *   · emailSignup    — true (provider signups + email verification);
 *     a signup NEVER provisions a Scholario account (NO_ACCOUNT until
 *     linked by an owner or provisioned by the platform)
 *   · phoneOtp       — 'available' | 'blocked-no-provider': delivery is
 *     BLOCKED until a real SMS provider is configured in the Supabase
 *     dashboard AND the deployment acknowledges it
 *     (SUPABASE_SMS_PROVIDER_CONFIGURED=on). The live project today has
 *     Twilio selected with ZERO credentials — the provider itself answers
 *     `otp_disabled` (verified 2026-10-11) — so the default is the honest
 *     blocked state, never a guess.
 *   · google         — false until GOOGLE_* provider credentials exist
 *
 * No secrets are returned; only flags.
 */
export async function GET() {
  return api(async () => {
    const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    // SMS delivery capability is a DEPLOYMENT-level fact the app cannot
    // verify at runtime (dashboard-only provider credentials): the honest
    // default is BLOCKED until the owner configures a real provider and
    // acknowledges it with SUPABASE_SMS_PROVIDER_CONFIGURED=on.
    const smsConfigured = process.env.SUPABASE_SMS_PROVIDER_CONFIGURED === 'on'
    return {
      enabled: isSupabaseAuthEnabled() && configured,
      capabilities: {
        emailPassword: configured,
        emailSignup: configured,
        phoneOtp: configured && smsConfigured ? 'available' : 'blocked-no-provider',
        google: false,
      },
    }
  })
}
