import { NextRequest } from 'next/server'
import { api } from '@/lib/api'
import { isGoogleAuthConfigured } from '@/lib/platform/google'

export const runtime = 'nodejs'

/**
 * GET /api/platform/auth/google/status — PUBLIC.
 *
 * Honest capability probe for the login page (and the console): is
 * Google sign-in configured on this deployment? Returns ONLY a
 * boolean — no client id, no redirect URI, no configuration detail.
 * The login UI shows "Continue with Google" only when enabled, so an
 * unconfigured deployment never advertises a dead end.
 */
export async function GET(_req: NextRequest) {
  return api(async () => ({ enabled: isGoogleAuthConfigured() }))
}
