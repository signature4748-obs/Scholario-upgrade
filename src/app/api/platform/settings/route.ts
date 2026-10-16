import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  validateFlagPatch,
  FLAGGABLE_MODULES,
  parseFlags,
} from '@/lib/platform/module-flags'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/**
 * LEGACY-COMPATIBLE SELECT for the platform settings route. This route
 * serves the console Settings page — a CORE control-plane surface — and
 * consumes ONLY the legacy columns (showDemoSchool, modules,
 * supportMaxDuration). A full-row platformSetting read also selects
 * `subscriptionConfig` (added by the owner-gated pending subscription
 * migration) and P2022s on a pre-migration database, turning the
 * Settings page's own endpoint into a typed 503
 * SUBSCRIPTION_SYSTEM_PENDING — exactly the failure the acceptance
 * matrix reported. Selecting exactly these columns works on both
 * schema states; the commercial-model config surface (which genuinely
 * requires the pending column) is served separately by
 * /api/platform/subscriptions/config with its own honest degradation.
 */
const PLATFORM_SETTINGS_SELECT = {
  showDemoSchool: true,
  modules: true,
  supportMaxDuration: true,
} as const

/**
 * GET /api/platform/settings — platform settings + module master
 * switches. Readable by ANY platform admin (config visibility);
 * mutation requires settings.manage (PATCH below).
 */
export async function GET() {
  return withPlatform({}, async () => {
    let setting = await db.platformSetting.findUnique({
      where: { id: 'global' },
      select: PLATFORM_SETTINGS_SELECT,
    })
    if (!setting) {
      setting = await db.platformSetting.create({
        data: { id: 'global' },
        select: PLATFORM_SETTINGS_SELECT,
      })
    }
    return {
      showDemoSchool: setting.showDemoSchool,
      modules: parseFlags(setting.modules),
      supportMaxDuration: setting.supportMaxDuration,
      flaggableModules: FLAGGABLE_MODULES,
    }
  })
}

/**
 * PATCH /api/platform/settings — platform settings + module master
 * switches (product-wide availability). Permission: settings.manage.
 */
export async function PATCH(req: NextRequest) {
  return withPlatform(
    { permission: 'settings.manage' },
    async (ctx) => {
      const raw = await req.json().catch(() => ({}))
      const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

      const changes: Record<string, unknown> = {}
      let setting = await db.platformSetting.findUnique({
        where: { id: 'global' },
        select: PLATFORM_SETTINGS_SELECT,
      })
      if (!setting) {
        setting = await db.platformSetting.create({
          data: { id: 'global' },
          select: PLATFORM_SETTINGS_SELECT,
        })
      }

      if (typeof body.showDemoSchool === 'boolean' && body.showDemoSchool !== setting.showDemoSchool) {
        changes.showDemoSchool = body.showDemoSchool
      }
      if (typeof body.supportMaxDuration === 'number') {
        const dur = Math.round(body.supportMaxDuration)
        if (dur < 5 || dur > 480) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: 'supportMaxDuration must be between 5 and 480 minutes',
          })
        }
        if (dur !== setting.supportMaxDuration) changes.supportMaxDuration = dur
      }
      if (body.modules !== undefined) {
        const modulePatch = validateFlagPatch(body.modules as Record<string, unknown>)
        if (Object.keys(modulePatch).length > 0) {
          changes.modules = { ...parseFlags(setting.modules), ...modulePatch }
        }
      }

      if (Object.keys(changes).length === 0) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Nothing to update' })
      }

      await db.platformSetting.update({
        where: { id: 'global' },
        data: {
          ...(changes.showDemoSchool !== undefined ? { showDemoSchool: changes.showDemoSchool as boolean } : {}),
          ...(changes.supportMaxDuration !== undefined ? { supportMaxDuration: changes.supportMaxDuration as number } : {}),
          ...(changes.modules !== undefined ? { modules: JSON.stringify(changes.modules) } : {}),
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.settings.updated',
        targetType: 'SETTING',
        targetId: 'global',
        ip: clientIpFromHeaders(req.headers),
        reason: 'platform settings updated',
        metadata: { changedFields: Object.keys(changes) },
      })

      return { ok: true, changes }
    },
    { method: 'PATCH' },
  )
}
