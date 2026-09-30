'use client'

/**
 * school-settings server-write helpers (PHASE 7.5).
 *
 * `patchSchoolSettings` — validated PATCH /api/school-settings call shared
 * by every settings tab. Returns the server's verbatim error message on
 * failure (the tabs surface it in toasts, never a guessed phrase) and the
 * updated config on success (the caller applies it to the store so local
 * state re-syncs with the authoritative value).
 */

import type { SchoolSettingsConfig } from '@/lib/store/school-settings-store'

export interface PatchResult {
  ok: boolean
  error: string | null
  config: SchoolSettingsConfig | null
}

export async function patchSchoolSettings(body: Record<string, unknown>): Promise<PatchResult> {
  try {
    const r = await fetch('/api/school-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { config?: SchoolSettingsConfig } }
      | null
    if (!r.ok || !j?.success || !j?.data?.config) {
      return { ok: false, error: j?.error ?? 'School settings could not be saved. Please try again.', config: null }
    }
    return { ok: true, error: null, config: j.data.config }
  } catch {
    return { ok: false, error: 'School settings server is unreachable — check your connection and retry.', config: null }
  }
}

/** Patch a single settings-JSON slice (timetable / attendance / …). */
export async function patchSettingsSlice(
  sliceKey: string,
  slice: object,
): Promise<PatchResult> {
  return patchSchoolSettings({ settings: { [sliceKey]: slice } })
}

/**
 * Upload one image through the website-scope upload API and return the
 * server-minted file id + preview URL. Shared by the Branding tab
 * (logo/favicon) and the announcement composer.
 */
export interface UploadResult {
  ok: boolean
  error: string | null
  fileId: string | null
  url: string | null
}

export async function uploadWebsiteImage(file: File): Promise<UploadResult> {
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false, error: 'Image is too large. Maximum size is 4 MB.', fileId: null, url: null }
  }
  const form = new FormData()
  form.append('file', file)
  try {
    const r = await fetch('/api/school/website/upload', { method: 'POST', body: form })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { fileId?: string; url?: string } }
      | null
    if (!r.ok || !j?.success || !j.data?.fileId) {
      return { ok: false, error: j?.error ?? 'Upload failed. Please try again.', fileId: null, url: null }
    }
    return { ok: true, error: null, fileId: j.data.fileId, url: j.data.url ?? null }
  } catch {
    return { ok: false, error: 'Upload server is unreachable — check your connection and retry.', fileId: null, url: null }
  }
}
