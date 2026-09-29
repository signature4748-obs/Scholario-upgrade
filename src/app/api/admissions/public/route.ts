import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, emailSchema, phoneSchema, safeText } from '@/lib/security/validation'
import { z } from 'zod'
import { auditRateLimit } from '@/lib/security/audit'

export const runtime = 'nodejs'

// POST /api/admissions/public — public admission inquiry form.
//
// Phase 1 hardening:
//   - strict schema validation (types, lengths, phone/email shape,
//     unknown fields rejected)
//   - per-IP rate limiting (10/hour) — hostile-internet form spam guard
//   - body size cap (default 256 KB via parseJsonBody)
//   - audit row for every accepted inquiry (existed as ActivityLog
//     'ADMISSION_INQUIRY' before — kept for compatibility with the
//     activity feed) + sanitized error envelope (no internals).
const inquirySchema = strictBody({
  studentName: safeText(80),
  parentName: safeText(80),
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: phoneSchema,
  grade: z.union([safeText(24), z.literal('')]).optional(),
  notes: z.union([safeText(500), z.literal('')]).optional(),
  schoolSlug: z.union([safeText(64), z.literal('')]).optional(),
})

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  try {
    // ── Brute-force / spam guard (per-IP) ──────────────────────────────
    const ip = clientIpFromHeaders(req.headers)
    const verdict = checkRateLimit(`rl:admission:${ip}`, RATE_LIMITS.admissionPublic)
    if (!verdict.allowed) {
      auditRateLimit('admission-public', ip, requestId)
      return NextResponse.json(
        { success: false, error: `Too many submissions. Please try again in ${verdict.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } },
      )
    }

    // ── Input validation ───────────────────────────────────────────────
    let body: z.infer<typeof inquirySchema>
    try {
      body = await parseJsonBody(req, inquirySchema)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid submission'
      return NextResponse.json({ success: false, error: msg }, { status: 422 })
    }

    const { studentName, parentName, email, phone, grade, notes, schoolSlug } = body

    // Find the school
    const school = await db.school.findFirst({
      where: schoolSlug ? { slug: schoolSlug } : { isDemo: true },
    })

    if (!school) {
      return NextResponse.json({ success: false, error: 'Target school not found.' }, { status: 404 })
    }

    // Record the admission inquiry in ActivityLog and create a Notification for School Admins
    await db.activityLog.create({
      data: {
        schoolId: school.id,
        action: 'ADMISSION_INQUIRY',
        detail: `New Admission Inquiry: Student: ${studentName}, Parent: ${parentName}, Grade: ${grade || 'N/A'}, Phone: ${phone}, Email: ${email || 'N/A'}${notes ? `, Notes: ${notes}` : ''}`,
      },
    })

    // Create notification for school staff
    await db.notification.create({
      data: {
        schoolId: school.id,
        title: `New Admission Inquiry: ${studentName}`,
        message: `Parent ${parentName} applied for Grade ${grade || 'N/A'}. Contact: ${phone} (${email || 'No email'}).`,
        audience: 'STAFF',
        priority: 'HIGH',
      },
    })

    console.log(
      JSON.stringify({
        channel: 'audit',
        action: 'ADMISSION_INQUIRY',
        schoolId: school.id,
        requestId,
        ip,
      }),
    )

    return NextResponse.json({
      success: true,
      message: 'Admission inquiry submitted successfully! The school admissions team will contact you shortly.',
    })
  } catch {
    // Sanitized — never surface internals (Phase-0 baseline B-10).
    return NextResponse.json(
      { success: false, error: 'Failed to submit admission inquiry. Please try again.' },
      { status: 500 },
    )
}
}
