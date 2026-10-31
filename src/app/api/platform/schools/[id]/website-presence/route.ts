import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/** Same 32 KB bound the school-side CMS write enforces on the document. */
const MAX_DOCUMENT = 32 * 1024

const websitePresenceSchema = strictBody({
  websiteEnabled: z.boolean().optional(),
  hero: strictBody({
    badgePrefix: safeText(60).optional(),
    title: safeText(120).optional(),
    titleAccent: safeText(120).optional(),
    description: safeText(400).optional(),
  }).optional(),
  about: strictBody({
    title: safeText(120).optional(),
    subtitle: safeText(400).optional(),
  }).optional(),
  contact: strictBody({
    title: safeText(120).optional(),
    subtitle: safeText(400).optional(),
  }).optional(),
  seo: strictBody({
    title: safeText(120).optional(),
    description: safeText(300).optional(),
  }).optional(),
})

/**
 * PATCH /api/platform/schools/[id]/website-presence — initial website
 * identity seeding (PHASE 2 Setup wizard, Website step).
 *
 * Writes a SUBSET of the school's existing Website CMS document
 * (School.websiteContent — the SAME document the school edits through
 * /api/school/website and the public renderer consumes):
 *   · hero / about / contact / seo — section-wise replacement of ONLY
 *     the provided keys, all other stored sections preserved verbatim;
 *   · the website on/off switch — the SAME settings.websiteEnabled key
 *     provisioning writes (existing settings keys preserved).
 *
 * Honest scope: this seeds basic public information. It is NOT a
 * website builder — the full CMS (pillars, journey, facilities, gallery,
 * notices, admissions card, social links) remains the school's
 * Website Management module after handover. Custom domains stay in
 * their existing dedicated platform routes (add/verify/delete).
 *
 * The merged document is bounded to 32 KB (the school-side bound) — a
 * platform seed can never bloat the CMS beyond what the school editor
 * accepts.
 *
 * Permission: schools.manage. Audited: platform.school.website_presence_updated.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, websitePresenceSchema)
    const ip = clientIpFromHeaders(req.headers)

    if (Object.keys(body).length === 0) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Nothing to save — send at least one website field',
      })
    }

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true, websiteContent: true, settings: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'website-presence: no such school',
      })
    }

    // Merge the CMS fragment over the stored document — section-wise,
    // preserving every section the school may already have configured.
    let stored: Record<string, unknown>
    try {
      const parsed = JSON.parse(school.websiteContent || '{}') as unknown
      stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      stored = {}
    }
    const fragment: Record<string, unknown> = {}
    for (const key of ['hero', 'about', 'contact', 'seo'] as const) {
      if (body[key] !== undefined) fragment[key] = body[key]
    }
    const merged = { ...stored, ...fragment }
    const serialized = JSON.stringify(merged)
    if (serialized.length > MAX_DOCUMENT) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        publicMessage: 'Website content too large (max 32 KB).',
      })
    }

    // The website switch — read-modify-write of the SAME settings key
    // provisioning writes; every other settings key is preserved.
    let settingsUpdate: string | undefined
    if (body.websiteEnabled !== undefined) {
      let settings: Record<string, unknown>
      try {
        const parsed = JSON.parse(school.settings || '{}') as unknown
        settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {}
      } catch {
        settings = {}
      }
      settings.websiteEnabled = body.websiteEnabled
      settingsUpdate = JSON.stringify(settings)
    }

    await db.school.update({
      where: { id: school.id },
      data: {
        websiteContent: serialized,
        ...(settingsUpdate !== undefined ? { settings: settingsUpdate } : {}),
      },
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.website_presence_updated',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'initial website presence (setup wizard)',
      metadata: {
        sections: Object.keys(fragment),
        websiteEnabled: body.websiteEnabled ?? undefined,
      },
    })

    return { ok: true, updatedSections: Object.keys(fragment) }
  })
}
