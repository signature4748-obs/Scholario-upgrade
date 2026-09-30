'use client'

/**
 * StudentNotificationsModule — the student's "My Feed" (Notices tab 1).
 *
 * A data-driven feed DERIVED from real sources (no fabricated items):
 *
 *   Timetable        → timetable-store publications (≤72h, affects the
 *                      student's class) — one notification per publication.
 *   Fee reminder     → the session student's roster record (feeStatus ≠ Paid)
 *   Library overdue  → library-store issues (own borrower id, Overdue)
 *   New messages     → student-messaging store unread conversations
 *   School news      → LR-1: REAL announcements from /api/student/notices
 *                      (audience-scoped Notification rows published by the
 *                      school — no static demo content).
 *
 * 7-b: the FAKE exam-schedule items (mock/academics `exams`) are RETIRED —
 * exam dates are published through real school announcements/notifications
 * only; nothing is fabricated here.
 *
 * Read state + "Mark all read" persist in the shared student-notif-prefs
 * store (the channel switches live in Settings); announcement rows ALSO
 * honour the server-side acknowledgement (NotificationRead) so feed state
 * converges with the Announcements tab. `onNavigate` (optional) deep-links
 * each item to its module.
 *
 * LR-1 no-duplicate-title rule: no giant "Notifications" heading — the
 * Notices tab bar above says where you are; this opens straight into a
 * compact toolbar + the scannable feed.
 */
import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Award, IndianRupee, Library, MessageCircle,
  Megaphone, CheckCheck, ChevronRight, Bell, CalendarDays,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime, formatDate, formatINR } from '@/lib/format'
import { useMyStudentRecord, type StudentRecord } from '@/lib/store/students-store'
import { useLibraryStore, type IssueRecord } from '@/lib/store/library-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import {
  useStudentMessagingStore, countUnreadConversations, isConversationUnread,
  type StudentConversation,
} from '@/lib/store/student-messaging-store'
import { useStudentNotifPrefsStore, NOTIF_KIND_TO_PREF } from '@/lib/store/student-notif-prefs-store'
import { useTimetableStore, getRecentChangesForClass, type PublishedVersion } from '@/lib/store/timetable-store'
import { useServerNotices, type ServerNotice } from '@/lib/store/server-notices-store'
import { toast } from 'sonner'

// ─── Types ───────────────────────────────────────────────────────────

export type StudentNotificationTarget =
  | 'results' | 'fees'
  | 'messages' | 'announcements' | 'timetable'

export type StudentNotificationKind =
  | 'exam' | 'fee' | 'library' | 'message' | 'announcement' | 'timetable'

export interface StudentNotificationItem {
  id: string
  kind: StudentNotificationKind
  title: string
  description: string
  /** Event timestamp (ISO). Standing reminders carry a label instead. */
  at?: string
  /** Label shown instead of a relative time (e.g. 'This term'). */
  standing?: string
  target?: StudentNotificationTarget
  /** Server-acknowledged (announcement rows) — treated as already read. */
  serverRead?: boolean
}

interface BuildDeps {
  student: StudentRecord | undefined
  issues: IssueRecord[]
  conversations: StudentConversation[]
  seenAt: Record<string, string>
  publications: PublishedVersion[]
  /** LR-1 — real school announcements (null while loading). */
  serverNotices: ServerNotice[] | null
}

// ─── Derivation (single source of truth for feed + badge) ───────────

export function buildStudentNotifications({ student, issues, conversations, seenAt, publications, serverNotices }: BuildDeps): StudentNotificationItem[] {
  const items: StudentNotificationItem[] = []

  // Timetable — ONE notification per recent publication (≤72h) whose
  // changes affect the student's class. Same TTL as the timetable's
  // "Updated" chips; the id is keyed by version so the same event is
  // never duplicated in the feed.
  if (student) {
    const myClass = `${student.className}-${student.section}`
    for (const pub of publications) {
      if (Date.now() >= new Date(pub.publishedAt).getTime() + 72 * 60 * 60 * 1000) continue
      const affecting = getRecentChangesForClass(myClass, [pub])
      if (affecting.length === 0) continue
      const first = affecting[0]
      items.push({
        id: `tt-pub-${pub.version}`,
        kind: 'timetable',
        title: 'Your class timetable was updated',
        description:
          affecting.length === 1 && first.changeLabel
            ? `${first.context.split(' · ')[1] ?? first.context} — ${first.changeLabel}`
            : `${affecting.length} changes published by your school`,
        at: pub.publishedAt,
        target: 'timetable',
      })
    }
  }

  // (7-b) Exams — no fabricated schedule announcements. Exam notices reach
  // the student through REAL school announcements/notifications only.

  // Fee reminder — standing, derived from the canonical student record
  if (student && student.feeStatus !== 'Paid') {
    const pending = Math.max(0, student.feeTotal - student.feePaid)
    items.push({
      id: `fee-${student.id}`,
      kind: 'fee',
      title: 'Fee reminder',
      description: `${formatINR(pending)} pending of ${formatINR(student.feeTotal)} (${student.feeStatus})`,
      standing: 'This term',
      target: 'fees',
    })
  }

  // Library — the student's own overdue issues (with fine). Informational
  // only (no target): the dedicated student Library module was retired in
  // the 2.9 workspace cut — returns/fines settle at the counter.
  if (student) {
    for (const i of issues.filter((x) => x.borrowerId === student.id && x.status === 'Overdue')) {
      items.push({
        id: `lib-${i.id}`,
        kind: 'library',
        title: `Library book overdue — ${i.bookTitle}`,
        description: `Was due ${formatDate(i.dueDate)} · fine ${formatINR(i.fine)}`,
        at: i.dueDate,
      })
    }
  }

  // New messages — one notification while any conversation is unread
  const unread = countUnreadConversations(conversations, seenAt)
  if (unread > 0) {
    const latestUnreadAt = conversations.reduce<string | undefined>((acc, c) => {
      if (!isConversationUnread(c, seenAt)) return acc
      return !acc || c.lastOn > acc ? c.lastOn : acc
    }, undefined)
    items.push({
      id: 'msg-unread',
      kind: 'message',
      title: 'New message from teacher',
      description: `${unread} unread conversation${unread > 1 ? 's' : ''} — open Messages`,
      at: latestUnreadAt,
      target: 'messages',
    })
  }

  // School news — LR-1: the REAL published announcements (audience-scoped,
  // read state honoured from the server acknowledgement). While the feed
  // is loading we show nothing rather than fabricated placeholders.
  for (const n of serverNotices ?? []) {
    items.push({
      id: `ann-${n.id}`,
      kind: 'announcement',
      title: n.title,
      description: `${n.audience} · ${n.sender}`,
      at: n.createdAt,
      target: 'announcements',
      serverRead: n.read,
    })
  }

  // Newest first; standing reminders (no timestamp) sort last.
  return items.sort((a, b) => (b.at ? new Date(b.at).getTime() : 0) - (a.at ? new Date(a.at).getTime() : 0))
}

/** Nav-badge helper — unread derived notifications (not in readIds AND not
 *  server-acknowledged). SS-1: disabled channels never count toward the
 *  badge (same filter the feed applies — prefs are server-persisted,
 *  hydrated on panel mount). */
export function useUnreadStudentNotificationCount(): number {
  const student = useMyStudentRecord()
  const issues = useLibraryStore((s) => s.issues)
  const conversations = useStudentMessagingStore((s) => s.conversations)
  const seenAt = useStudentMessagingStore((s) => s.seenAt)
  const publications = useTimetableStore((s) => s.publications)
  const serverNotices = useServerNotices((s) => s.notices)
  const readIds = useStudentNotifPrefsStore((s) => s.readIds)
  const prefs = useStudentNotifPrefsStore((s) => s.prefs)
  return useMemo(() => {
    const items = buildStudentNotifications({ student, issues, conversations, seenAt, publications, serverNotices })
    return items.filter(
      (i) => !i.serverRead && !readIds.includes(i.id) && (prefs[NOTIF_KIND_TO_PREF[i.kind]] ?? true),
    ).length
  }, [student, issues, conversations, seenAt, publications, serverNotices, readIds, prefs])
}

// ─── Presentation meta ───────────────────────────────────────────────

const KIND_META: Record<StudentNotificationKind, { icon: typeof Bell; tone: string; label: string }> = {
  exam: { icon: Award, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', label: 'Exam' },
  fee: { icon: IndianRupee, tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', label: 'Fees' },
  library: { icon: Library, tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', label: 'Library' },
  message: { icon: MessageCircle, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'Messages' },
  announcement: { icon: Megaphone, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', label: 'School' },
  timetable: { icon: CalendarDays, tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', label: 'Timetable' },
}

// ─── Module ──────────────────────────────────────────────────────────

export function StudentNotificationsModule({ onNavigate }: { onNavigate?: (key: string) => void }) {
  const student = useMyStudentRecord()
  const issues = useLibraryStore((s) => s.issues)

  // FINAL-GATE (EG-9F/R4) — the demo feed's library-due items come from the
  // library store's sanctioned demo seed; apply it once here (module root).
  // A real tenant keeps the honest empty library slice (feed shows only
  // real server notices/messages).
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useLibraryStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  const publications = useTimetableStore((s) => s.publications)
  const conversations = useStudentMessagingStore((s) => s.conversations)
  const seenAt = useStudentMessagingStore((s) => s.seenAt)
  const serverNotices = useServerNotices((s) => s.notices)
  const readIds = useStudentNotifPrefsStore((s) => s.readIds)
  const prefs = useStudentNotifPrefsStore((s) => s.prefs)
  const markRead = useStudentNotifPrefsStore((s) => s.markRead)
  const markAllRead = useStudentNotifPrefsStore((s) => s.markAllRead)

  // SS-1 — channel preferences filter the feed (server-persisted prefs;
  // messages/announcements are ALSO enforced server-side in the bell feed).
  const items = useMemo(
    () =>
      buildStudentNotifications({ student, issues, conversations, seenAt, publications, serverNotices })
        .filter((i) => prefs[NOTIF_KIND_TO_PREF[i.kind]] ?? true),
    [student, issues, conversations, seenAt, publications, serverNotices, prefs],
  )
  const isRead = (i: StudentNotificationItem) => i.serverRead === true || readIds.includes(i.id)
  const unreadItems = items.filter((i) => !isRead(i))

  const handleMarkAllRead = () => {
    markAllRead(items.map((i) => i.id))
    toast.success('All notifications marked as read')
  }

  const handleItemClick = (item: StudentNotificationItem) => {
    markRead(item.id)
    if (item.target && onNavigate) onNavigate(item.target)
  }

  return (
    <div className="space-y-3">
      {/* ── Compact toolbar — honest counts, no module title (LR-1) ── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {items.length} item{items.length === 1 ? '' : 's'}
          {unreadItems.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {unreadItems.length} new
            </span>
          )}
        </p>
        {unreadItems.length > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleMarkAllRead}>
            <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border bg-card/50 px-4 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Nothing needs your attention right now.
          </p>
        </div>
      ) : (
        /* ── The feed — one scannable list, not stacked cards ─────── */
        <div className="max-h-[62vh] space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
          {items.map((item, i) => {
            const meta = KIND_META[item.kind]
            const Icon = meta.icon
            const unread = !isRead(item)
            const time = item.standing ?? (item.at ? formatRelativeTime(item.at) : '')
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.2 }}
              >
                <div
                  role={item.target ? 'button' : undefined}
                  tabIndex={item.target ? 0 : undefined}
                  onClick={() => handleItemClick(item)}
                  onKeyDown={(e) => {
                    if (item.target && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      handleItemClick(item)
                    }
                  }}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                    unread ? 'border-primary/25 bg-primary/[0.04]' : 'border-border/70 bg-card/40',
                    item.target && 'cursor-pointer hover:border-primary/40 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring/40',
                  )}
                >
                  <span className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    meta.tone,
                    !unread && 'opacity-60',
                  )}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium text-muted-foreground')}>
                        {item.title}
                      </span>
                      {unread && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                      )}
                    </span>
                    <span className={cn('mt-0.5 block truncate text-[11px] leading-relaxed', unread ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                      {item.description}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        {meta.label}
                      </span>
                      {time && (
                        <>
                          <span aria-hidden className="text-muted-foreground/30">·</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground/70">{time}</span>
                        </>
                      )}
                      {item.target && (
                        <>
                          <span aria-hidden className="text-muted-foreground/30">·</span>
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary">
                            View <ChevronRight className="h-3 w-3" aria-hidden />
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
