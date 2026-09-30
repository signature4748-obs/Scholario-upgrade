import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { mergeWebsiteContent } from '@/lib/website-content'

export const runtime = 'nodejs'

/**
 * GET /api/school/website — this school's Website CMS document
 * (session-scoped read: documents, settings Website tab, previews).
 */
export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { websiteContent: true, name: true, themeColor: true, accentColor: true, logoUrl: true },
      })
      if (!school) {
        return NextResponse.json(
          { success: false, error: 'School not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      return NextResponse.json(
        {
          success: true,
          data: {
            content: mergeWebsiteContent(school.websiteContent),
            school: { name: school.name, themeColor: school.themeColor, accentColor: school.accentColor, logoUrl: school.logoUrl },
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

/**
 * PATCH /api/school/website — write the Website CMS document.
 *
 * PRINCIPAL / MANAGEMENT only. Accepts a PARTIAL website-content object
 * (same shape as src/lib/website-content.ts WebsiteContent): top-level
 * sections present in the body replace the stored section wholesale;
 * absent sections keep their stored value. Bounded to 32 KB serialized.
 * The tenant is session-derived — a client schoolId is never read.
 */
const MAX_DOCUMENT = 32 * 1024

const SECTION_KEYS = new Set([
  'hero', 'about', 'pillars', 'journey', 'facilities', 'principalMessage',
  'admissions', 'contact', 'footer', 'seo',
])

export async function PATCH(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can edit the school website.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json(
          { success: false, error: 'Invalid request body.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Only known top-level sections pass (unknown keys dropped).
      const fragment: Record<string, unknown> = {}
      for (const key of Object.keys(body)) {
        if (SECTION_KEYS.has(key)) fragment[key] = body[key]
      }
      if (!Object.keys(fragment).length) {
        return NextResponse.json(
          { success: false, error: 'No known website sections in the request.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      const serialized = JSON.stringify(fragment)
      if (serialized.length > MAX_DOCUMENT) {
        return NextResponse.json(
          { success: false, error: 'Website content too large (max 32 KB).' },
          { status: 413, headers: { 'X-Request-Id': requestId } },
        )
      }

      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { websiteContent: true },
      })
      if (!school) {
        return NextResponse.json(
          { success: false, error: 'School not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Merge fragment over stored document: section-wise replacement.
      let stored: Record<string, unknown>
      try {
        stored = JSON.parse(school.websiteContent || '{}')
        if (typeof stored !== 'object' || Array.isArray(stored) || stored === null) stored = {}
      } catch {
        stored = {}
      }
      const merged = { ...stored, ...fragment }

      await db.school.update({
        where: { id: schoolId },
        data: { websiteContent: JSON.stringify(merged) },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Website sections updated (${Object.keys(fragment).join(', ')}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { content: mergeWebsiteContent(JSON.stringify(merged)) } },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
