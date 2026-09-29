import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { withAuthz } from '@/lib/security/authz'
import { auditEvent } from '@/lib/security/audit'
import { AppError, newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

// GET platform settings (3-d audit fix: previously ANY authenticated user
// could read the platform config; now gated to SUPER_ADMIN —
// withAuthz role gate + tenant 'any', the platform admin has no school).
export function GET() {
  return withAuthz({ roles: ['SUPER_ADMIN'], tenant: 'any' }, async () => {
    let setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
    if (!setting) {
      setting = await db.platformSetting.create({
        data: { id: 'global', showDemoSchool: true },
      })
    }
    return {
      showDemoSchool: setting.showDemoSchool,
    }
  }) as Promise<Response>
}

// UPDATE platform settings (Super Admin only) — Phase 1: audited +
// rate-limited + strict-body (unexpected fields rejected).
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      enforceRateLimit(`rl:platformcfg:${user.id}`, RATE_LIMITS.sessionRevoke)

      const raw = await req.json().catch(() => ({}))
      const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      const unknownFields = Object.keys(body).filter((k) => k !== 'showDemoSchool')
      if (unknownFields.length > 0) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Unexpected field(s): ${unknownFields.join(', ')}`,
        })
      }
      const showDemoSchool = typeof body.showDemoSchool === 'boolean' ? body.showDemoSchool : true

      const setting = await db.platformSetting.upsert({
        where: { id: 'global' },
        update: { showDemoSchool },
        create: { id: 'global', showDemoSchool },
      })

      // Platform administrative actions are audited (Phase-0 baseline
      // H-2/B-12 remediation — this mutation was previously unlogged).
      await auditEvent({
        userId: user.id,
        action: 'PLATFORM_SETTING_CHANGE',
        requestId,
        detail: `showDemoSchool → ${setting.showDemoSchool}`,
      }).catch(() => {})

      return {
        showDemoSchool: setting.showDemoSchool,
      }
    },
    { roles: ['SUPER_ADMIN'] }
  )
}
