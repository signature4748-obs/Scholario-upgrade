import { api } from '@/lib/api'
import { isSupabaseAuthEnabled } from '@/lib/auth/supabase'

export const runtime = 'nodejs'

/**
 * GET /api/platform/auth/supabase/status — platform-plane twin of
 * /api/auth/supabase/status (honest capability probe for the platform
 * login door; no secrets, flags only).
 */
export async function GET() {
  return api(async () => {
    const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    // SMS delivery capability is a deployment-level fact (dashboard-only
    // credentials) — honest BLOCKED default until the owner configures a
    // real SMS provider and acknowledges it (verified live: the project
    // has Twilio selected with zero credentials; the provider answers
    // `otp_disabled`).
    const smsConfigured = process.env.SUPABASE_SMS_PROVIDER_CONFIGURED === 'on'
    return {
      enabled: isSupabaseAuthEnabled() && configured,
      capabilities: {
        emailPassword: configured,
        emailSignup: false, // platform admins are provisioned by the OWNER, never public signup
        phoneOtp: configured && smsConfigured ? 'available' : 'blocked-no-provider',
        google: false,
      },
    }
  })
}
