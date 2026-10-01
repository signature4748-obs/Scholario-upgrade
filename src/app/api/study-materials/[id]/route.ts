import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { isSafeStoredFileName, toStudyMaterialMeta } from '@/lib/study-materials'
import { storedObjectLocation, storageDelete } from '@/lib/storage/supabase'

export const runtime = 'nodejs'

/// DELETE /api/study-materials/[id]
///
/// Ownership-aware removal (L2D §30/§34): PRINCIPAL deletes any material
/// in their school; TEACHER deletes only materials THEY uploaded
/// (uploadedById === user.id). Deletes the row AND the stored file (a
/// missing file on disk does not block the row deletion — the metadata
/// must never outlive its delete intent). Strictly school-scoped (RLS on
/// schoolId).
///
/// Returns the deleted row's metadata: { ok: true, data: StudyMaterialMeta }.
/// 404 when the row does not exist for this school; FORBIDDEN when a
/// teacher tries to remove someone else's upload.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params

      const material = await db.studyMaterial.findUnique({ where: { id } })
      if (!material) throw new Error('NOT_FOUND')
      if (material.schoolId !== schoolId) throw new Error('NOT_FOUND')
      // Teachers may remove ONLY their own uploads (principals: any).
      if (user.role === 'TEACHER' && material.uploadedById !== user.id) {
        throw new Error('FORBIDDEN')
      }

      let subjectName: string | null = null
      if (material.subjectId) {
        const subject = await db.subject.findFirst({
          where: { id: material.subjectId, schoolId },
          select: { name: true },
        })
        subjectName = subject?.name ?? null
      }

      // Best-effort byte removal — guarded by the same path safety check
      // as downloads; an already-missing object is fine (storageDelete
      // maps NoSuchKey to ok; the row still goes). Phase 8A: the object
      // lives at the deterministic study-materials/<schoolId>/<fileName>
      // path in the PRIVATE 'school-media' bucket.
      if (isSafeStoredFileName(material.fileName)) {
        const location = storedObjectLocation('study-materials', material.schoolId, material.fileName)
        await storageDelete(location.bucket, location.path).catch(() => {})
      }

      await db.studyMaterial.delete({ where: { id } })

      return toStudyMaterialMeta(material, subjectName)
    },
    { roles: ['TEACHER', 'PRINCIPAL'] }
  )
}
