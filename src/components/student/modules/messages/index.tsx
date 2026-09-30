'use client'

/**
 * StudentMessagesModule — student ↔ teacher direct messages
 * (master-detail).
 *
 * Recipients are restricted to the student's class teacher + subject
 * teachers of their own class section (derived from the students-store
 * class record — never a school-wide directory). Sending appends a
 * persisted student message; the app NEVER fabricates teacher replies.
 * Unread is derived (last message from teacher + not seen since).
 *
 * LR-1 no-duplicate-title rule: NO giant "Messages" heading — the
 * sidebar + top bar already say where you are. One compact toolbar
 * (quiet context line + New message) sits directly above the mail-style
 * two-pane surface, and the content owns the rest of the space.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, MessageCircle, Plus, Search, Send, X, Inbox,
} from 'lucide-react'
import { GlassCard, GradientAvatar } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatRelativeTime, formatTime, formatDate } from '@/lib/format'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { toast } from 'sonner'
import {
  useStudentMessagingStore, isConversationUnread, countUnreadConversations,
  type StudentConversation,
} from '@/lib/store/student-messaging-store'
import { useStudentsStore, useMyStudentRecord, type StudentRecord, type ClassRecord } from '@/lib/store/students-store'
import type { SubjectDef } from '@/lib/mock/academic'
// PHASE 7 (Task 7-a) — teacher identities resolve from the school's real
// roster store (hydrated from /api/teachers for staff sessions; students
// see an honest empty list — never fabricated teacher names).
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'

/** Timestamp label for a message bubble — time today, date otherwise. */
function messageStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  return sameDay ? formatTime(d) : formatDate(d)
}

/** Teachers the student may message — class teacher + subject teachers of
 *  their OWN class section (spec §30 — never a school-wide directory). */
function classContacts(
  student: StudentRecord | undefined,
  classes: ClassRecord[],
  subjects: SubjectDef[],
): { id: string; name: string; subject: string; role: string }[] {
  if (!student) return []
  const cls = classes.find((c) => c.id === student.classId)
  if (!cls) return []
  const section = cls.sections.find((s) => s.name === student.section)
  const roster: { id: string; name: string; subject: string; role: string }[] = []
  const seen = new Set<string>()
  const push = (id: string | undefined, subject: string, role: string) => {
    if (!id || seen.has(id)) return
    // Dual-id match (Phase 7): class data carries the teacher's USER id
    // (Class.classTeacherId / CSA.teacherUserId); the roster keys Teacher
    // rows — real appointed teachers must resolve.
    const t = useTeacherRosterStore.getState().teachers.find((x) => x.id === id || x.userId === id)
    if (!t) return
    seen.add(id)
    roster.push({ id: t.id, name: t.name, subject, role })
  }
  push(section?.classTeacherId ?? cls.classTeacherId, 'Class Teacher', 'Class Teacher')
  for (const [subId, tid] of Object.entries(cls.subjectTeachers)) {
    const name = subjects.find((s) => s.id === subId)?.name ?? subId.replace('sub-', '')
    push(tid, name.charAt(0).toUpperCase() + name.slice(1), 'Subject Teacher')
  }
  return roster
}

export function StudentMessagesModule() {
  const conversations = useStudentMessagingStore((s) => s.conversations)
  const seenAt = useStudentMessagingStore((s) => s.seenAt)
  const markConversationSeen = useStudentMessagingStore((s) => s.markConversationSeen)

  // Canonical identity — the session user's own roster record (server
  // sync stamps the userId/email link fields; the legacy demo record
  // covers the pre-sync paint).
  const student = useMyStudentRecord()
  const classes = useStudentsStore((s) => s.classes)
  const subjects = useStudentsStore((s) => s.academicSubjects)

  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)

  const unread = countUnreadConversations(conversations, seenAt)
  const contacts = useMemo(() => classContacts(student, classes, subjects), [student, classes, subjects])

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => (a.lastOn < b.lastOn ? 1 : -1)),
    [conversations],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((c) =>
      c.teacherName.toLowerCase().includes(q) ||
      c.subject.toLowerCase().includes(q) ||
      (c.messages[c.messages.length - 1]?.body ?? '').toLowerCase().includes(q),
    )
  }, [sorted, query])

  const active = conversations.find((c) => c.id === openId) ?? null

  // Opening a thread flips the honest derived-read "seen" flag (re-fires
  // when a new message lands while the thread is open).
  useEffect(() => {
    if (openId) markConversationSeen(openId)
  }, [openId, markConversationSeen, active?.messages.length])

  return (
    <div className="space-y-3">
      {/* ── Compact toolbar — context + actions, no module title (LR-1) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {student
            ? `${student.className}-${student.section} · class teacher & subject teachers`
            : 'Direct messages with your teachers'}
        </p>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 text-[10px]">
              {unread} unread
            </Badge>
          )}
          <Button size="sm" className="h-8" onClick={() => setComposing(true)}>
            <Plus className="h-4 w-4" /> New message
          </Button>
        </div>
      </div>

      <GlassCard className="p-0 overflow-hidden flex h-[70vh] lg:h-[calc(100vh-13rem)] min-h-[28rem]">
        {/* ── Conversation list (master) ── */}
        <div
          className={cn(
            'w-full lg:w-[330px] lg:min-w-[330px] lg:max-w-[330px] shrink-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col',
            openId && 'hidden lg:flex',
          )}
        >
          <div className="p-3 border-b border-border/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {filtered.length === 0 ? (
              <EmptyMini
                text={
                  conversations.length === 0
                    ? 'No conversations yet — message your class teacher to get started.'
                    : 'No conversations match your search.'
                }
              />
            ) : (
              filtered.map((c, i) => {
                const isUnread = isConversationUnread(c, seenAt)
                const last = c.messages[c.messages.length - 1]
                const selected = openId === c.id
                return (
                  <motion.button
                    key={c.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.2) }}
                    onClick={() => setOpenId(c.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'relative w-full flex items-start gap-3 px-3.5 py-3 text-left border-b border-border/40 transition-colors',
                      selected ? 'bg-primary/[0.06]' : 'hover:bg-muted/40',
                    )}
                  >
                    {/* Selection rail — a hairline accent on the open thread */}
                    {selected && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-r-full bg-primary" aria-hidden />
                    )}
                    <GradientAvatar name={c.teacherName} size="sm" className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn(
                          'text-[13px] truncate flex-1',
                          isUnread ? 'font-semibold' : 'font-medium text-foreground/85',
                        )}>{c.teacherName}</p>
                        {isUnread && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{c.subject}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className={cn(
                          'text-[10px] truncate flex-1',
                          isUnread ? 'text-muted-foreground' : 'text-muted-foreground/70',
                        )}>
                          {last ? `${last.from === 'teacher' ? '' : 'You: '}${last.body}` : '—'}
                        </p>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
                          {formatRelativeTime(c.lastOn)}
                        </span>
                      </div>
                    </div>
                  </motion.button>
                )
              })
            )}
          </div>
        </div>

        {/* ── Thread (detail) ── */}
        <div className={cn('flex-1 min-w-0 flex flex-col', !openId && 'hidden lg:flex')}>
          {active ? (
            <ThreadView
              conversation={active}
              onBack={() => setOpenId(null)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
                <Inbox className="h-6 w-6" aria-hidden />
              </div>
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                Pick a thread from the list, or start a new message to your class teacher.
              </p>
              <Button variant="outline" size="sm" className="mt-4 h-8 gap-1.5 lg:hidden" onClick={() => setComposing(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> New message
              </Button>
            </div>
          )}
        </div>
      </GlassCard>

      {/* New message dialog */}
      {composing && (
        <NewMessageDialog
          contacts={contacts}
          onClose={() => setComposing(false)}
          onStarted={(id) => {
            setComposing(false)
            setOpenId(id)
          }}
        />
      )}
    </div>
  )
}

// ─── Thread (detail pane) ───────────────────────────────────────────

function ThreadView({ conversation, onBack }: { conversation: StudentConversation; onBack: () => void }) {
  const sendMessage = useStudentMessagingStore((s) => s.sendMessage)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the newest message — deferred one rAF frame so the new
  // message height is measured before scrolling (same fix as the principal
  // messaging thread-view).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    })
    return () => cancelAnimationFrame(id)
  }, [conversation.id, conversation.messages.length])

  const send = () => {
    const body = draft.trim()
    if (!body) return
    const result = sendMessage(conversation.id, body)
    if (result.ok) setDraft('')
    else toast.error('Could not send message', { description: result.error })
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Thread header */}
      <div className="shrink-0 flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border/60">
        <button
          onClick={onBack}
          className="lg:hidden -ml-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <GradientAvatar name={conversation.teacherName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{conversation.teacherName}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {conversation.teacherSubject} · {conversation.subject}
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground shrink-0">
          Teacher
        </Badge>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 sm:px-4 py-4 space-y-3">
        {conversation.messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('flex', m.from === 'student' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[82%] sm:max-w-[70%] px-3.5 py-2.5 shadow-xs',
                m.from === 'student'
                  ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md'
                  : 'bg-muted/50 rounded-2xl rounded-bl-md',
              )}
            >
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={cn(
                  'text-[10px] mt-1',
                  m.from === 'student' ? 'text-primary-foreground/70' : 'text-muted-foreground/70',
                )}
              >
                {m.from === 'student' ? 'You · ' : ''}{messageStamp(m.sentOn)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Composer */}
      <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-3 border-t border-border/60 bg-muted/20">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={`Message ${conversation.teacherName.split(' ')[0]}…`}
          aria-label={`Message ${conversation.teacherName}`}
          className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-[13px] placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <Button size="sm" onClick={send} disabled={!draft.trim()} aria-label="Send message">
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </div>
    </div>
  )
}

// ─── New message dialog ─────────────────────────────────────────────

function NewMessageDialog({
  contacts,
  onClose,
  onStarted,
}: {
  contacts: { id: string; name: string; subject: string; role: string }[]
  onClose: () => void
  onStarted: (conversationId: string) => void
}) {
  const startConversation = useStudentMessagingStore((s) => s.startConversation)
  const [recipientId, setRecipientId] = useState(contacts[0]?.id ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  useDismissOnEscape(onClose)

  const submit = () => {
    const recipient = contacts.find((c) => c.id === recipientId)
    if (!recipient) {
      setError('Choose a recipient first.')
      return
    }
    const result = startConversation({
      teacherId: recipient.id,
      teacherName: recipient.name,
      teacherSubject: recipient.subject,
      subject: subject.trim(),
      body,
    })
    if (result.ok) {
      toast.success('Message sent', { description: `${recipient.name} · ${subject.trim()}` })
      onStarted(result.conversation.id)
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New message"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-premium-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-border/60">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">New message</h3>
            <p className="text-xs text-muted-foreground truncate">
              Your class teacher & subject teachers only
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close new message dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* Recipient picker — restricted to the student's class staff.
              7-b guard: with no resolvable class staff the picker stays
              honestly empty (no fabricated recipients). */}
          {contacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center" role="note">
              <p className="text-xs font-medium text-foreground">No class staff available to message</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Your class teacher and subject teachers will appear here once the school assigns
                them to your class.
              </p>
            </div>
          ) : (
          <div role="radiogroup" aria-label="Recipient" className="space-y-1.5">
            {contacts.map((c) => (
              <button
                key={c.id}
                role="radio"
                aria-checked={recipientId === c.id}
                onClick={() => setRecipientId(c.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors',
                  recipientId === c.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-card/40 hover:bg-muted/30',
                )}
              >
                <GradientAvatar name={c.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.subject} · {c.role}</p>
                </div>
                <span
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center',
                    recipientId === c.id ? 'border-primary' : 'border-border',
                  )}
                >
                  {recipientId === c.id && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
              </button>
            ))}
          </div>
          )}

          <div>
            <label htmlFor="nm-subject" className="text-xs font-medium text-muted-foreground">
              Subject
            </label>
            <input
              id="nm-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Doubt in today's homework"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div>
            <label htmlFor="nm-body" className="text-xs font-medium text-muted-foreground">
              Message
            </label>
            <textarea
              id="nm-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!subject.trim() || !body.trim() || !recipientId}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared empty state ─────────────────────────────────────────────

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="py-12 text-center px-6">
      <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
        <MessageCircle className="h-4.5 w-4.5" aria-hidden />
      </div>
      <p className="text-xs text-muted-foreground max-w-[16rem] mx-auto leading-relaxed">{text}</p>
    </div>
  )
}
