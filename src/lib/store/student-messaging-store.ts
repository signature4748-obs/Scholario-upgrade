'use client'

// ============================================================
// STUDENT MESSAGING STORE — server-canonical direct threads
// ------------------------------------------------------------
// Task 8B-7-d: the store is now DB-BACKED. Every thread between a
// student and their teachers is a row family in the shared Message
// table (the SAME engine the teacher Communication Hub reads) served
// by /api/messaging/*:
//
//   · GET  /api/messaging/threads            — the thread list
//   · GET  /api/messaging/threads/[id]       — full thread (marks read)
//   · POST /api/messaging/threads/[id]       — send a message
//
// A message a student sends here IS the Message row the teacher's hub
// shows, and the teacher's reply (via her existing direct route) lands
// in this thread — no more localStorage-only conversations invisible
// to the other side. NOTHING persists client-side: no localStorage,
// no seeds, no fabricated replies. The honest empty state is "no
// conversations yet" until a real thread exists.
//
// Unread stays DERIVED (last message from a teacher + not seen since
// the thread was opened) exactly as before, but thread metadata now
// also carries the server's exact unreadCount badge.
//
// Refresh triggers (wired once per session): window focus, the
// 'scholario:realtime-message' window event, and a 60s poll while a
// thread view is open and the tab is visible (messaging-sync.ts).
// ============================================================

import { create } from 'zustand'
import { attachMessagingAutoRefresh, purgeLegacyMessagingStorage } from '@/lib/store/messaging-sync'
import type {
  DirectMessageCreated,
  DirectThreadDetail,
  DirectThreadSummary,
  DirectThreadsPayload,
} from '@/lib/messaging/types'

// ─── Entities (shape-compatible with the previous local store) ──────

export interface StudentMessage {
  id: string
  from: 'student' | 'teacher'
  body: string
  sentOn: string
}

export interface StudentConversation {
  /** The counterpart (teacher) USER id — the server thread key. */
  id: string
  /** Same user id (legacy field name kept for existing consumers). */
  teacherId: string
  teacherName: string
  /** Honest label from the counterpart's role ('Teacher', 'Principal'…). */
  teacherSubject: string
  /** The thread family's stored subject (server constant). */
  subject: string
  /**
   * [last] preview until the thread is opened; the FULL history once
   * openThread loads it (the thread view renders from this array).
   */
  messages: StudentMessage[]
  lastOn: string
  /** Server-truth unread count (recipient=me ∧ sender=counterpart). */
  unreadCount: number
}

export interface StartConversationInput {
  /** Counterpart (teacher) USER id. */
  teacherId: string
  teacherName: string
  teacherSubject?: string
  body: string
}

/** The direct-message subject the server stores for every thread. */
const DIRECT_MESSAGE_SUBJECT = 'Direct message'

function roleLabel(role: string): string {
  if (!role) return 'Staff'
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()
}

function threadToConversation(t: DirectThreadSummary): StudentConversation {
  const last = t.lastMessage
  return {
    id: t.counterpartId,
    teacherId: t.counterpartId,
    teacherName: t.counterpart.name,
    teacherSubject: roleLabel(t.counterpart.role),
    subject: DIRECT_MESSAGE_SUBJECT,
    messages: last
      ? [
          {
            // Synthetic preview id — replaced by real ids on openThread.
            id: `${t.counterpartId}:preview`,
            from: last.fromMe ? 'student' : 'teacher',
            body: last.body,
            sentOn: last.createdAt,
          },
        ]
      : [],
    lastOn: last?.createdAt ?? new Date(0).toISOString(),
    unreadCount: t.unreadCount,
  }
}

function serverMessageToStudent(
  m: { id: string; senderId: string; body: string; createdAt: string },
  counterpartId: string,
): StudentMessage {
  return {
    id: m.id,
    // A direct thread has exactly two participants: the message is from
    // the teacher iff its sender IS the counterpart.
    from: m.senderId === counterpartId ? 'teacher' : 'student',
    body: m.body,
    sentOn: m.createdAt,
  }
}

// ─── Unread derivation (single source of truth, unchanged) ──────────

/**
 * A conversation is unread while its LAST message is from a teacher and
 * the student has not opened the thread since that message arrived.
 */
export function isConversationUnread(
  conversation: StudentConversation,
  seenAt: Record<string, string>,
): boolean {
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last || last.from !== 'teacher') return false
  const seen = seenAt[conversation.id]
  if (!seen) return true
  return new Date(conversation.lastOn).getTime() > new Date(seen).getTime()
}

export function countUnreadConversations(
  conversations: StudentConversation[],
  seenAt: Record<string, string>,
): number {
  return conversations.filter((c) => isConversationUnread(c, seenAt)).length
}

// ─── Store ───────────────────────────────────────────────────────────

interface StudentMessagingState {
  conversations: StudentConversation[]
  /** conversationId → ISO time the student last opened the thread. */
  seenAt: Record<string, string>
  /** Thread-list fetch in flight / last error (honest empty ≠ error). */
  loading: boolean
  error: string | null
  /** The currently open thread's counterpart id (gates the 60s poll). */
  openThreadId: string | null
  /** Re-fetch the thread list (+ reload the open thread). */
  refresh: () => Promise<void>
  /** Open one thread: full history + server-side read marking. */
  openThread: (counterpartId: string) => Promise<void>
  closeThread: () => void
  sendMessage: (conversationId: string, body: string) => Promise<{ ok: boolean; error?: string }>
  startConversation: (
    input: StartConversationInput,
  ) => Promise<{ ok: true; conversation: StudentConversation } | { ok: false; error: string }>
  /** Stamp one thread seen (local acknowledgement). */
  markConversationSeen: (conversationId: string) => void
  markAllRead: () => void
}

/** Guarded envelope-unwrap (Phase-1 { ok, data } contract). */
async function apiData<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  if (!res.ok || !json || json.ok !== true) {
    throw new Error(json?.error ?? `Request failed (${res.status})`)
  }
  return json.data as T
}

let inflightRefresh: Promise<void> | null = null

export const useStudentMessagingStore = create<StudentMessagingState>()((set, get) => ({
  conversations: [],
  seenAt: {},
  loading: false,
  error: null,
  openThreadId: null,

  refresh: async () => {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      set({ loading: true, error: null })
      try {
        const res = await fetch('/api/messaging/threads', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const data = await apiData<DirectThreadsPayload>(res)
        const prev = new Map(get().conversations.map((c) => [c.id, c]))
        const conversations = data.threads.map((t) => {
          const fresh = threadToConversation(t)
          const old = prev.get(fresh.id)
          // Keep the loaded FULL history while nothing newer arrived;
          // a newer last message drops back to the preview (the open
          // thread is reloaded in full below, others on open).
          if (old && old.messages.length > 1 && fresh.lastOn <= old.lastOn) {
            return { ...fresh, messages: old.messages }
          }
          return fresh
        })
        set({ conversations, loading: false, error: null })
        // The OPEN thread converges on server truth immediately.
        const openId = get().openThreadId
        if (openId) await loadThreadInto(openId)
      } catch {
        // Failed fetch keeps the current content — never fabricates.
        set({ loading: false, error: 'Could not load your messages. Retrying on refresh.' })
      } finally {
        inflightRefresh = null
      }
    })()
    return inflightRefresh
  },

  openThread: async (counterpartId) => {
    set({ openThreadId: counterpartId })
    await loadThreadInto(counterpartId)
  },

  closeThread: () => set({ openThreadId: null }),

  sendMessage: async (conversationId, body) => {
    const text = body.trim()
    if (!text) return { ok: false, error: 'Message cannot be empty.' }
    const conversation = get().conversations.find((c) => c.id === conversationId)
    if (!conversation) return { ok: false, error: 'Conversation not found.' }

    // Optimistic bubble — replaced by the server row (or rolled back).
    const optimistic: StudentMessage = {
      id: `optimistic-${Date.now()}`,
      from: 'student',
      body: text,
      sentOn: new Date().toISOString(),
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, optimistic], lastOn: optimistic.sentOn }
          : c,
      ),
    }))

    try {
      const res = await fetch(`/api/messaging/threads/${conversationId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body: text }),
      })
      const data = await apiData<DirectMessageCreated>(res)
      const created = data.message
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === optimistic.id
                    ? { id: created.id, from: 'student' as const, body: created.body, sentOn: created.createdAt }
                    : m,
                ),
                lastOn: created.createdAt,
              }
            : c,
        ),
      }))
      return { ok: true }
    } catch (e) {
      // Roll the optimistic bubble back — the thread shows only truth.
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.filter((m) => m.id !== optimistic.id),
                lastOn:
                  c.messages.length > 1 ? c.messages[c.messages.length - 2]?.sentOn ?? c.lastOn : c.lastOn,
              }
            : c,
        ),
      }))
      return {
        ok: false,
        error: e instanceof Error && e.message ? e.message : 'Could not send the message.',
      }
    }
  },

  startConversation: async ({ teacherId, teacherName, teacherSubject, body }) => {
    const text = body.trim()
    if (!teacherId || !text) {
      return { ok: false, error: 'Recipient and message are both required.' }
    }
    try {
      const res = await fetch(`/api/messaging/threads/${teacherId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body: text }),
      })
      const data = await apiData<DirectMessageCreated>(res)
      const created = data.message
      const message: StudentMessage = {
        id: created.id,
        from: 'student',
        body: created.body,
        sentOn: created.createdAt,
      }
      // The POST may target an EXISTING thread (server truth appends);
      // merge instead of duplicating.
      set((s) => {
        const existing = s.conversations.find((c) => c.id === teacherId)
        if (existing) {
          return {
            seenAt: { ...s.seenAt, [teacherId]: new Date().toISOString() },
            conversations: s.conversations.map((c) =>
              c.id === teacherId
                ? { ...c, messages: [...c.messages, message], lastOn: created.createdAt }
                : c,
            ),
          }
        }
        const conversation: StudentConversation = {
          id: teacherId,
          teacherId,
          teacherName: teacherName || 'Teacher',
          teacherSubject: teacherSubject ?? 'Teacher',
          subject: DIRECT_MESSAGE_SUBJECT,
          messages: [message],
          lastOn: created.createdAt,
          unreadCount: 0,
        }
        return {
          seenAt: { ...s.seenAt, [teacherId]: new Date().toISOString() },
          conversations: [conversation, ...s.conversations],
        }
      })
      const conversation = get().conversations.find((c) => c.id === teacherId)
      if (!conversation) throw new Error('Thread unavailable — refresh your messages.')
      return { ok: true, conversation }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error && e.message ? e.message : 'Could not send the message.',
      }
    }
  },

  markConversationSeen: (conversationId) => {
    set((s) => {
      const prev = s.seenAt[conversationId]
      const stamp = new Date().toISOString()
      if (prev && new Date(prev).getTime() >= new Date(stamp).getTime()) return s
      return { seenAt: { ...s.seenAt, [conversationId]: stamp } }
    })
  },

  markAllRead: () => {
    // The honest local "mark all read": stamp every current thread seen.
    // (Read state for the teacher side is server-truth via openThread.)
    set((s) => {
      const stamp = new Date().toISOString()
      const seenAt: Record<string, string> = { ...s.seenAt }
      for (const c of s.conversations) seenAt[c.id] = stamp
      return { seenAt }
    })
  },
}))

/** Fetch one thread's full history and merge it into the conversation. */
async function loadThreadInto(counterpartId: string): Promise<void> {
  try {
    const res = await fetch(`/api/messaging/threads/${counterpartId}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const data = await apiData<DirectThreadDetail>(res)
    const messages = data.messages.map((m) => serverMessageToStudent(m, counterpartId))
    const last = messages[messages.length - 1]
    const stamp = new Date().toISOString()
    set_mergeThread(counterpartId, data, messages, last?.sentOn ?? '', stamp)
  } catch {
    // Keep whatever is loaded — the list refresh surfaces errors.
  }
}

function set_mergeThread(
  counterpartId: string,
  data: DirectThreadDetail,
  messages: StudentMessage[],
  lastOn: string,
  stamp: string,
): void {
  useStudentMessagingStore.setState((s) => {
    const existing = s.conversations.find((c) => c.id === counterpartId)
    const conversation: StudentConversation = existing
      ? { ...existing, messages, lastOn: lastOn || existing.lastOn, unreadCount: 0 }
      : {
          id: counterpartId,
          teacherId: counterpartId,
          teacherName: data.counterpart.name,
          teacherSubject: roleLabel(data.counterpart.role),
          subject: DIRECT_MESSAGE_SUBJECT,
          messages,
          lastOn,
          unreadCount: 0,
        }
    return {
      // GET marks the thread read server-side; the badge follows here.
      conversations: existing
        ? s.conversations.map((c) => (c.id === counterpartId ? conversation : c))
        : [conversation, ...s.conversations],
      seenAt: { ...s.seenAt, [counterpartId]: stamp },
    }
  })
}

// ─── Session wiring (once per module lifetime) ───────────────────────

attachMessagingAutoRefresh({
  refresh: () => useStudentMessagingStore.getState().refresh(),
  hasOpenThread: () => useStudentMessagingStore.getState().openThreadId !== null,
})

// The retired localStorage persist key (base + tenant-scoped variants)
// is purged once — the store is server-canonical now, and ghost threads
// from the pre-DB era must never reappear.
purgeLegacyMessagingStorage('scholario-student-messages-v1')
