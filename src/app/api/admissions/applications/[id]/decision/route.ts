import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import {
  transition,
  isAdmissionStatus,
  type AdmissionAction,
  type AdmissionStatus,
} from '@/lib/admissions/state-machine'
import { canonicalPayloadHash, canonicalPayloadJson } from '@/lib/admissions/canonical-payload'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/admissions/applications/[id]/decision — the ONE
 * principal-only decision endpoint (FEE-ADMISSIONS MVP, Phase D).
 *
 * Actions (explicit state machine, H1-R2 §2):
 *   start-review         SUBMITTED     → UNDER_REVIEW
 *   request-correction   UNDER_REVIEW  → SUBMITTED   (documented loop;
 *                                        notes REQUIRED)
 *   resubmit             SUBMITTED     → UNDER_REVIEW (after a
 *                                        correction; the corrected form
 *                                        data is supplied and
 *                                        re-fingerprinted)
 *   approve              UNDER_REVIEW  → APPROVED
 *   reject               SUBMITTED | UNDER_REVIEW → REJECTED (terminal;
 *                                        reason REQUIRED)
 *
 * Illegal transitions → 409 INVALID_STATE (REJECTED is terminal;
 * ENROLLED is final). Cross-tenant ids → 404 (no oracle). The approval
 * / rejection decision + actor + timestamp persist on the application
 * and in the append-only event trail (+ ActivityLog audit).
 */

const resubmitFormData = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    className: z.string().trim().min(1).max(80),
  })
  .passthrough()

const decisionSchema = z.object({
  action: z.enum(['start-review', 'request-correction', 'resubmit', 'approve', 'reject']),
  notes: z.string().max(2000).optional(),
  reason: z.string().max(2000).optional(),
  formData: resubmitFormData.optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)
    const { id } = await params

    let body: z.infer<typeof decisionSchema>
    try {
      body = decisionSchema.parse(await req.json().catch(() => ({})))
    } catch {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Invalid decision request.',
        internalDetail: 'decision POST: body validation failed',
      })
    }

    // Required notes/reason semantics.
    if (body.action === 'request-correction' && !(body.notes ?? '').trim()) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Correction notes are required so the applicant knows what to fix.',
      })
    }
    if (body.action === 'reject' && !(body.reason ?? '').trim()) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'A rejection reason is required.',
      })
    }
    if (body.action === 'resubmit' && !body.formData) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'The corrected form data is required on resubmit.',
      })
    }

    const application = await db.admissionApplication.findFirst({ where: { id, schoolId } })
    if (!application) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Application not found',
        internalDetail: 'decision POST: id missing or foreign tenant',
      })
    }
    if (!isAdmissionStatus(application.status)) {
      // DB CHECK also enforces the vocabulary — belt and braces.
      throw new AppError('INVALID_STATE', {
        internalDetail: `decision POST: unknown status ${application.status}`,
      })
    }

    const action: AdmissionAction = body.action
    const target = transition(action, application.status as AdmissionStatus, { label: id })

    // ── resubmit: replace the canonical payload + re-fingerprint ─────
    let payload = application.payload
    let payloadHash = application.payloadHash
    if (action === 'resubmit' && body.formData) {
      const previous = JSON.parse(application.payload) as {
        formData?: unknown
        feeSelections?: unknown
        classId?: string | null
        section?: string | null
      }
      const canonical = {
        formData: body.formData,
        feeSelections: previous.feeSelections ?? {},
        classId: previous.classId ?? null,
        section: previous.section ?? null,
        className: body.formData.className,
      }
      payload = canonicalPayloadJson(canonical)
      payloadHash = canonicalPayloadHash(canonical)
    }

    const now = new Date()
    const updated = await db.admissionApplication.update({
      where: { id: application.id },
      data: {
        status: target,
        payload,
        payloadHash,
        ...(action === 'resubmit' && body.formData
          ? {
              className: body.formData.className,
              applicantFirstName: body.formData.firstName.trim(),
              applicantLastName: body.formData.lastName.trim(),
            }
          : {}),
        ...(action === 'start-review' ? { reviewedAt: now } : {}),
        ...(action === 'resubmit' ? { reviewedAt: now } : {}),
        ...(action === 'approve' || action === 'reject'
          ? {
              decisionAt: now,
              decisionBy: ctx.user.id,
              decisionNotes: action === 'approve' ? (body.notes ?? null) : null,
              rejectionReason: action === 'reject' ? (body.reason ?? '').trim() : null,
            }
          : {}),
        ...(action === 'request-correction' ? { decisionNotes: (body.notes ?? '').trim() } : {}),
        updatedAt: now,
      },
    })

    await db.admissionApplicationEvent.create({
      data: {
        schoolId,
        applicationId: application.id,
        action:
          action === 'start-review'
            ? 'START_REVIEW'
            : action === 'request-correction'
              ? 'REQUEST_CORRECTION'
              : action === 'resubmit'
                ? 'RESUBMITTED'
                : action === 'approve'
                  ? 'APPROVED'
                  : 'REJECTED',
        actorUserId: ctx.user.id,
        actorRole: ctx.role,
        notes:
          body.notes ??
          body.reason ??
          (action === 'approve'
            ? 'Approved for enrolment'
            : action === 'start-review'
              ? 'Review started'
              : action === 'resubmit'
                ? 'Corrected application resubmitted'
                : undefined),
      },
    })

    // Best-effort ActivityLog audit (the event row above is the
    // transactional truth; this mirrors the platform-wide audit feed).
    await auditEvent({
      schoolId,
      userId: ctx.user.id,
      action: `ADMISSION_${target}`,
      detail: `Application ${application.id.slice(0, 8)}… → ${target}`,
    }).catch(() => undefined)

    return {
      id: updated.id,
      status: updated.status,
      decisionAt: updated.decisionAt,
      decisionNotes: updated.decisionNotes,
      rejectionReason: updated.rejectionReason,
      updatedAt: updated.updatedAt,
    }
  })
}
