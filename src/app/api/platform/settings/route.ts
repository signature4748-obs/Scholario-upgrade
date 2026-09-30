import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { validateFlagPatch, FLAGGABLE_MODULES, parseFlags } from '@/lib/platform/module-flags'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/**
 * GET /api/platform/settings — platform settings + module master
 * switches. Readable by ANY platform admin (config visibility);
 * mutation requires settings.manage (PATCH below).
 */
export async function GET() {
  return withPlatform({}, async () => {
    let setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
    if (!setting) {
      setting = await db.platformSetting.create({ data: { id: 'global' } })
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
      let setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
      if (!setting) {
        setting = await db.platformSetting.create({ data: { id: 'global' } })
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
