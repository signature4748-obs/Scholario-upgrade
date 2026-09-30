'use client'

// ============================================================
// STUDENT MESSAGING STORE — student ↔ teacher direct messages
// ------------------------------------------------------------
// 7-b (Mock Data Elimination): the two seeded demo conversations
// (fabricated teacher threads) are RETIRED. The store starts EMPTY —
// the module shows its honest "No conversations yet" state until the
// student actually starts a thread. The persist version was bumped
// (v1 → v2) with a purge migration so previously seeded threads are
// discarded on upgrade.
//
// Conversations are restricted to the student's OWN class teacher
// and subject teachers (the recipient picker derives that list from
// the students-store class record — never a school-wide directory).
//
// Unread is DERIVED honestly: a conversation is unread while its
// LAST message is from a teacher AND the student has not opened the
// thread since (seenAt). No fabricated teacher auto-replies — the
// teacher side of a thread only grows through real writes.
//
// Tenant-scoped persistence (SaaS-STAGE-2A): the storage adapter
// namespaces by active tenant, same pattern as every other store.
// ============================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createTenantScopedStorage } from '@/lib/tenant/tenant-storage'

// ─── Entities ────────────────────────────────────────────────────────

export interface StudentMessage {
  id: string
  from: 'student' | 'teacher'
  body: string
  sentOn: string
}

export interface StudentConversation {
  id: string
  teacherId: string
  teacherName: string
  /** Subject the teacher teaches (e.g. 'Mathematics'). */
  teacherSubject: string
  /** Thread subject line (e.g. 'Maths homework — Unit 3'). */
  subject: string
  messages: StudentMessage[]
  lastOn: string
}

export interface StartConversationInput {
  teacherId: string
  teacherName: string
  teacherSubject: string
  subject: string
  body: string
}

interface StudentMessagingState {
  conversations: StudentConversation[]
  /** conversationId → ISO time the student last opened the thread. */
  seenAt: Record<string, string>
  sendMessage: (conversationId: string, body: string) => { ok: boolean; error?: string }
  startConversation: (input: StartConversationInput) => { ok: true; conversation: StudentConversation } | { ok: false; error: string }
  markConversationSeen: (conversationId: string) => void
  markAllRead: () => void
}

// ─── Seed ────────────────────────────────────────────────────────────
// RETIRED (7-b): seedConversations() is gone — initial state is EMPTY.

const nowIso = () => new Date().toISOString()
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// ─── Unread derivation (single source of truth) ─────────────────────

/**
 * A conversation is unread while its LAST message is from a teacher and
 * the student has not opened the thread since that message arrived.
 */
export function isConversationUnread(conversation: StudentConversation, seenAt: Record<string, string>): boolean {
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last || last.from !== 'teacher') return false
  const seen = seenAt[conversation.id]
  if (!seen) return true
  return new Date(conversation.lastOn).getTime() > new Date(seen).getTime()
}

export function countUnreadConversations(conversations: StudentConversation[], seenAt: Record<string, string>): number {
  return conversations.filter((c) => isConversationUnread(c, seenAt)).length
}

// ─── Store ───────────────────────────────────────────────────────────

export const useStudentMessagingStore = create<StudentMessagingState>()(
  persist(
    (set, get) => ({
      conversations: [],
      seenAt: {},

      sendMessage: (conversationId, body) => {
        const text = body.trim()
        if (!text) return { ok: false, error: 'Message cannot be empty.' }
        const conversation = get().conversations.find((c) => c.id === conversationId)
        if (!conversation) return { ok: false, error: 'Conversation not found.' }
        const message: StudentMessage = {
          id: newId('SM'),
          from: 'student',
          body: text,
          sentOn: nowIso(),
        }
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: [...c.messages, message], lastOn: message.sentOn }
              : c,
          ),
        }))
        return { ok: true }
      },

      startConversation: ({ teacherId, teacherName, teacherSubject, subject, body }) => {
        const text = body.trim()
        const subjectLine = subject.trim()
        if (!teacherId || !subjectLine || !text) {
          return { ok: false, error: 'Recipient, subject and message are all required.' }
        }
        const message: StudentMessage = {
          id: newId('SM'),
          from: 'student',
          body: text,
          sentOn: nowIso(),
        }
        const conversation: StudentConversation = {
          id: newId('SC'),
          teacherId,
          teacherName,
          teacherSubject,
          subject: subjectLine,
          messages: [message],
          lastOn: message.sentOn,
        }
        set((s) => ({ conversations: [conversation, ...s.conversations] }))
        return { ok: true, conversation }
      },

      markConversationSeen: (conversationId) => {
        set((s) => {
          const prev = s.seenAt[conversationId]
          const stamp = nowIso()
          if (prev && new Date(prev).getTime() >= new Date(stamp).getTime()) return s
          return { seenAt: { ...s.seenAt, [conversationId]: stamp } }
        })
      },

      markAllRead: () => {
        // Flips the seen flag for every conversation — unread is derived
        // (last message from teacher + not seen since), so marking every
        // thread seen is the honest "mark all read".
        set((s) => {
          const stamp = nowIso()
          const seenAt: Record<string, string> = { ...s.seenAt }
          for (const c of s.conversations) seenAt[c.id] = stamp
          return { seenAt }
        })
      },
    }),
    {
      // Same key as the retired seeded store — persisted browsers holding
      // the demo threads (persisted version 1) are PURGED in place by the
      // v2 migration below (the 7-a same-key + version-bump pattern); a
      // renamed key would orphan the stale threads instead of clearing them.
      name: 'scholario-student-messages-v1',
      storage: createTenantScopedStorage('scholario-student-messages-v1'),
      version: 2,
      // 7-b — purge the retired demo threads (and their seen stamps) on
      // upgrade; the store re-seeds nothing and stays honestly empty.
      migrate: () => ({ conversations: [], seenAt: {} }),
      partialize: (s) => ({
        conversations: s.conversations,
        seenAt: s.seenAt,
      }),
    },
  ),
)
