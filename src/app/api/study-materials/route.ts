import { NextRequest } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  STUDY_MATERIAL_UPLOAD_DIR,
  STUDY_MATERIAL_MAX_BYTES,
  STUDY_MATERIAL_CATEGORIES,
  STUDY_MATERIAL_STATUSES,
  STUDY_MATERIAL_MIME_TO_EXT,
  generateStudyMaterialFileName,
  toStudyMaterialMeta,
} from '@/lib/study-materials'
import { requireStudent, authorizedMaterials, type StudentContext } from '@/lib/learning'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import type { StudyMaterial } from '@prisma/client'

export const runtime = 'nodejs'

/// GET /api/study-materials
///
/// The school's study-material repository INDEX (metadata only — the
/// stored fileName never leaves the server). Strictly school-scoped.
///
///   STUDENT    → only PUBLISHED + authorized rows (whole-school, the
///                student's class label, or explicitly targeted at the
///                student — L2D spec §31/§33/§58)
///   TEACHER /
///   PRINCIPAL  → every status (draft | published | archived) for their
///                school, so they can manage the lifecycle end-to-end
///
/// Optional query filters (composable):
///   ?category=worksheet|notes|syllabus|sample-paper|revision|general
///   ?subjectId=<Subject.id>     — exact match
///   ?q=<text>                   — case-insensitive contains on
///                                 title OR description
///
/// Returns newest first: { ok: true, data: StudyMaterialMeta[] }
export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      const sp = req.nextUrl.searchParams
      const category = sp.get('category')?.trim() || undefined
      const subjectId = sp.get('subjectId')?.trim() || undefined
      const q = sp.get('q')?.trim().toLowerCase() || undefined

      let rows: StudyMaterial[]
      let ctx: StudentContext | null = null

      if (user.role === 'STUDENT') {
        // Permission-aware index — the predicate is recomputed server-side
        // from the session (student identity + class label + targeting).
        ctx = await requireStudent(user)
        rows = await authorizedMaterials(ctx, { subjectId })
        if (category) rows = rows.filter((m) => m.category === category)
      } else {
        rows = await db.studyMaterial.findMany({
          where: {
            schoolId,
            ...(category ? { category } : {}),
            ...(subjectId ? { subjectId } : {}),
          },
          orderBy: { createdAt: 'desc' },
        })
      }

      // Resolve subject display names server-side (one query, id → name).
      const subjectIds = [...new Set(rows.map((m) => m.subjectId).filter((v): v is string => !!v))]
      const subjects = subjectIds.length
        ? await db.subject.findMany({ where: { schoolId, id: { in: subjectIds } }, select: { id: true, name: true } })
        : []
      const nameById = new Map(subjects.map((s) => [s.id, s.name]))

      // Text search — applied in JS so behaviour is identical on SQLite
      // (no case-insensitive `contains` mode there). Order is preserved.
      const filtered = q
        ? rows.filter(
            (m) =>
              m.title.toLowerCase().includes(q) ||
              (m.description ?? '').toLowerCase().includes(q),
          )
        : rows

      return filtered.map((m) => toStudyMaterialMeta(m, m.subjectId ? nameById.get(m.subjectId) ?? null : null))
    },
    { roles: ['STUDENT', 'TEACHER', 'PRINCIPAL'] },
  )
}

/// POST /api/study-materials
///
/// TEACHER + PRINCIPAL upload into the school's repository (L2D spec §30:
/// teacher-created content flows into Learning once published). The
/// schoolId ALWAYS comes from the session. multipart/form-data:
///   title        (required, non-empty)
///   description  (optional)
///   subjectId    (optional — must resolve to a Subject of THIS school)
///   className    (optional class label, e.g. "Grade 9 - A"; empty/null =
///                 whole school)
///   category     (optional; one of general|worksheet|notes|syllabus|
///                 sample-paper|revision — default "general")
///   status       (optional; draft|published|archived — default "published")
///   studentIds   (optional, repeatable — specific-student targeting; every
///                 id must be a Student of THIS school)
///   file         (required — max 20 MB; PDF, png/jpg/webp, plain text,
///                 doc/docx, ppt/pptx, xls/xlsx)
///
/// The file is stored under db/uploads/study-materials with a generated
/// safe fileName (server id + canonical extension — the user's filename
/// never touches the filesystem), the row + targeting rows are created,
/// and the metadata is returned: { ok: true, data: StudyMaterialMeta }.
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      // Phase 1 — uploads are rate-limited (30/hour per account).
      enforceRateLimit(`rl:upload:${user.id}`, RATE_LIMITS.upload)

      const form = await req.formData().catch(() => null)
      if (!form) throw new Error('Expected multipart/form-data')

      const title = String(form.get('title') ?? '').trim()
      if (!title) throw new Error('A title is required')

      const descriptionRaw = String(form.get('description') ?? '').trim()
      const description = descriptionRaw ? descriptionRaw : null

      const subjectIdRaw = String(form.get('subjectId') ?? '').trim()
      const subjectId = subjectIdRaw ? subjectIdRaw : null
      let subjectName: string | null = null
      if (subjectId) {
        const subject = await db.subject.findFirst({
          where: { id: subjectId, schoolId },
          select: { id: true, name: true },
        })
        if (!subject) throw new Error('Subject not found for this school')
        subjectName = subject.name
      }

      const classNameRaw = String(form.get('className') ?? '').trim()
      const className = classNameRaw ? classNameRaw : null

      const categoryRaw = String(form.get('category') ?? 'general').trim() || 'general'
      if (!(STUDY_MATERIAL_CATEGORIES as readonly string[]).includes(categoryRaw)) {
        throw new Error('Invalid category')
      }

      const statusRaw = String(form.get('status') ?? 'published').trim() || 'published'
      if (!(STUDY_MATERIAL_STATUSES as readonly string[]).includes(statusRaw)) {
        throw new Error('Invalid status')
      }
      const publishedAt = statusRaw === 'published' ? new Date() : null

      // Specific-student targeting (L2D spec §31): every id must be a
      // Student of THIS school — anything else rejects the whole upload.
      const studentIds = [...new Set(
        form.getAll('studentIds').map((v) => String(v).trim()).filter(Boolean),
      )]
      if (studentIds.length > 0) {
        const valid = await db.student.count({
          where: { schoolId, id: { in: studentIds } },
        })
        if (valid !== studentIds.length) {
          throw new Error('studentIds contains a student outside this school')
        }
      }

      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('A file is required')
      if (file.size === 0) throw new Error('The uploaded file is empty')
      if (file.size > STUDY_MATERIAL_MAX_BYTES) {
        throw new Error('File exceeds the 20 MB limit')
      }
      const mimeType = file.type || 'application/octet-stream'
      if (!STUDY_MATERIAL_MIME_TO_EXT[mimeType]) {
        throw new Error('This file type is not allowed')
      }

      // Generate the SAFE server-side name BEFORE touching the disk —
      // extension derives from the validated MIME map, never from the
      // user-supplied filename.
      const fileName = generateStudyMaterialFileName(mimeType)
      const bytes = Buffer.from(await file.arrayBuffer())

      await mkdir(STUDY_MATERIAL_UPLOAD_DIR, { recursive: true })
      await writeFile(
        `${STUDY_MATERIAL_UPLOAD_DIR}/${fileName}`,
        bytes,
      )

      const row = await db.studyMaterial.create({
        data: {
          schoolId,
          title,
          description,
          subjectId,
          className,
          category: categoryRaw,
          fileName,
          originalName: file.name || fileName,
          mimeType,
          sizeBytes: bytes.byteLength,
          uploadedById: user.id,
          status: statusRaw,
          publishedAt,
        },
      })
      if (studentIds.length > 0) {
        await db.studyMaterialTarget.createMany({
          data: studentIds.map((studentId) => ({ studyMaterialId: row.id, studentId })),
        })
      }

      return toStudyMaterialMeta(row, subjectName)
    },
    { roles: ['TEACHER', 'PRINCIPAL'] },
  )
}
