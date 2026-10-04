import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * GET /api/school/website/admissions — this school's admissions status
 * block (the WebsiteAdmission singleton). Returns a null-shaped default
 * when no row exists yet (the client initialises the form from it).
 * PUT — create-or-update the singleton (upsert). The tenant is
 * session-derived — a client schoolId is never read.
 *
 * The block renders on the public website ONLY while published=true;
 * this API is the principal/management editing surface (GET is also
 * fine for any staff session — it is school-plane data, not public).
 *
 * classesAccepting is stored as a JSON string array; PUT accepts an
 * array of class labels (validated ≤ 30 entries, each ≤ 60 chars) and
 * also tolerates a JSON-encoded string for direct API callers.
 */

function serializeAdmission(a: {
  id: string
  status: string
  session: string | null
  classesAccepting: string
  openingDate: Date | null
  closingDate: Date | null
  noticeTitle: string | null
  noticeBody: string | null
  applicationUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  published: boolean
  updatedAt: Date
}) {
  let classes: string[] = []
  try {
    const parsed = JSON.parse(a.classesAccepting || '[]')
    if (Array.isArray(parsed)) classes = parsed.map((c) => String(c)).filter(Boolean)
  } catch {
    classes = []
  }
  return {
    id: a.id,
    status: a.status === 'OPEN' ? 'OPEN' : 'CLOSED',
    session: a.session,
    classesAccepting: classes,
    openingDate: a.openingDate?.toISOString() ?? null,
    closingDate: a.closingDate?.toISOString() ?? null,
    noticeTitle: a.noticeTitle,
    noticeBody: a.noticeBody,
    applicationUrl: a.applicationUrl,
    contactEmail: a.contactEmail,
    contactPhone: a.contactPhone,
    published: a.published,
    updatedAt: a.updatedAt.toISOString(),
  }
}

function parseClasses(v: unknown): string[] {
  let raw: unknown = v
  if (typeof v === 'string') {
    try {
      raw = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const label = String(item ?? '').trim().slice(0, 60)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
    if (out.length >= 30) break
  }
  return out
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function validUrl(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) return null
  return s.slice(0, 300)
}

function validEmail(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.slice(0, 160) : null
}

function validPhone(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  return /^[+\d][\d\s-]{5,23}$/.test(s) ? s : null
}

export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const admission = await db.websiteAdmission.findUnique({ where: { schoolId } })
      return NextResponse.json(
        {
          success: true,
          data: {
            admission: admission
              ? serializeAdmission(admission)
              : // Null-shaped default: an unconfigured school gets the honest
                // "not configured yet" form state, not invented content.
                null,
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function PUT(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can edit the admissions block.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webadm:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, error: 'Invalid request body.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const status = body.status === 'OPEN' ? 'OPEN' : 'CLOSED'
      const session = body.session ? String(body.session).trim().slice(0, 20) || null : null
      const classes = parseClasses(body.classesAccepting)
      const openingDate = parseDate(body.openingDate)
      const closingDate = parseDate(body.closingDate)
      const noticeTitle = body.noticeTitle ? String(body.noticeTitle).trim().slice(0, 120) || null : null
      const noticeBody = body.noticeBody ? String(body.noticeBody).trim().slice(0, 2000) || null : null
      const applicationUrl = validUrl(body.applicationUrl)
      if (body.applicationUrl != null && body.applicationUrl !== '' && !applicationUrl) {
        return NextResponse.json(
          { success: false, error: 'Application URL must start with http:// or https://.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      const contactEmail = validEmail(body.contactEmail)
      if (body.contactEmail != null && body.contactEmail !== '' && !contactEmail) {
        return NextResponse.json(
          { success: false, error: 'Contact email is not a valid address.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      const contactPhone = validPhone(body.contactPhone)
      const published = body.published === true

      // Date coherence: closing must be after opening when both are set.
      if (openingDate && closingDate && closingDate.getTime() <= openingDate.getTime()) {
        return NextResponse.json(
          { success: false, error: 'Closing date must be after the opening date.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const data = {
        status,
        session,
        classesAccepting: JSON.stringify(classes),
        openingDate,
        closingDate,
        noticeTitle,
        noticeBody,
        applicationUrl,
        contactEmail,
        contactPhone,
        published,
      }

      const admission = await db.websiteAdmission.upsert({
        where: { schoolId },
        update: data,
        create: { schoolId, ...data },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_ADMISSIONS_UPDATED',
        requestId,
        detail: `Admissions block ${admission.published ? 'published' : 'saved'} (status ${admission.status}${admission.session ? `, session ${admission.session}` : ''}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { admission: serializeAdmission(admission) } },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
