import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  isSafeStoredFileName,
  STUDY_MATERIAL_DOWNLOAD_TTL_SEC,
} from '@/lib/study-materials'
import { requireStudent, materialVisibleToStudent, targetedMaterialIds } from '@/lib/learning'
import { storedObjectLocation, storageExists, storageSignedUrl } from '@/lib/storage/supabase'

export const runtime = 'nodejs'

/// GET /api/study-materials/[id]/download
///
/// SERVER-AUTHORIZED file download — the ONLY reader of the stored
/// study-material objects, never served statically.
///
/// Authorization (L2D spec §33/§70 — publication state is part of the
/// check):
///   · SCHOOL scope always (RLS — a foreign id is an honest 404).
///   · STUDENT: published AND authorized (whole-school / my class label /
///     targeted at me). Anything else is an honest 404.
///   · TEACHER: any PUBLISHED material of the school; DRAFT/ARCHIVED only
///     for the uploader (their own work-in-progress).
///   · PRINCIPAL: any status for their school.
///
/// Phase 8A (8A-C9): the bytes live in the PRIVATE 'school-media'
/// bucket at `study-materials/<schoolId>/<fileName>`. The role-gated
/// authorization above is IDENTICAL and runs BEFORE any URL is minted;
/// an authorized download then REDIRECTS (302) to a 10-minute signed
/// URL. The attachment semantics (Content-Disposition with the
/// original filename) ride the Storage `download` query param; the
/// no-store cache policy is preserved on the redirect. 404 when the
/// row is missing OR the stored object is gone (probed first —
/// honest 404, never a redirect into a broken target).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params

      const material = await db.studyMaterial.findUnique({ where: { id } })
      if (!material) throw new Error('NOT_FOUND')
      // RLS — a material from another school is indistinguishable from
      // "does not exist" for this caller.
      if (material.schoolId !== schoolId) throw new Error('NOT_FOUND')

      // ── Publication-state-aware authorization (L2D) ──────────────────
      if (user.role === 'STUDENT') {
        const ctx = await requireStudent(user)
        const targeted = await targetedMaterialIds(ctx.studentId)
        if (!materialVisibleToStudent(material, ctx, targeted)) throw new Error('NOT_FOUND')
      } else if (user.role === 'TEACHER') {
        // Published rows are readable school-wide; drafts/archives stay
        // with their uploader until a principal or the uploader publishes.
        if (material.status !== 'published' && material.uploadedById !== user.id) {
          throw new Error('FORBIDDEN')
        }
      }
      // PRINCIPAL — full school-scoped access, any status (unchanged).

      if (!isSafeStoredFileName(material.fileName)) throw new Error('NOT_FOUND')

      const location = storedObjectLocation('study-materials', material.schoolId, material.fileName)
      const exists = await storageExists(location.bucket, location.path).catch(() => false)
      // Row exists but the bytes are gone — honest 404, never a 500.
      if (!exists) throw new Error('NOT_FOUND')

      // Signed URL (10-min TTL) + attachment hint carrying the original
      // filename (ASCII-safe fallback — the Storage `download` param
      // emits `Content-Disposition: attachment; filename="…"`).
      const asciiName =
        material.originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || material.fileName
      let target = await storageSignedUrl(location.bucket, location.path, STUDY_MATERIAL_DOWNLOAD_TTL_SEC)
      target += `${target.includes('?') ? '&' : '?'}download=${encodeURIComponent(asciiName)}`

      const res = NextResponse.redirect(target, 302)
      // Authorized per-session content — never shared-cached.
      res.headers.set('Cache-Control', 'no-store')
      res.headers.set('X-Content-Type-Options', 'nosniff')
      return res
    },
    { roles: ['STUDENT', 'TEACHER', 'PRINCIPAL'] },
  )
}
