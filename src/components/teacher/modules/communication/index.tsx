'use client'

/**
 * communication/index — the Communication Hub composition: the teacher's
 * single messaging + announcements surface.
 *
 *   · 4 honest summary cards — Unread / Active Conversations / Needs
 *     Reply / Follow-ups — every number is a real count from
 *     /api/teacher/communication (no delivery rates, no fabricated metrics)
 *   · MESSAGES tab — the proven two-pane workspace: LEFT the unified
 *     conversation list (parent threads + direct threads incl. students)
 *     with per-row kebab actions (open / read / unread / pin / needs
 *     reply / archive — ALL persisted), RIGHT the selected thread.
 *     Follow-ups underneath.
 *   · ANNOUNCEMENTS tab — searchable, audience-filtered Notification rows
 *     this role may see, expandable inline, persistent "Mark as read".
 *   · SENT tab — what the teacher has actually sent (parent + direct).
 *
 * Composers:
 *   · New Message — audience-aware by construction: guardians of in-scope
 *     students (multi-select), in-scope students with accounts, the
 *     class-teacher's OWN class groups (Parents / Students / Everyone) or
 *     same-school staff.
 *   · New Announcement — rendered for class teachers (class-scoped
 *     audiences) and, when the position permission exists, school-wide
 *     audiences. The server enforces the same split independently.
 *
 * Parent Connect was absorbed here: the parent-thread engine
 * (/api/teacher/parent-connect) is unchanged, so threads stay unified.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  CheckCheck,
  MailOpen,
  MessagesSquare,
  Megaphone,
  Plus,
  Reply,
  Send,
} from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { ModuleToolbar } from '@/components/teacher/teacher-panel/module-toolbar'
import {
  HubEmptyState,
  HubModuleSkeleton,
  HubSectionError,
  HubStatCardSkeleton,
  HubStatCards,
  type HubStat,
} from '@/components/teacher/modules/shared/hub-stat-cards'
import { useFocusStore } from '@/lib/store/focus-store'
import { useTeacherHubStore } from '@/lib/store/teacher-hub-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { getTeacherActivePermissions, useTeachersStore } from '@/lib/store/teachers-store'
import type { ThreadMessage } from '@/lib/teacher-hub-types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  ConversationList,
  directKey,
  parentKey,
  type RowActions,
  type SelectionKey,
} from './conversation-list'
import { DirectThreadView } from './direct-thread-view'
import { FollowUpDialog, type FollowUpContext } from './follow-up-dialog'
import { FollowUpsCard } from './follow-ups-card'
import {
  patchDirectThread,
  patchParentConversation,
  useCommunicationHub,
  useDirectThread,
  useParentThread,
  markAnnouncementRead,
} from './hooks'
import { AnnouncementsCard } from './announcements-card'
import { CreateAnnouncementDialog } from './create-announcement-dialog'
import { NewMessageDialog } from './new-message-dialog'
import { SentMessagesCard } from './sent-messages'
import { ThreadView } from './thread-view'
import { sortConversations } from './shared'
import type {
  CommunicationAnnouncement,
  DirectConversationSummary,
  DirectThreadMessage,
} from './types'
import type { ConversationSummary } from '@/lib/teacher-hub-types'

/** Placeholder shapes so the error state matches the real card layout. */
const SKELETON_STATS: HubStat[] = [
  { key: 'unread', label: 'Unread Messages', value: null, icon: MailOpen, tone: 'emerald' },
  { key: 'active', label: 'Active Conversations', value: null, icon: MessagesSquare, tone: 'sky' },
  { key: 'reply', label: 'Needs Reply', value: null, icon: Reply, tone: 'amber' },
  { key: 'followups', label: 'Follow-ups', value: null, icon: AlarmClock, tone: 'violet' },
]

type Tab = 'messages' | 'announcements' | 'sent'

export function CommunicationModule({ onNavigate }: { onNavigate?: (key: string) => void }) {
  const { data, loading, error, reload } = useCommunicationHub()
  const [tab, setTab] = useState<Tab>('messages')
  const [selectedKey, setSelectedKey] = useState<SelectionKey | null>(null)
  const [messageOpen, setMessageOpen] = useState(false)
  const [announcementOpen, setAnnouncementOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [followUpCtx, setFollowUpCtx] = useState<FollowUpContext | null>(null)
  /** locally acknowledged announcements (persisted via NotificationRead) */
  const [readOverrides, setReadOverrides] = useState<ReadonlySet<string>>(new Set())

  // Local list state — synced from the server payload after every load.
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [directs, setDirects] = useState<DirectConversationSummary[]>([])
  useEffect(() => {
    if (data) {
      setConversations(data.conversations)
      setDirects(data.directConversations)
    }
  }, [data])

  // ── Selection → the right thread hook ────────────────────────────────
  const selectedParentId = selectedKey?.startsWith('pc:') ? selectedKey.slice(3) : null
  const selectedDirectId = selectedKey?.startsWith('dm:') ? selectedKey.slice(3) : null
  const parentThread = useParentThread(selectedParentId)
  const directThread = useDirectThread(selectedDirectId)
  const selectedConversation = conversations.find((c) => c.id === selectedParentId) ?? null
  const _selectedDirect = directs.find((c) => c.counterpartId === selectedDirectId) ?? null

  // Publish the live unread count for the sidebar badge (Communication Hub
  // now carries the badge Parent Connect used to have).
  useEffect(() => {
    if (!data) return
    useTeacherHubStore.getState().setCounts({
      parentUnread: data.stats.unreadMessages,
      followUpsOpen: data.stats.followUpsOpen,
    })
  }, [data])

  // Opening a parent thread marks the parent's messages read server-side —
  // clear the conversation's local unread so the row + badge follow instantly.
  useEffect(() => {
    if (!parentThread.thread || !selectedParentId) return
    setConversations((prev) => {
      const convo = prev.find((c) => c.id === selectedParentId)
      if (!convo || convo.unread === 0) return prev
      return prev.map((c) => (c.id === selectedParentId ? { ...c, unread: 0 } : c))
    })
  }, [parentThread.thread, selectedParentId])

  // Same for direct threads.
  useEffect(() => {
    if (!directThread.thread || !selectedDirectId) return
    setDirects((prev) => {
      const convo = prev.find((c) => c.counterpartId === selectedDirectId)
      if (!convo || convo.unread === 0) return prev
      return prev.map((c) =>
        c.counterpartId === selectedDirectId ? { ...c, unread: 0 } : c,
      )
    })
  }, [directThread.thread, selectedDirectId])

  // ── Focus deep-links from the command palette — consumed once on data. ──
  const focusConsumed = useRef(false)
  useEffect(() => {
    if (focusConsumed.current || !data) return
    focusConsumed.current = true
    const focus = useFocusStore.getState().focus
    if (!focus || focus.moduleKey !== 'communication' || focus.type !== 'parent') return
    let target: SelectionKey | null = null
    if (focus.id.startsWith('pcv-')) {
      target = parentKey(focus.id.slice(4))
    } else if (focus.id.startsWith('grd-')) {
      const studentId = focus.id.slice(4)
      const hit = data.conversations.find((c) => c.student.id === studentId)
      if (hit) target = parentKey(hit.id)
    }
    // Cross-layer fallback: instant local search rows carry roster ids —
    // match by the ward's name in the subtitle ("Guardian of X · …").
    if (!target && focus.subtitle) {
      const m = /guardian of ([^·]+)/i.exec(focus.subtitle)
      if (m) {
        const wardName = m[1].trim().toLowerCase()
        const hit = data.conversations.find(
          (c) => c.student.name.toLowerCase() === wardName,
        )
        if (hit) target = parentKey(hit.id)
      }
    }
    if (target) {
      setSelectedKey(target)
      setTab('messages')
    }
    useFocusStore.getState().clearFocus()
  }, [data])

  // ── Permissions (REAL checks — no fake grants) ────────────────────────
  const { teachers, positionsList } = useTeachersStore()
  // PHASE 7 (Task 7-a) — the signed-in teacher's OWN staffing record,
  // matched by the SERVER session email (the old `t.id === 'T-014' ||
  // teachers[0]` lookup grabbed an unrelated/fabricated teacher's
  // permissions). An empty or unmatched store resolves to NO record:
  // school-wide permissions then require an explicit position grant —
  // never a borrowed identity.
  const me = useCurrentUser((st) => st.me)
  const currentTeacher = me?.email
    ? teachers.find((t) => (t.email ?? '').toLowerCase() === me.email.toLowerCase()) ?? null
    : null
  const isRelieved =
    currentTeacher != null &&
    ((currentTeacher.status as string) === 'Relieved' ||
      currentTeacher.status === 'Suspended' ||
      (currentTeacher.status as string) === 'Terminated')
  const activePermissions = useMemo(
    () =>
      currentTeacher && !isRelieved
        ? getTeacherActivePermissions(currentTeacher, positionsList)
        : [],
    [currentTeacher, isRelieved, positionsList],
  )
  const canAnnounceSchoolWide = activePermissions.includes('announcements')
  const isClassTeacher = (data?.teacher.classes.length ?? 0) > 0
  /** class-scoped announcements need the appointment; school-wide the permission */
  const canAnnounce = canAnnounceSchoolWide || isClassTeacher

  // ── Handlers ──────────────────────────────────────────────────────────

  const isRead = useCallback(
    (a: CommunicationAnnouncement) => a.readAt != null || readOverrides.has(a.id),
    [readOverrides],
  )

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markAnnouncementRead(id)
      setReadOverrides((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
    } catch (e) {
      toast.error('Could not mark as read', {
        description: e instanceof Error ? e.message : undefined,
      })
    }
  }, [])

  const handleSentParent = useCallback((conversationId: string, message: ThreadMessage) => {
    setConversations((prev) =>
      sortConversations(
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                needsReply: false,
                lastMessage: {
                  body: message.body,
                  fromTeacher: true,
                  createdAt: message.createdAt,
                },
              }
            : c,
        ),
      ),
    )
  }, [])

  const handleSentDirect = useCallback(
    (counterpartId: string, message: DirectThreadMessage) => {
      setDirects((prev) => {
        const existing = prev.find((c) => c.counterpartId === counterpartId)
        const row: DirectConversationSummary = {
          counterpartId,
          counterpartName: directThread.thread?.counterpart.name ?? 'Staff member',
          counterpartRole: directThread.thread?.counterpart.role ?? 'TEACHER',
          lastMessage: {
            id: message.id,
            subject: message.subject,
            body: message.body,
            fromMe: true,
            createdAt: message.createdAt,
          },
          lastMessageAt: message.createdAt,
          unread: 0,
          awaitingReply: false,
          pinned: existing?.pinned ?? false,
          archived: existing?.archived ?? false,
          needsReply: false,
        }
        if (!existing) return [row, ...prev]
        return prev.map((c) => (c.counterpartId === counterpartId ? row : c))
      })
    },
    [directThread.thread],
  )

  const handleTogglePin = useCallback(
    async (conversationId: string, pinned: boolean) => {
      setConversations((prev) =>
        sortConversations(prev.map((c) => (c.id === conversationId ? { ...c, pinned } : c))),
      )
      try {
        await patchParentConversation(conversationId, { pinned })
      } catch (e) {
        toast.error('Could not update the conversation', {
          description: e instanceof Error ? e.message : undefined,
        })
        reload()
      }
    },
    [reload],
  )

  // ── Row action menu (kebab) — every action persists server-side ───────
  const rowActions: RowActions = useMemo(
    () => ({
      onTogglePin: (key, pinned) => {
        if (key.startsWith('pc:')) {
          void handleTogglePin(key.slice(3), pinned)
        } else {
          const id = key.slice(3)
          setDirects((prev) =>
            [...prev]
              .sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
                if (a.archived !== b.archived) return a.archived ? 1 : -1
                return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
              })
              .map((c) => (c.counterpartId === id ? { ...c, pinned } : c)),
          )
          patchDirectThread(id, { pinned }).catch((e: unknown) => {
            toast.error('Could not update the conversation', {
              description: e instanceof Error ? e.message : undefined,
            })
            reload()
          })
        }
      },
      onMarkRead: (key) => {
        if (key.startsWith('pc:')) {
          const id = key.slice(3)
          setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)))
          patchParentConversation(id, { markRead: true }).catch(() => reload())
        } else {
          const id = key.slice(3)
          setDirects((prev) => prev.map((c) => (c.counterpartId === id ? { ...c, unread: 0 } : c)))
          patchDirectThread(id, { markRead: true }).catch(() => reload())
        }
      },
      onMarkUnread: (key) => {
        if (key.startsWith('pc:')) {
          const id = key.slice(3)
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, unread: Math.max(1, c.unread) } : c)),
          )
          patchParentConversation(id, { markUnread: true }).catch(() => reload())
        } else {
          const id = key.slice(3)
          setDirects((prev) =>
            prev.map((c) => (c.counterpartId === id ? { ...c, unread: Math.max(1, c.unread) } : c)),
          )
          patchDirectThread(id, { markUnread: true }).catch(() => reload())
        }
      },
      onSetNeedsReply: (key, needsReply) => {
        if (key.startsWith('pc:')) {
          const id = key.slice(3)
          setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, needsReply } : c)))
          patchParentConversation(id, { needsReply }).catch(() => reload())
        } else {
          const id = key.slice(3)
          setDirects((prev) => prev.map((c) => (c.counterpartId === id ? { ...c, needsReply } : c)))
          patchDirectThread(id, { needsReply }).catch(() => reload())
        }
      },
      onToggleArchive: (key, archived) => {
        if (key.startsWith('pc:')) {
          const id = key.slice(3)
          setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, archived } : c)))
          if (archived && selectedKey === key) setSelectedKey(null)
          patchParentConversation(id, { archived }).catch(() => reload())
        } else {
          const id = key.slice(3)
          setDirects((prev) => prev.map((c) => (c.counterpartId === id ? { ...c, archived } : c)))
          if (archived && selectedKey === key) setSelectedKey(null)
          patchDirectThread(id, { archived }).catch(() => reload())
        }
      },
    }),
    [handleTogglePin, reload, selectedKey],
  )

  const handleMarkFollowUp = useCallback((ctx: FollowUpContext) => {
    setFollowUpCtx(ctx)
    setFollowUpOpen(true)
  }, [])

  const handleFollowUpCreated = useCallback(() => {
    setFollowUpOpen(false)
    reload()
  }, [reload])

  const handleOpenedParent = useCallback(
    (conversationId: string) => {
      setMessageOpen(false)
      if (conversationId) {
        setSelectedKey(parentKey(conversationId))
        setTab('messages')
      }
      reload()
    },
    [reload],
  )

  const handleOpenedDirect = useCallback(
    (counterpartId: string) => {
      setMessageOpen(false)
      setSelectedKey(directKey(counterpartId))
      setTab('messages')
      reload()
    },
    [reload],
  )

  // ── First load: skeleton · error without data: quiet retry state ─────
  if (loading && !data) {
    return (
      <PageTransition className="space-y-4">
        <HubModuleSkeleton />
      </PageTransition>
    )
  }

  if (!data) {
    return (
      <PageTransition className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SKELETON_STATS.map((s) => (
            <HubStatCardSkeleton key={s.key} />
          ))}
        </div>
        <HubSectionError message={error ?? 'Communication Hub could not load.'} onRetry={reload} />
      </PageTransition>
    )
  }

  const stats = data.stats
  const unreadAnnouncements = data.announcements.filter((a) => !isRead(a)).length

  const summaryStats: HubStat[] = [
    {
      key: 'unread',
      label: 'Unread Messages',
      value: stats.unreadMessages,
      context:
        stats.unreadMessages > 0
          ? `${stats.unreadParentMessages} from parents · ${stats.unreadDirectMessages} direct`
          : 'all caught up',
      icon: MailOpen,
      tone: 'emerald',
    },
    {
      key: 'active',
      label: 'Active Conversations',
      value: stats.activeConversations,
      context: `${stats.conversations} parent · ${stats.directConversations} staff & students`,
      icon: MessagesSquare,
      tone: 'sky',
    },
    {
      key: 'reply',
      label: 'Needs Reply',
      value: stats.needsReply,
      context: 'latest message is waiting for you',
      icon: Reply,
      tone: 'amber',
    },
    {
      key: 'followups',
      label: 'Follow-ups',
      value: stats.followUpsOpen,
      context:
        stats.followUpsOpen > 0
          ? `${stats.followUpsDue} due today`
          : 'nothing scheduled',
      icon: AlarmClock,
      tone: 'violet',
    },
  ]

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    {
      id: 'messages',
      label: 'Messages',
      icon: <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />,
      count: stats.conversations + stats.directConversations,
    },
    {
      id: 'announcements',
      label: 'Announcements',
      icon: <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />,
      count: data.announcements.length,
    },
    {
      id: 'sent',
      label: 'Sent',
      icon: <Send className="h-3.5 w-3.5" aria-hidden="true" />,
      count: stats.messagesSent,
    },
  ]

  const toolbarActions = (
    <div className="flex items-center gap-2">
      {canAnnounce && (
        <button
          onClick={() => setAnnouncementOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
          New Announcement
        </button>
      )}
      <button
        onClick={() => setMessageOpen(true)}
        className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New Message
      </button>
    </div>
  )

  return (
    <PageTransition className="space-y-4">
      <ModuleToolbar
        context={`Messages and conversations · ${data.teacher.scopeLabel}`}
        action={toolbarActions}
      />

      {error && <HubSectionError message={error} onRetry={reload} />}

      <HubStatCards stats={summaryStats} />

      {/* Tabs — the same pill treatment as the other Teacher Hub modules */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Communication views">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition-all',
              tab === t.id
                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                tab === t.id ? 'bg-primary-foreground/20' : 'bg-muted',
                t.id === 'announcements' && unreadAnnouncements > 0 && tab !== t.id
                  ? 'bg-primary/15 text-primary'
                  : undefined,
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'messages' ? (
        <div className="space-y-4">
          {/* Two-pane workspace — desktop/tablet: list | thread. Mobile:
              tapping a conversation replaces the pane (full-screen thread
              with a back button) — never squeezed side by side. */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="grid h-[540px] lg:h-[600px] lg:grid-cols-[340px_1fr]">
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-col border-b border-border lg:border-b-0 lg:border-r',
                  selectedKey && 'hidden lg:flex',
                )}
              >
                <ConversationList
                  conversations={conversations}
                  directConversations={directs}
                  activeKey={selectedKey}
                  onSelect={setSelectedKey}
                  onNewMessage={() => setMessageOpen(true)}
                  actions={rowActions}
                />
              </div>
              <div className={cn('flex min-h-0 min-w-0 flex-col', !selectedKey && 'hidden lg:flex')}>
                {selectedParentId ? (
                  <ThreadView
                    key={selectedParentId}
                    conversationId={selectedParentId}
                    summary={selectedConversation}
                    thread={parentThread.thread}
                    loading={parentThread.loading}
                    error={parentThread.error}
                    onRetry={parentThread.reload}
                    onBack={() => setSelectedKey(null)}
                    onNavigate={onNavigate}
                    teacherName={data.teacher.name}
                    templates={data.templates}
                    onSent={handleSentParent}
                    onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
                    onMarkFollowUp={handleMarkFollowUp}
                  />
                ) : selectedDirectId ? (
                  <DirectThreadView
                    key={selectedDirectId}
                    thread={directThread.thread}
                    loading={directThread.loading}
                    error={directThread.error}
                    onRetry={directThread.reload}
                    onBack={() => setSelectedKey(null)}
                    onSent={handleSentDirect}
                  />
                ) : (
                  <HubEmptyState
                    icon={CheckCheck}
                    title="Select a conversation"
                    hint="Choose a parent thread or a direct conversation from the list to read and reply."
                    className="h-full"
                  />
                )}
              </div>
            </div>
          </div>

          <FollowUpsCard
            followUps={data.followUps}
            onOpenConversation={(conversationId) => setSelectedKey(parentKey(conversationId))}
            onChanged={reload}
          />
        </div>
      ) : tab === 'announcements' ? (
        <div className="grid grid-cols-1 gap-4">
          <AnnouncementsCard
            announcements={data.announcements}
            isRead={isRead}
            onMarkRead={handleMarkRead}
            onNewAnnouncement={canAnnounce ? () => setAnnouncementOpen(true) : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <SentMessagesCard
            messages={data.sentMessages}
            onNewMessage={() => setMessageOpen(true)}
          />
        </div>
      )}

      {/* Dialogs */}
      <NewMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        students={data.students}
        templates={data.templates}
        staffDirectory={data.staffDirectory}
        teacherName={data.teacher.name}
        classes={data.teacher.classes}
        onOpenedParent={handleOpenedParent}
        onOpenedDirect={handleOpenedDirect}
        onSent={reload}
      />

      {canAnnounce && (
        <CreateAnnouncementDialog
          open={announcementOpen}
          onOpenChange={setAnnouncementOpen}
          classes={data.teacher.classes}
          canAnnounceSchoolWide={canAnnounceSchoolWide}
          onPublished={reload}
        />
      )}

      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        context={followUpCtx}
        onCreated={handleFollowUpCreated}
      />
    </PageTransition>
  )
}
