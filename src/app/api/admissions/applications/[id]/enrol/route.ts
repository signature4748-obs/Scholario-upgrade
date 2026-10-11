import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError, newRequestId } from '@/lib/security/errors'
import { emailSchema } from '@/lib/security/validation'
import { hashPassword } from '@/lib/auth'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { auditEvent } from '@/lib/security/audit'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { requireSchoolAcademicYear } from '@/lib/admissions/academic-year'
import { allocateAdmissionNumber } from '@/lib/admissions/sequence'
import { computeAdmissionQuote, type QuoteSelections } from '@/lib/fees/quote-engine'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * POST /api/admissions/applications/[id]/enrol — the ATOMIC enrolment
 * (FEE-ADMISSIONS MVP, Phase D). PRINCIPAL-only, flag-gated,
 * tenant-scoped.
 *
 * ONE transaction (all-or-nothing; any failure rolls back everything):
 *   1. Row-lock the application (FOR UPDATE) and re-verify tenant +
 *      APPROVED (or ENROLLED → idempotent replay).
 *   2. Validate the published fee configuration for the application's
 *      class + academic year (fail-closed FEE_CONFIGURATION_REQUIRED)
 *      and compute the server-side quote.
 *   3. Allocate a collision-checked ADM-NNNNNN number (≤ 999999;
 *      UPDATE…RETURNING serializes concurrency; bounded skip loop).
 *   4. Create the student User (loginEmail — explicitly supplied,
 *      globally unique; P2002 → EMAIL_TAKEN with full rollback) with a
 *      one-time bootstrap credential + 48h expiry, and the Student row.
 *   5. Create the canonical Fee obligations (one per quote line item).
 *   6. Persist the immutable AdmissionFeeSnapshot (FK Restrict).
 *   7. Transition the application to ENROLLED and store the canonical
 *      enrol result (WITHOUT the credential) + append-only event.
 *
 * Replay: an already-ENROLLED application returns the ORIGINAL result
 * with idempotentReplay: true — no second admission number, no
 * duplicated obligations, no replayed approval events, and NO
 * re-exposure of the one-time credential (lost credentials are
 * recovered through the verified principal-plane reset flow:
 * POST /api/students/[id]/reset-credential).
 */

const enrolBodySchema = z.object({
  loginEmail: emailSchema,
  rollNo: z.string().max(20).optional(),
  /** Class finalization: the office may confirm/correct the class at
   * enrolment (the same authority the legacy dialog has). In-tenant
   * validated; updates the application record inside the transaction
   * BEFORE the quote is computed. */
  classId: z.string().min(1).max(64).optional(),
  /** Password override (Phase-1 policy); absent → server-generated. */
  password: z.string().min(8).max(128).optional(),
})

/** Bootstrap credential lifetime (hours). */
const CREDENTIAL_TTL_HOURS = 48

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)
    const { id } = await params

    let body: z.infer<typeof enrolBodySchema>
    try {
      body = enrolBodySchema.parse(await req.json().catch(() => ({})))
    } catch {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'A valid login email for the student account is required to enrol.',
        internalDetail: 'enrol POST: body validation failed',
      })
    }
    const loginEmail = body.loginEmail

    // Load the application FIRST: an already-ENROLLED application is the
    // idempotent-replay path — the stored result returns unchanged, so
    // the email pre-check below MUST NOT fire (the login email now
    // belongs to the student the ORIGINAL enrolment created).
    const application = await db.admissionApplication.findFirst({ where: { id, schoolId } })
    if (!application) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Application not found',
        internalDetail: 'enrol POST: id missing or foreign tenant',
      })
    }

    // Pre-check (fast 409 outside the transaction; the unique index is
    // the real guard inside it — the pre-check only gives a cleaner
    // error when the application is NOT yet consumed; replays skip it).
    if (application.status !== 'ENROLLED') {
      const emailOwner = await db.user.findUnique({
        where: { email: loginEmail },
        select: { id: true },
      })
      if (emailOwner) {
        throw new AppError('EMAIL_TAKEN', {
          publicMessage: 'This login email is already in use. Choose another email for the student account.',
          internalDetail: `enrol POST: email taken (user ${emailOwner.id.slice(0, 8)}…)`,
        })
      }
    }

    // The school's CURRENT academic year must match the application's
    // year — a year rollover between submission and enrolment is a
    // deterministic INVALID_STATE (re-submit under the new year), never
    // a silent fee mismatch.
    const schoolYear = await requireSchoolAcademicYear(schoolId)
    if (application.status !== 'ENROLLED' && application.academicYear !== schoolYear) {
      throw new AppError('INVALID_STATE', {
        publicMessage: `This application was submitted for ${application.academicYear}, but your school's active year is ${schoolYear}. Ask the family to resubmit under the active year.`,
        internalDetail: `enrol POST: year conflict app=${application.academicYear} school=${schoolYear}`,
      })
    }
    if (application.status !== 'ENROLLED' && !application.classId && !body.classId) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'The application has no class allocation — set the class before enrolment.',
        internalDetail: 'enrol POST: missing classId',
      })
    }

    // ── The enrolment transaction ─────────────────────────────────────
    const result = await enrolApplication({
      applicationId: application.id,
      schoolId,
      loginEmail,
      rollNo: body.rollNo,
      classId: body.classId,
      password: body.password,
      actorUserId: ctx.user.id,
    })

    if (result.replay) {
      return { ...result.response, idempotentReplay: true }
    }

    // Post-commit best-effort platform audit (the transactional truth is
    // the application event row; this mirrors the platform-wide audit
    // feed). Never carries the credential.
    await auditEvent({
      schoolId,
      userId: ctx.user.id,
      action: 'ACCOUNT_CREATED',
      requestId: newRequestId(),
      detail: `Student account created (${loginEmail}, admission no ${(result.response as { admissionNo?: string }).admissionNo ?? '—'}) — server-generated one-time credential`,
    }).catch(() => undefined)

    // The ONE-TIME credential is returned ONLY on the executing request
    // (never persisted, never logged, never replayed) — and only when
    // the server generated it (a supplied password is the caller's).
    return {
      ...result.response,
      idempotentReplay: false,
      ...(result.generated ? { tempPassword: result.tempPassword } : {}),
    }
  })
}

async function enrolApplication(opts: {
  applicationId: string
  schoolId: string
  loginEmail: string
  rollNo?: string
  classId?: string
  password?: string
  actorUserId: string
}): Promise<
  | { replay: true; response: Record<string, unknown> }
  | { replay: false; response: Record<string, unknown>; tempPassword: string; generated: boolean }
> {
  const { applicationId, schoolId, loginEmail, rollNo, password, actorUserId } = opts
  const bodyClassId = opts.classId

  try {
    return await trackedTransaction('admission-enrol', async (tx) => {
      // 1 — row lock + state re-verification INSIDE the transaction.
      await tx.$queryRaw`SELECT "id" FROM "AdmissionApplication" WHERE "id" = ${applicationId} FOR UPDATE`
      const locked = await tx.admissionApplication.findUnique({ where: { id: applicationId } })
      if (!locked || locked.schoolId !== schoolId) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Application not found',
          internalDetail: 'enrol tx: application missing or foreign tenant',
        })
      }

      // 2 — idempotent replay: ENROLLED is final; return the original
      // result WITHOUT re-issuing any credential.
      if (locked.status === 'ENROLLED') {
        const stored = JSON.parse(locked.enrolResult ?? '{}') as Record<string, unknown>
        return { replay: true, response: stored } as const
      }

      if (locked.status !== 'APPROVED') {
        throw new AppError('INVALID_STATE', {
          publicMessage:
            locked.status === 'REJECTED'
              ? 'A rejected application cannot be enrolled.'
              : 'The application must be approved before enrolment.',
          internalDetail: `enrol tx: status ${locked.status}`,
        })
      }

      // 2b — optional class finalization (in-tenant FK, inside the tx,
      // BEFORE the quote). The office confirming/correcting the class at
      // enrolment keeps the same authority the legacy dialog had.
      let classId = locked.classId
      let className = locked.className
      if (bodyClassId && bodyClassId !== locked.classId) {
        const cls = await tx.class.findFirst({
          where: { id: bodyClassId, schoolId },
          select: { id: true, name: true, section: true },
        })
        if (!cls) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Class not found',
            internalDetail: 'enrol tx: classId override missing or foreign tenant',
          })
        }
        classId = cls.id
        className = cls.section && !cls.name.toLowerCase().includes(cls.section.toLowerCase())
          ? `${cls.name} - ${cls.section}`
          : cls.name
        await tx.admissionApplication.update({
          where: { id: locked.id },
          data: { classId, className },
        })
      }

      const payload = JSON.parse(locked.payload) as {
        formData: Record<string, unknown>
        feeSelections?: QuoteSelections
      }
      const fd = payload.formData

      // 3 — the server-side quote from the PUBLISHED structure (inside
      // the transaction snapshot; fail-closed).
      const quote = await computeAdmissionQuote(tx, {
        schoolId,
        classId: classId as string,
        academicYear: locked.academicYear,
        selections: payload.feeSelections,
      })

      // 4 — admission number allocation (atomic; rollback frees it).
      const admissionNo = await allocateAdmissionNumber(tx, schoolId)

      // 5 — the student account. The bootstrap credential is EXPIRING
      // and forces a first-password-change (existing machinery).
      const { password: bootstrap, generated } = resolveProvisionedPassword(password)
      const credentialExpiresAt = new Date(Date.now() + CREDENTIAL_TTL_HOURS * 3600 * 1000)
      const user = await tx.user.create({
        data: {
          schoolId,
          email: loginEmail,
          passwordHash: hashPassword(bootstrap),
          name: `${locked.applicantFirstName} ${locked.applicantLastName}`.trim(),
          role: 'STUDENT',
          status: 'ACTIVE',
          mustChangePassword: true,
          credentialExpiresAt,
        },
      })
      const student = await tx.student.create({
        data: {
          schoolId,
          userId: user.id,
          classId,
          rollNo: rollNo ?? null,
          admissionNo,
          guardianName: locked.guardianName,
          guardianPhone: locked.guardianPhone,
          dob: typeof fd.dob === 'string' ? fd.dob : null,
          gender: typeof fd.gender === 'string' ? fd.gender : null,
          bloodGroup: typeof fd.bloodGroup === 'string' ? fd.bloodGroup : null,
          address: typeof fd.currentAddress === 'string' ? fd.currentAddress : null,
          photoDataUrl: typeof fd.photoDataUrl === 'string' ? fd.photoDataUrl : null,
        },
      })

      // 6 — canonical fee obligations (the existing Fee ledger rows).
      for (const line of quote.lineItems) {
        await tx.fee.create({
          data: {
            schoolId,
            studentId: student.id,
            title: line.name,
            amount: line.amount,
            type: line.category,
            status: 'UNPAID',
          },
        })
      }

      // 7 — the immutable admission fee snapshot (exact numbers for the
      // official documents; edits never change it after this point).
      const snapshot = await tx.admissionFeeSnapshot.create({
        data: {
          schoolId,
          applicationId: locked.id,
          studentId: student.id,
          structureId: quote.structureId,
          structureVersion: quote.structureVersion,
          academicYear: quote.academicYear,
          lineItems: JSON.stringify(quote.lineItems),
          discountName: quote.discount?.name ?? null,
          discountAmount: quote.totals.discount,
          totalAmount: quote.totals.net,
          issuedBy: actorUserId,
        },
      })

      // 8 — transition + the CANONICAL result (the exact response shape,
      // WITHOUT the credential) so an idempotent replay returns the
      // ORIGINAL result verbatim — same fields, same amounts.
      const now = new Date()
      const response = {
        application: { id: locked.id, status: 'ENROLLED' },
        student: {
          id: student.id,
          userId: user.id,
          name: user.name,
          loginEmail,
          admissionNo,
          className,
          rollNo: rollNo ?? null,
        },
        admissionNo,
        feeSnapshot: {
          totalAmount: num(snapshot.totalAmount),
          discountAmount: num(snapshot.discountAmount),
          discountName: snapshot.discountName,
          academicYear: snapshot.academicYear,
          structureVersion: snapshot.structureVersion,
          lineItems: quote.lineItems,
        },
        totals: quote.totals,
        // Credential LIFETIME bookkeeping (timestamps only — the one-time
        // credential itself is NEVER persisted).
        credentialIssuedAt: now.toISOString(),
        credentialExpiresAt: credentialExpiresAt.toISOString(),
      }
      const enrolResult = JSON.stringify(response)
      await tx.admissionApplication.update({
        where: { id: locked.id },
        data: {
          status: 'ENROLLED',
          enrolledAt: now,
          enrolledStudentId: student.id,
          enrolResult,
        },
      })
      await tx.admissionApplicationEvent.create({
        data: {
          schoolId,
          applicationId: locked.id,
          action: 'ENROLLED',
          actorUserId,
          actorRole: 'PRINCIPAL',
          notes: `Enrolled as ${admissionNo} (${loginEmail})`,
        },
      })

      return { replay: false, response, tempPassword: bootstrap, generated } as const
    })
  } catch (e) {
    const err = e as { code?: string; meta?: { message?: string } }
    if (err?.code === 'P2002') {
      const meta = String(err.meta?.message ?? '')
      if (meta.includes('User_email_key') || meta.includes('email')) {
        throw new AppError('EMAIL_TAKEN', {
          publicMessage: 'This login email is already in use. Choose another email for the student account.',
          internalDetail: 'enrol: P2002 on User.email (transaction rolled back)',
        })
      }
      if (meta.includes('Student_admissionNo') || meta.includes('admissionNo')) {
        throw new AppError('ADMISSION_NUMBER_COLLISION', {
          internalDetail: 'enrol: P2002 on Student schoolId+admissionNo backstop',
        })
      }
    }
    throw e
  }
}
