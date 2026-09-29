'use client'

/**
 * Client side of the signed-file-access contract (Phase 1).
 *
 * Stored documents (admission documents, teacher media) no longer serve
 * anonymously. Where a `<img src>` / `<a href>` cannot carry the
 * Authorization header (the dev preview iframe renders this app
 * cross-site, so neither cookie nor header rides along), we mint a
 * short-lived signed URL via the authenticated access endpoint and cache
 * it for its validity window.
 */
import { useEffect, useState } from 'react'

export type FileScope = 'teachers' | 'admissions'

interface CacheEntry {
  url: string
  expiresAt: number // epoch ms
}

const urlCache = new Map<string, CacheEntry>()

/**
 * Mint (or reuse) a signed URL for one stored file.
 * Returns null when the grant fails (unauthenticated, missing file…) —
 * callers render their empty/placeholder state.
 */
export async function signedFileUrl(
  fileId: string,
  scope: FileScope,
  download = false,
): Promise<string | null> {
  const key = `${scope}:${fileId}:${download ? 1 : 0}`
  const hit = urlCache.get(key)
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit.url

  try {
    const res = await fetch(`/api/${scope}/upload/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, download }),
    })
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: { url?: string; expiresAt?: string } }
      | null
    if (res.ok && j?.ok && j.data?.url && j.data?.expiresAt) {
      const expiresAt = new Date(j.data.expiresAt).getTime()
      urlCache.set(key, { url: j.data.url, expiresAt })
      return j.data.url
    }
  } catch {
    // network hiccup — caller falls back to its placeholder
  }
  return null
}

/**
 * React hook resolving a signed URL for a file id (null while resolving,
 * or when access is denied). Re-fetches when the fileId changes.
 */
export function useSignedFileUrl(
  fileId: string | null | undefined,
  scope: FileScope,
  download = false,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!fileId) {
      setUrl(null)
      return
    }
    setUrl(null)
    signedFileUrl(fileId, scope, download).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [fileId, scope, download])

  return url
}
