'use client'

/**
 * comm-history (PHASE 7.5) — delivery history.
 *
 * The fabricated "local history" store list is RETIRED (the store is
 * un-seeded; the composer no longer writes client rows). This tab is now
 * the REAL platform record view:
 *
 *   · PlatformBroadcasts — GET /api/announcements server rows with
 *     acknowledgement counts, delivery rates and per-row read feeds
 *   · the search box filters the platform rows and serves the notice
 *     deep-link from the command palette
 *
 * Announcement lifecycle management (drafts, scheduling, archiving, edits)
 * lives in the Announcements tab.
 */

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { PlatformBroadcasts } from './comm-platform-broadcasts'

export function HistorySection({ focusNotice, onNoticeConsumed }: {
  focusNotice?: { id: string; title: string; ts: number } | null
  onNoticeConsumed?: () => void
}) {
  const [search, setSearch] = useState('')

  // Notice deep-link: pre-fill the search box so the platform history
  // filters to the notice; PlatformBroadcasts consumes the same request
  // and auto-opens the matching live record when the rows have loaded.
  useEffect(() => {
    if (focusNotice?.title) setSearch(focusNotice.title)
  }, [focusNotice?.ts])

  return (
    <div className="space-y-3 max-w-7xl mx-auto">
      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, message or sender…"
            aria-label="Search communication history"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Platform broadcasts — the authoritative server history */}
      <PlatformBroadcasts search={search} focusNotice={focusNotice} onNoticeConsumed={onNoticeConsumed} />
    </div>
  )
}
