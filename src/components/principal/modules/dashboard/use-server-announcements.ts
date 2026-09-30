'use client'

/**
 * use-server-announcements — PHASE 7 real-data contract for the
 * dashboard Notice Board. Reads the canonical school notifications via
 * `GET /api/announcements` (role-visible rows only). NO mock fallback:
 * loading → skeletons, failure → honest error/retry, none → empty
 * state ("No announcements yet").
 */

import { useEffect, useState } from 'react'

export interface ServerAnnouncement {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  sender: string
  createdAt: string
}

export type LoadStatus = 'loading' | 'ready' | 'error'

let cached: ServerAnnouncement[] | null = null

async function fetchAnnouncements(): Promise<ServerAnnouncement[] | null> {
  try {
    const res = await fetch('/api/announcements', { cache: 'no-store' })
    if (!res.ok) return null
    const envelope = (await res.json()) as {
      ok?: boolean
      data?: { announcements?: ServerAnnouncement[] }
    }
    if (!envelope.ok || !Array.isArray(envelope.data?.announcements)) return null
    return envelope.data.announcements
  } catch {
    return null
  }
}

export function useServerAnnouncements(): {
  announcements: ServerAnnouncement[]
  status: LoadStatus
  refresh: () => void
} {
  const [announcements, setAnnouncements] = useState<ServerAnnouncement[]>(cached ?? [])
  const [status, setStatus] = useState<LoadStatus>(cached ? 'ready' : 'loading')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (cached && nonce === 0) {
      setStatus('ready')
      return
    }
    void fetchAnnouncements().then((rows) => {
      if (rows) {
        cached = rows
        setAnnouncements(rows)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
  }, [nonce])

  return { announcements, status, refresh: () => setNonce((n) => n + 1) }
}
