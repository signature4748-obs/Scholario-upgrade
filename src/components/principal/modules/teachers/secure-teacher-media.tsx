'use client'

/**
 * Phase 1 — secure render sources for stored teacher media.
 *
 * Teacher photos/signatures are PII: the server no longer serves them
 * anonymously. `teacherMediaSrc()` remains for the dataUrl case; when a
 * persisted record has no dataUrl, these components resolve a
 * short-lived signed URL (src/lib/secure-media) before rendering.
 */
import type { TeacherMediaRecord } from '@/lib/store/teachers-store'
import { useSignedFileUrl } from '@/lib/secure-media'

/**
 * Resolve the best available render source for a stored media record:
 * the in-session dataUrl (just-uploaded preview) or a signed server URL
 * (persisted record). Null while resolving / when access is denied.
 */
export function useTeacherMediaSrc(
  record: TeacherMediaRecord | null | undefined,
): string | null {
  const fileId = record && !record.dataUrl ? record.fileId : null
  const signed = useSignedFileUrl(fileId, 'teachers')
  if (!record) return null
  return record.dataUrl ?? signed
}

interface SecureTeacherImgProps {
  record: TeacherMediaRecord | null | undefined
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
}

/**
 * `<img>` for a stored teacher media record. Renders a transparent
 * placeholder (same className) while the signed URL resolves so layout
 * never jumps. Parent handles the no-record fallback (initials avatar).
 */
export function SecureTeacherImg({ record, alt, className, loading }: SecureTeacherImgProps) {
  const src = useTeacherMediaSrc(record)
  if (!record) return null
  if (!src) {
    return (
      <img
        alt=""
        aria-hidden="true"
        src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
        className={className}
        loading={loading}
      />
    )
  }
  return <img src={src} alt={alt} className={className} loading={loading} />
}
