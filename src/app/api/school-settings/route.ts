import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import {
  getSchoolConfig,
  identityPatchFrom,
  brandingPatchFrom,
  settingsPatchFrom,
  mergeSettings,
} from '@/lib/school-config'

export const runtime = 'nodejs'

/**
 * GET /api/school-settings — the school's canonical configuration
 * (identity columns + branding + settings JSON). Any authenticated
 * school user may READ their own school's configuration (documents,
 * login, and module defaults all consume it); the tenant comes from the
 * session — a client-provided schoolId is never trusted.
 */
export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const config = await getSchoolConfig(schoolId)
      if (!config) {
        return NextResponse.json(
          { success: false, error: 'School configuration not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      return NextResponse.json(
        { success: true, data: config },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

/**
 * PATCH /api/school-settings — write school configuration.
 *
 * PRINCIPAL / MANAGEMENT only. Accepts three validated fragments:
 *   { identity: { name?, shortName?, tagline?, … } }      → School columns
 *   { branding: { primaryColor?, accentColor?, … } }       → School columns (contrast-checked)
 *   { settings: { timetable?: {...}, library?: {...} } }   → settings JSON (validated merge)
 *
 * Every write is audit-logged; every field is length/hex/contrast
 * validated server-side; the tenant is session-derived.
 */
export async function PATCH(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can change school settings.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, error: 'Invalid request body.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const patch: Record<string, unknown> = {}
      const changed: string[] = []

      try {
        if (body.identity && typeof body.identity === 'object' && !Array.isArray(body.identity)) {
          const idPatch = identityPatchFrom(body.identity)
          Object.assign(patch, idPatch)
          changed.push('identity')
        }
        if (body.branding && typeof body.branding === 'object' && !Array.isArray(body.branding)) {
          const brPatch = brandingPatchFrom(body.branding)
          Object.assign(patch, brPatch)
          changed.push('branding')
        }
      } catch (e) {
        return NextResponse.json(
          { success: false, error: e instanceof Error ? e.message : 'Invalid configuration.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      let settingsFragment: Record<string, unknown> | null = null
      try {
        settingsFragment = settingsPatchFrom(body)
      } catch (e) {
        return NextResponse.json(
          { success: false, error: e instanceof Error ? e.message : 'Invalid settings.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      if (settingsFragment) changed.push('settings')

      if (!changed.length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const school = await db.school.findUnique({ where: { id: schoolId }, select: { settings: true } })
      if (!school) {
        return NextResponse.json(
          { success: false, error: 'School not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      if (settingsFragment) {
        patch.settings = mergeSettings(school.settings, settingsFragment)
      }

      const updated = await db.school.update({
        where: { id: schoolId },
        data: patch,
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SCHOOL_SETTINGS_UPDATED',
        requestId,
        detail: `School settings updated (${changed.join(', ')}) by ${user.name}`,
      }).catch(() => {})

      const config = await getSchoolConfig(schoolId)
      return NextResponse.json(
        {
          success: true,
          data: { config, applied: changed },
          meta: { updatedAt: updated.updatedAt.toISOString() },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
