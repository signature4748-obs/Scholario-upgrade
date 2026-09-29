/**
 * Central file-upload policy (Phase 1 — item 5).
 *
 * The three upload routes (admissions, teachers, study-materials) each
 * had their own copy of magic-byte sniffing / size checks / id regexes.
 * This module is the ONE place that owns:
 *
 *   - file signature (magic byte) verification
 *   - extension ↔ MIME allowlists (no client-declared MIME trust)
 *   - stored-id validation (traversal-proof opaque ids)
 *   - safe filename generation (server-minted; the client filename is
 *     display metadata only)
 *   - shared size ceilings
 *
 * Uploads still land on local disk under db/uploads/** (the storage
 * abstraction/object-storage phase comes later per the Phase-0 plan) —
 * but every write passes through this policy.
 */

export type SniffedFileType = 'pdf' | 'jpeg' | 'png' | 'webp'

/** Traversal-proof stored-id: server-minted `[a-z0-9-]+.(ext)`. */
export function isValidStoredFileId(id: string, exts: readonly string[]): boolean {
  if (!/^[a-zA-Z0-9-]{4,80}$/.test(id.replace(/\.[^.]*$/, ''))) return false
  const ext = id.split('.').pop()?.toLowerCase()
  if (!ext) return false
  return exts.includes(ext)
}

/** Detect the real content type from the leading bytes (magic numbers). */
export function sniffFileType(buf: Buffer): SniffedFileType | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'pdf' // %PDF
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg' // JPEG SOI
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png' // PNG signature
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp' // RIFF....WEBP
  }
  return null
}

export const EXT_BY_TYPE: Record<SniffedFileType, string> = {
  pdf: 'pdf',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
}

export const MIME_BY_TYPE: Record<SniffedFileType, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Admission documents: PDF / JPG / PNG, 5 MB. */
export const ADMISSION_UPLOAD_POLICY = {
  allowedExts: ['pdf', 'jpg', 'png'] as const,
  allowedTypes: ['pdf', 'jpeg', 'png'] as readonly SniffedFileType[],
  maxBytes: 5 * 1024 * 1024,
  dir: 'admissions',
} as const

/** Teacher photo/signature: JPG / PNG / WebP (photo 2 MB · signature 1 MB). */
export const TEACHER_UPLOAD_POLICY = {
  allowedExts: ['jpg', 'png', 'webp'] as const,
  allowedTypes: ['jpeg', 'png', 'webp'] as readonly SniffedFileType[],
  photoMaxBytes: 2 * 1024 * 1024,
  signatureMaxBytes: 1 * 1024 * 1024,
  dir: 'teachers',
} as const

/**
 * Validate declared-vs-actual content for a policy. Returns a safe,
 * user-facing error string or null when the file is acceptable.
 */
export function validateUploadBytes(
  bytes: Buffer,
  policy: { allowedTypes: readonly SniffedFileType[]; maxBytes: number },
): { error: string; status: number } | null {
  if (bytes.length === 0) return { error: 'Empty file.', status: 400 }
  if (bytes.length > policy.maxBytes) {
    return {
      error: `File is too large. Maximum size is ${Math.floor(policy.maxBytes / 1024 / 1024)} MB.`,
      status: 413,
    }
  }
  const sniffed = sniffFileType(bytes)
  if (!sniffed || !policy.allowedTypes.includes(sniffed)) {
    const humanList = policy.allowedTypes
      .map((t) => EXT_BY_TYPE[t].toUpperCase())
      .join(', ')
    return { error: `Unsupported file type. Allowed: ${humanList}.`, status: 415 }
  }
  return null
}

/** Read intrinsic pixel dimensions from image header bytes (JPG/PNG/WebP). */
export function readImageDimensions(
  buf: Buffer,
  type: SniffedFileType,
): { width: number; height: number } | null {
  try {
    if (type === 'png') {
      if (buf.length < 24) return null
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (type === 'jpeg') {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++
          continue
        }
        const marker = buf[off + 1]
        if (
          marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
        }
        const segLen = buf.readUInt16BE(off + 2)
        if (segLen < 2) return null
        off += 2 + segLen
      }
      return null
    }
    if (type === 'webp') {
      const chunk = buf.toString('ascii', 12, 16)
      if (chunk === 'VP8 ') {
        if (buf.length < 30) return null
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      }
      if (chunk === 'VP8L') {
        if (buf.length < 25) return null
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]
        return {
          width: 1 + (((b1 & 0x3f) << 8) | b0),
          height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        }
      }
      if (chunk === 'VP8X') {
        if (buf.length < 30) return null
        return {
          width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
          height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
        }
      }
      return null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Sanitize a CLIENT-DECLARED original filename for safe display/storage:
 * strip paths, control chars, and reserved shell metacharacters; cap the
 * length. (Stored files always use server-minted ids — this only guards
 * the metadata echo.)
 */
export function sanitizeDisplayFilename(name: string | null | undefined): string {
  if (!name) return 'file'
  const base = name.split(/[/\\]/).pop() ?? 'file'
  return base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>"'`|;&$]/g, '')
    .slice(0, 120) || 'file'
}
