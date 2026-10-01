// ============================================================
// STUDY MATERIALS — server-side repository helpers (RB-1)
// ------------------------------------------------------------
// Shared constants + validators for the /api/study-materials routes.
// Phase 8A (8A-C9): the bytes live in the PRIVATE 'school-media'
// Supabase bucket at `study-materials/<schoolId>/<safe-file-name>`
// and are served ONLY through the authorized download route (10-min
// signed-URL redirect) — never from /public, never statically.
// Uploads are teacher/principal; reads are STUDENT / TEACHER /
// PRINCIPAL, always school-scoped (RLS).
// ============================================================

import { randomBytes } from 'crypto'
import type { StudyMaterial } from '@prisma/client'

/** Signed-URL TTL for authorized downloads (mission: 10 minutes). */
export const STUDY_MATERIAL_DOWNLOAD_TTL_SEC = 600

/** Repository categories (single source for API validation + UI chips). */
export const STUDY_MATERIAL_CATEGORIES = [
  'general',
  'worksheet',
  'notes',
  'syllabus',
  'sample-paper',
  'revision',
] as const
export type StudyMaterialCategory = (typeof STUDY_MATERIAL_CATEGORIES)[number]

/** Publication lifecycle (L2D spec §33) — students see `published` only. */
export const STUDY_MATERIAL_STATUSES = ['draft', 'published', 'archived'] as const
export type StudyMaterialStatus = (typeof STUDY_MATERIAL_STATUSES)[number]

/** Upload ceiling — 20 MB (bytes). */
export const STUDY_MATERIAL_MAX_BYTES = 20 * 1024 * 1024

/**
 * Allowed MIME types → canonical extension. Deliberately narrow:
 * PDF, common image formats, plain text and the Office suite. Anything
 * else is rejected at upload time (defense in depth — the stored
 * fileName/extension is ALSO derived from this map, never from the
 * user-supplied filename).
 */
export const STUDY_MATERIAL_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

/** Metadata shape returned by the list/upload APIs (never the fileName).
 *  `subjectName` is resolved server-side (Subject.name for the row's
 *  subjectId) — the raw cuid is useless as a display string and the
 *  browser has no client-side map of DB subject ids. */
export type StudyMaterialMeta = {
  id: string
  title: string
  description: string | null
  subjectId: string | null
  subjectName: string | null
  className: string | null
  category: string
  status: string
  publishedAt: Date | null
  originalName: string
  sizeBytes: number
  mimeType: string
  createdAt: Date
}

/** Row → API metadata (fileName is server-private; ids only). */
export function toStudyMaterialMeta(
  m: StudyMaterial,
  subjectName: string | null = null,
): StudyMaterialMeta {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    subjectId: m.subjectId,
    subjectName,
    className: m.className,
    category: m.category,
    status: m.status,
    publishedAt: m.publishedAt,
    originalName: m.originalName,
    sizeBytes: m.sizeBytes,
    mimeType: m.mimeType,
    createdAt: m.createdAt,
  }
}

/**
 * Generate a SAFE on-disk file name for an upload: a cuid-style server id
 * plus the canonical extension for the (already-validated) MIME type. The
 * user's original filename NEVER reaches the filesystem — only the row's
 * `originalName` column, for the download Content-Disposition.
 */
export function generateStudyMaterialFileName(mimeType: string): string {
  const ext = STUDY_MATERIAL_MIME_TO_EXT[mimeType] ?? 'bin'
  const id = `c${Date.now().toString(36)}${randomBytes(10).toString('hex')}`
  return `${id}.${ext}`
}

/**
 * Defense-in-depth path guard: the stored fileName must be a bare,
 * extension-only name — no separators, no traversal, no hidden/odd
 * characters. Applied at download time (the storage wrapper
 * re-validates every path segment server-side).
 */
export function isSafeStoredFileName(fileName: string): boolean {
  return /^[a-z0-9]+\.[a-z0-9]{1,8}$/.test(fileName)
}

/**
 * RFC 6266 / RFC 5987-safe Content-Disposition value for an arbitrary
 * user-supplied filename: ASCII-safe fallback + UTF-8 encoded form.
 */
export function contentDispositionAttachment(originalName: string): string {
  const fallback = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const utf8 = encodeURIComponent(originalName)
    .replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\*/g, '%2A')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`
}
