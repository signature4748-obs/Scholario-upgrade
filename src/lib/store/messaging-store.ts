'use client'

/**
 * Messaging store — the principal's Messages & Inbox, server-canonical.
 *
 * Task 8B-7-d: conversations now live in the SHARED Message table (the
 * same engine the teacher Communication Hub and the student messaging
 * store read), served by /api/messaging/*:
 *
 *   · GET  /api/messaging/threads        — the thread list (+ exact unread,
 *                                          viewer thread state)
 *   · GET  /api/messaging/threads/[id]   — full thread (marks it read)
 *   · POST /api/messaging/threads/[id]   — send a message
 *
 * RETIRED with this task (fabrications, all of them):
 *   · the seeded demo conversations / messages / drafts / groups
 *   · the fake auto-reply timers ("Thank you, Ma'am…")
 *   · the simulated "delivered" tick that nothing ever delivered
 *   · the mock-teachers recipient universe and localStorage persistence
 * A tenant with no Message rows gets the honest "No conversations yet"
 * state — every thread rendered here is a row someone actually sent.
 *
 * Recipients come from /api/contacts (the real same-school directory).
 * Groups remain a LOCAL organizational affordance (member rosters from
 * the real teacher/student stores); sending to a group fans out REAL
 * direct messages to every member with a messaging account — nothing is
 * simulated.
 *
 * Refresh triggers (messaging-sync.ts): window focus, the
 * 'scholario:realtime-message' window event, and a 60s poll while a
 * thread is open on a visible tab.
 *
 * Session-scoped view flags: star / archive / urgent / mark-unread are
 * per-session toggles on top of server truth (the server's
 * DirectThreadState pin/archive flags hydrate them initially — the
 * teacher hub owns the write path). Drafts stay session-local by
 * design: a draft is a composing affordance, never a message.
 */

import { create } from 'zustand'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { attachMessagingAutoRefresh, purgeLegacyMessagingStorage } from '@/lib/store/messaging-sync'
import type {
  DirectMessageCreated,
  DirectThreadDetail,
  DirectThreadSummary,
  DirectThreadsPayload,
} from '@/lib/messaging/types'

// ─── Types ───────────────────────────────────────────────────────────

export type ConversationType = 'staff' | 'parent' | 'student' | 'group'
export type Folder = 'inbox' | 'starred' | 'sent' | 'groups' | 'drafts' | 'archive'
export type Label = 'Staff' | 'Parents' | 'Groups' | 'Urgent'
export type MessageStatus = 'sent'

export type GroupType =
  | 'Class Group'
  | 'Teachers Group'
  | 'Staff Group'
  | 'Department Group'
  | 'Parents Group'
  | 'Custom Group'

export const GROUP_TYPE_LIST: GroupType[] = [
  'Class Group',
  'Teachers Group',
  'Staff Group',
  'Department Group',
  'Parents Group',
  'Custom Group',
]

export interface Message {
  id: string
  conversationId: string
  sender: 'me' | 'them'
  senderName?: string // for group messages
  text: string
  timestamp: string // ISO string
  /** 'sent' once the server persisted it — no simulated delivery. */
  status?: MessageStatus
}

export interface Conversation {
  /** For server threads: the counterpart USER id. For groups: local. */
  id: string
  name: string
  avatar: string
  role: string
  type: ConversationType
  lastMessage: string
  lastTimestamp: string // ISO string
  /** True when the newest message was sent by the viewer (server truth). */
  lastFromMe: boolean
  unread: number
  starred: boolean
  archived: boolean
  urgent: boolean
  // For parent conversations — linked student
  studentName?: string
  studentClass?: string
  // For group conversations
  memberCount?: number
  groupId?: string // links to a Group entry when created via Create Group
  // For staff — linked teacher (Teacher row id, best-effort at sync)
  teacherId?: string
}

export interface Draft {
  id: string
  conversationId?: string // if replying to existing
  recipientName?: string // if composing new
  text: string
  timestamp: string
}

/**
 * Group — a managed chat group with structured membership (LOCAL — a
 * composing affordance; sending fans out real direct messages).
 *
 * `memberRefs` is an array of stable references:
 *   - `t:<teacher row id>` → teacher from the real roster store
 *   - `p:<student id>` → parent of a student (resolved from the record)
 */
export interface Group {
  id: string
  name: string
  type: GroupType
  memberRefs: string[]
  conversationId: string
  createdAt: string
}

// ─── Directory (compose recipients — /api/contacts) ──────────────────

export interface DirectoryUser {
  id: string
  name: string | null
  email: string | null
  role: string
  phone: string | null
}

// ─── Member ref helpers (rosters are the REAL stores) ───────────────

export type MemberType = 'teacher' | 'parent'

export interface MemberDisplay {
  ref: string
  type: MemberType
  name: string
  avatar: string
  role: string
}

const STAFF_ROLE_LABELS: Record<string, string> = {
  PRINCIPAL: 'Principal',
  MANAGEMENT: 'Management',
  COORDINATOR: 'Coordinator',
  ACCOUNTANT: 'Accounts',
  DRIVER: 'Transport',
}

function roleLabel(role: string): string {
  if (!role) return 'Staff'
  if (STAFF_ROLE_LABELS[role]) return STAFF_ROLE_LABELS[role]
  if (role === 'TEACHER') return 'Teacher'
  if (role === 'PARENT') return 'Parent'
  if (role === 'STUDENT') return 'Student'
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()
}

function conversationTypeOfRole(role: string): ConversationType {
  if (role === 'STUDENT') return 'student'
  if (role === 'PARENT') return 'parent'
  return 'staff'
}

/** Resolve a single member ref into a display object. Returns null if not found. */
export function resolveMemberRef(ref: string): MemberDisplay | null {
  if (ref.startsWith('t:')) {
    const id = ref.slice(2)
    const t = useTeachersStore.getState().teachers.find((x) => x.id === id)
    if (!t || t.status !== 'Active') return null
    return {
      ref,
      type: 'teacher',
      name: t.name,
      avatar: t.avatar,
      role: [t.designation || 'Teacher', t.department].filter(Boolean).join(' · '),
    }
  }
  if (ref.startsWith('p:')) {
    const sid = ref.slice(2)
    const s = useStudentsStore.getState().students.find((x) => x.id === sid)
    if (!s || s.status !== 'Active') return null
    const avatar = s.fatherName.split(' ').map((n) => n[0]).slice(0, 2).join('') || 'P'
    return {
      ref,
      type: 'parent',
      name: s.fatherName,
      avatar,
      role: `Parent · ${s.name} (${s.className}-${s.section})`,
    }
  }
  return null
}

/** Resolve a list of member refs into display objects (skips missing). */
export function resolveMemberRefs(refs: string[]): MemberDisplay[] {
  return refs.map(resolveMemberRef).filter((x): x is MemberDisplay => x !== null)
}

/**
 * Member refs → real USER ids (the fan-out targets for a group send).
 * Only members with a messaging account resolve — guardians whose
 * parent account is not provisioned are counted as skipped, never
 * fabricated.
 */
function memberRefUserIds(refs: string[]): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    if (!ref.startsWith('t:')) continue
    const t = useTeachersStore.getState().teachers.find((x) => x.id === ref.slice(2))
    if (t?.serverUserId) ids.push(t.serverUserId)
  }
  return ids
}

/** All parents (as refs) of active students in a given class+section. */
export function getParentsOfClassSection(className: string, section: string): string[] {
  return useStudentsStore
    .getState()
    .students.filter((s) => s.status === 'Active' && s.className === className && s.section === section)
    .map((s) => `p:${s.id}`)
}

/** All teachers (as refs) whose classes array includes a given class name. */
export function getTeachersOfClass(className: string): string[] {
  return useTeachersStore
    .getState()
    .teachers.filter((t) => t.status === 'Active' && t.classes.includes(className))
    .map((t) => `t:${t.id}`)
}

/** All teachers (as refs) in a given department. */
export function getTeachersOfDepartment(department: string): string[] {
  return useTeachersStore
    .getState()
    .teachers.filter((t) => t.status === 'Active' && t.department === department)
    .map((t) => `t:${t.id}`)
}

/** All active teachers (as refs) — used by Staff Group default. */
export function getAllStaffRefs(): string[] {
  return useTeachersStore
    .getState()
    .teachers.filter((t) => t.status === 'Active')
    .map((t) => `t:${t.id}`)
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'yesterday'
  if (day < 7) return `${day} days ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

/** Compact relative time for conversation rows: now · 5m · 3h · Yesterday · Tue · 12 Aug */
function formatListTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24 && d.toDateString() === now.toDateString()) return `${hr}h`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (diff < 7 * 24 * 3600 * 1000) return d.toLocaleDateString('en-IN', { weekday: 'short' })
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

/** Day label for chat date dividers: Today · Yesterday · Tuesday · 12 Aug 2025 */
function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-IN', {
    weekday: diff7(d, now) ? 'long' : undefined,
    day: '2-digit',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  })
}

function diff7(a: Date, b: Date): boolean {
  return Math.abs(b.getTime() - a.getTime()) < 7 * 24 * 3600 * 1000
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function avatarFromName(name: string): string {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'G'
}

// ─── Server mapping ──────────────────────────────────────────────────

/** Guarded envelope-unwrap (Phase-1 { ok, data } contract). */
async function apiData<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  if (!res.ok || !json || json.ok !== true) {
    throw new Error(json?.error ?? `Request failed (${res.status})`)
  }
  return json.data as T
}

function threadToConversation(t: DirectThreadSummary): Conversation {
  const type = conversationTypeOfRole(t.counterpart.role)
  const counterpartId = t.counterpartId
  // Best-effort Teacher-row link so the contact sheet can resolve staff
  // details once the faculty roster has synced (roster is hydrated by
  // the principal panel mount; both orders are handled).
  const teacherId =
    type === 'staff'
      ? useTeachersStore.getState().teachers.find((x) => x.serverUserId === counterpartId)?.id
      : undefined
  return {
    id: counterpartId,
    name: t.counterpart.name,
    avatar: avatarFromName(t.counterpart.name),
    role: roleLabel(t.counterpart.role),
    type,
    lastMessage: t.lastMessage?.body ?? '',
    lastTimestamp: t.lastMessage?.createdAt ?? new Date(0).toISOString(),
    lastFromMe: t.lastMessage?.fromMe ?? false,
    unread: t.unreadCount,
    starred: t.threadState.pinned,
    archived: t.threadState.archived,
    urgent: false, // no server source — never fabricated
    teacherId,
  }
}

function serverMessageToConversationMessage(
  m: { id: string; senderId: string; body: string; createdAt: string },
  conversationId: string,
): Message {
  return {
    id: m.id,
    conversationId,
    // A direct thread has exactly two participants: the message is
    // theirs iff its sender IS the counterpart.
    sender: m.senderId === conversationId ? 'them' : 'me',
    text: m.body,
    timestamp: m.createdAt,
  }
}

/** POST one direct message — returns the created server row. */
async function postDirectMessage(counterpartId: string, text: string): Promise<DirectMessageCreated['message']> {
  const res = await fetch(`/api/messaging/threads/${counterpartId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ body: text }),
  })
  const data = await apiData<DirectMessageCreated>(res)
  return data.message
}

// ─── Zustand Store ───────────────────────────────────────────────────

export interface SendResult {
  ok: boolean
  error?: string
  /** Group fan-out: real rows persisted / unresolvable members skipped. */
  delivered?: number
  skipped?: number
}

interface MessagingState {
  conversations: Conversation[]
  messages: Record<string, Message[]>
  drafts: Draft[]
  groups: Group[]
  /** Same-school user directory (compose recipients, /api/contacts). */
  directory: DirectoryUser[]
  activeConversationId: string | null
  activeFolder: Folder
  activeLabel: Label | null
  searchQuery: string
  /** Server hydration status (Phase-7 sync pattern). */
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error'
  error: string | null

  // actions
  setActiveFolder: (folder: Folder) => void
  setActiveLabel: (label: Label | null) => void
  setSearchQuery: (query: string) => void
  openConversation: (id: string) => void
  sendMessage: (conversationId: string, text: string) => Promise<SendResult>
  starConversation: (id: string) => void
  archiveConversation: (id: string) => void
  unarchiveConversation: (id: string) => void
  markUrgent: (id: string) => void
  markUnread: (id: string) => void
  saveDraft: (conversationId: string, text: string) => void
  saveNewDraft: (recipientName: string, text: string) => void
  deleteDraft: (id: string) => void
  sendDraft: (id: string) => Promise<SendResult>
  composeNew: (recipientName: string, text: string) => Promise<SendResult>
  /** Re-fetch the thread list (server truth) + reload the open thread. */
  refresh: () => Promise<boolean>

  // group actions
  createGroup: (input: { name: string; type: GroupType; memberRefs: string[] }) => string
  addMember: (groupId: string, memberRef: string) => { success: boolean; error?: string }
  removeMember: (groupId: string, memberRef: string) => void
  renameGroup: (groupId: string, name: string) => void
  deleteGroup: (groupId: string) => void

  // selectors
  getFilteredConversations: () => Conversation[]
  getUnreadCount: () => number
  getGroupById: (id: string) => Group | undefined
  getGroupByConversationId: (conversationId: string) => Group | undefined
}

let inflightRefresh: Promise<boolean> | null = null

export const useMessagingStore = create<MessagingState>()((set, get) => ({
  conversations: [],
  messages: {},
  drafts: [],
  groups: [],
  directory: [],
  activeConversationId: null,
  activeFolder: 'inbox',
  activeLabel: null,
  searchQuery: '',
  syncStatus: 'idle',
  error: null,

  setActiveFolder: (folder) => set({ activeFolder: folder, activeLabel: null }),
  setActiveLabel: (label) => set({ activeLabel: label }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  openConversation: (id) => {
    set((s) => ({
      activeConversationId: id,
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    }))
    const convo = get().conversations.find((c) => c.id === id)
    // Server threads fetch their history (the GET also marks the thread
    // read server-side); group conversations hold local history only.
    if (convo && convo.type !== 'group') {
      void loadThreadMessages(id)
    }
  },

  sendMessage: async (conversationId, text) => {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'Write a message first.' }
    const convo = get().conversations.find((c) => c.id === conversationId)
    if (!convo) return { ok: false, error: 'Conversation not found.' }

    // Optimistic bubble — replaced by the server row (or rolled back).
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      sender: 'me',
      text: trimmed,
      timestamp: new Date().toISOString(),
    }
    set((s) => ({
      messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] ?? []), optimistic] },
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: trimmed, lastTimestamp: optimistic.timestamp, lastFromMe: true }
          : c,
      ),
    }))

    // Roll the optimistic write back to the conversation's previous tail.
    const rollBack = () =>
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).filter((m) => m.id !== optimistic.id),
        },
        conversations: s.conversations.map((c) => (c.id === conversationId ? { ...convo } : c)),
      }))

    if (convo.type === 'group') {
      // Fan-out: one REAL direct message per member with a messaging
      // account. Members without accounts (unprovisioned guardians)
      // are skipped — never simulated.
      const group = get().groups.find((g) => g.conversationId === conversationId)
      const targets = group ? memberRefUserIds(group.memberRefs) : []
      const skipped = (group?.memberRefs.length ?? 0) - targets.length
      if (targets.length === 0) {
        rollBack()
        return {
          ok: false,
          error: 'No members of this group have messaging accounts yet.',
          delivered: 0,
          skipped,
        }
      }
      const results = await Promise.allSettled(targets.map((uid) => postDirectMessage(uid, trimmed)))
      const delivered = results.filter((r) => r.status === 'fulfilled').length
      if (delivered === 0) {
        rollBack()
        return {
          ok: false,
          error: 'Message could not be delivered — please try again.',
          delivered: 0,
          skipped,
        }
      }
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).map((m) =>
            m.id === optimistic.id ? { ...m, status: 'sent' as const } : m,
          ),
        },
      }))
      return { ok: true, delivered, skipped }
    }

    // Direct thread — the server row IS the truth.
    try {
      const created = await postDirectMessage(conversationId, trimmed)
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).map((m) =>
            m.id === optimistic.id
              ? {
                  id: created.id,
                  conversationId,
                  sender: 'me' as const,
                  text: created.body,
                  timestamp: created.createdAt,
                  status: 'sent' as const,
                }
              : m,
          ),
        },
        conversations: s.conversations.map((c) =>
          c.id === conversationId
            ? { ...c, lastMessage: created.body, lastTimestamp: created.createdAt, lastFromMe: true }
            : c,
        ),
      }))
      return { ok: true, delivered: 1, skipped: 0 }
    } catch (e) {
      rollBack()
      return {
        ok: false,
        error: e instanceof Error && e.message ? e.message : 'Message could not be delivered.',
      }
    }
  },

  starConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c)),
    })
  },

  archiveConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, archived: true, starred: false } : c)),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })
  },

  unarchiveConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, archived: false } : c)),
    })
  },

  markUrgent: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, urgent: !c.urgent } : c)),
    })
  },

  markUnread: (id) => {
    // Session-scoped view flag on real rows (there is no server write
    // path from this surface yet — the thread re-reads as read).
    const state = get()
    set({
      conversations: state.conversations.map((c) => (c.id === id && c.unread === 0 ? { ...c, unread: 1 } : c)),
    })
  },

  saveDraft: (conversationId, text) => {
    const state = get()
    if (!text.trim()) return
    const filteredDrafts = state.drafts.filter((d) => d.conversationId !== conversationId)
    set({
      drafts: [
        ...filteredDrafts,
        {
          id: `D${Date.now()}`,
          conversationId,
          text: text.trim(),
          timestamp: new Date().toISOString(),
        },
      ],
    })
  },

  saveNewDraft: (recipientName, text) => {
    const state = get()
    if (!text.trim()) return
    set({
      drafts: [
        ...state.drafts,
        {
          id: `D${Date.now()}`,
          recipientName,
          text: text.trim(),
          timestamp: new Date().toISOString(),
        },
      ],
    })
  },

  deleteDraft: (id) => {
    const state = get()
    set({ drafts: state.drafts.filter((d) => d.id !== id) })
  },

  sendDraft: async (id) => {
    const draft = get().drafts.find((d) => d.id === id)
    if (!draft) return { ok: false, error: 'Draft not found.' }
    const result = draft.conversationId
      ? await get().sendMessage(draft.conversationId, draft.text)
      : draft.recipientName
        ? await get().composeNew(draft.recipientName, draft.text)
        : { ok: false, error: 'Draft has no recipient.' }
    // The draft is consumed only when the message really went out.
    if (result.ok) set({ drafts: get().drafts.filter((d) => d.id !== id) })
    return result
  },

  composeNew: async (recipientName, text) => {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'Write a message first.' }
    const name = recipientName.trim()
    if (!name) return { ok: false, error: 'Select a recipient first.' }

    // Group send — fan out through the group's conversation.
    const group = get().groups.find((g) => g.name.toLowerCase() === name.toLowerCase())
    if (group) {
      const result = await get().sendMessage(group.conversationId, trimmed)
      if (result.ok) set({ activeFolder: 'groups', activeConversationId: group.conversationId })
      return result
    }

    // Directory contact — a real account in this school.
    const contact = get().directory.find((c) => (c.name ?? '').toLowerCase() === name.toLowerCase())
    if (!contact) {
      return {
        ok: false,
        error: `No account found for “${name}” — pick a recipient from the directory.`,
      }
    }

    const existing = get().conversations.find((c) => c.id === contact.id)
    if (existing) {
      const result = await get().sendMessage(existing.id, trimmed)
      if (result.ok) {
        set({
          activeFolder: existing.archived ? 'archive' : 'inbox',
          activeConversationId: existing.id,
        })
      }
      return result
    }

    // Brand-new thread — the server row creates it.
    try {
      const created = await postDirectMessage(contact.id, trimmed)
      mergeDirectMessage(created, contact)
      set({ activeFolder: 'inbox', activeConversationId: contact.id })
      return { ok: true, delivered: 1, skipped: 0 }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error && e.message ? e.message : 'Message could not be delivered.',
      }
    }
  },

  refresh: async () => {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      try {
        const res = await fetch('/api/messaging/threads', { cache: 'no-store', credentials: 'same-origin' })
        const data = await apiData<DirectThreadsPayload>(res)
        const prev = new Map(get().conversations.map((c) => [c.id, c]))
        const prevMessages = get().messages
        const conversations = data.threads.map((t) => {
          const fresh = threadToConversation(t)
          const old = prev.get(fresh.id)
          if (!old) return fresh
          // Session view flags (star / archive / urgent toggles) survive a
          // refresh — they have no write path yet, so local is freshest.
          // Keep loaded histories while nothing newer arrived.
          return {
            ...fresh,
            starred: old.starred,
            archived: old.archived,
            urgent: old.urgent,
          }
        })
        set({
          conversations,
          error: null,
          messages: prevMessages,
        })
        // The OPEN thread converges on server truth immediately (this
        // also re-marks it read and reloads its full history).
        const openId = get().activeConversationId
        const openConvo = openId ? conversations.find((c) => c.id === openId) : undefined
        if (openConvo && openConvo.type !== 'group') {
          await loadThreadMessages(openId as string)
        }
        return true
      } catch {
        // Failed fetch keeps the current content — never fabricates.
        set({ error: 'Could not load your messages — showing what you already have.' })
        return false
      } finally {
        inflightRefresh = null
      }
    })()
    return inflightRefresh
  },

  // ─── Group actions ─────────────────────────────────────────────────

  createGroup: ({ name, type, memberRefs }) => {
    const state = get()
    const trimmed = name.trim()
    const groupId = `G${Date.now()}`
    const conversationId = `C${Date.now() + 1}`
    const uniqueMembers = Array.from(new Set(memberRefs))
    const memberCount = uniqueMembers.length

    const newConvo: Conversation = {
      id: conversationId,
      name: trimmed,
      avatar: avatarFromName(trimmed),
      role: `Group · ${memberCount} member${memberCount === 1 ? '' : 's'}`,
      type: 'group',
      lastMessage: `Group created · ${memberCount} member${memberCount === 1 ? '' : 's'}`,
      lastTimestamp: new Date().toISOString(),
      lastFromMe: true,
      unread: 0,
      starred: false,
      archived: false,
      urgent: false,
      memberCount,
      groupId,
    }

    const seedMsg: Message = {
      id: `M${Date.now() + 2}`,
      conversationId,
      sender: 'me',
      text: `Group "${trimmed}" created with ${memberCount} member${memberCount === 1 ? '' : 's'}.`,
      timestamp: new Date().toISOString(),
      status: 'sent',
    }

    const newGroup: Group = {
      id: groupId,
      name: trimmed,
      type,
      memberRefs: uniqueMembers,
      conversationId,
      createdAt: new Date().toISOString(),
    }

    set({
      groups: [newGroup, ...state.groups],
      conversations: [newConvo, ...state.conversations],
      messages: { ...state.messages, [conversationId]: [seedMsg] },
      activeFolder: 'groups',
      activeConversationId: conversationId,
    })

    return groupId
  },

  addMember: (groupId, memberRef) => {
    const state = get()
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return { success: false, error: 'Group not found' }
    if (group.memberRefs.includes(memberRef)) {
      return { success: false, error: 'Already a member' }
    }
    const nextRefs = [...group.memberRefs, memberRef]
    set({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, memberRefs: nextRefs } : g)),
      conversations: state.conversations.map((c) =>
        c.id === group.conversationId
          ? { ...c, memberCount: nextRefs.length, role: `Group · ${nextRefs.length} member${nextRefs.length === 1 ? '' : 's'}` }
          : c,
      ),
    })
    return { success: true }
  },

  removeMember: (groupId, memberRef) => {
    const state = get()
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return
    const nextRefs = group.memberRefs.filter((r) => r !== memberRef)
    set({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, memberRefs: nextRefs } : g)),
      conversations: state.conversations.map((c) =>
        c.id === group.conversationId
          ? { ...c, memberCount: nextRefs.length, role: `Group · ${nextRefs.length} member${nextRefs.length === 1 ? '' : 's'}` }
          : c,
      ),
    })
  },

  renameGroup: (groupId, name) => {
    const state = get()
    const trimmed = name.trim()
    if (!trimmed) return
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return
    set({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
      conversations: state.conversations.map((c) =>
        c.id === group.conversationId ? { ...c, name: trimmed, avatar: avatarFromName(trimmed) } : c,
      ),
    })
  },

  deleteGroup: (groupId) => {
    const state = get()
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return
    const nextMessages = { ...state.messages }
    delete nextMessages[group.conversationId]
    set({
      groups: state.groups.filter((g) => g.id !== groupId),
      conversations: state.conversations.filter((c) => c.id !== group.conversationId),
      activeConversationId: state.activeConversationId === group.conversationId ? null : state.activeConversationId,
      drafts: state.drafts.filter((d) => d.conversationId !== group.conversationId),
      messages: nextMessages,
    })
  },

  getFilteredConversations: () => {
    const state = get()
    let result = state.conversations

    // Folder filter
    switch (state.activeFolder) {
      case 'inbox':
        result = result.filter((c) => !c.archived)
        break
      case 'starred':
        result = result.filter((c) => c.starred && !c.archived)
        break
      case 'sent':
        // Server truth: the thread's newest message is mine.
        result = result.filter((c) => c.lastFromMe && !c.archived)
        break
      case 'groups':
        result = result.filter((c) => c.type === 'group' && !c.archived)
        break
      case 'drafts':
        const draftConvIds = new Set(state.drafts.filter((d) => d.conversationId).map((d) => d.conversationId!))
        result = result.filter((c) => draftConvIds.has(c.id) && !c.archived)
        break
      case 'archive':
        result = result.filter((c) => c.archived)
        break
    }

    // Label filter
    if (state.activeLabel) {
      switch (state.activeLabel) {
        case 'Staff': result = result.filter((c) => c.type === 'staff'); break
        case 'Parents': result = result.filter((c) => c.type === 'parent'); break
        case 'Groups': result = result.filter((c) => c.type === 'group'); break
        case 'Urgent': result = result.filter((c) => c.urgent); break
      }
    }

    // Search filter (names, previews, and the loaded message content)
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase()
      result = result.filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true
        if (c.lastMessage.toLowerCase().includes(q)) return true
        const msgs = state.messages[c.id] ?? []
        return msgs.some((m) => m.text.toLowerCase().includes(q))
      })
    }

    // Sort: starred first, then by latest activity
    return result.sort((a, b) => {
      if (a.starred && !b.starred) return -1
      if (!a.starred && b.starred) return 1
      return new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
    })
  },

  getUnreadCount: () => {
    return get().conversations.filter((c) => !c.archived).reduce((sum, c) => sum + c.unread, 0)
  },

  getGroupById: (id) => get().groups.find((g) => g.id === id),

  getGroupByConversationId: (conversationId) =>
    get().groups.find((g) => g.conversationId === conversationId),
}))

// ─── Server loading (module-local, uses the store) ───────────────────

/** Fetch one thread's full history; the GET marks it read server-side. */
async function loadThreadMessages(conversationId: string): Promise<void> {
  try {
    const res = await fetch(`/api/messaging/threads/${conversationId}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const data = await apiData<DirectThreadDetail>(res)
    const messages = data.messages.map((m) => serverMessageToConversationMessage(m, conversationId))
    useMessagingStore.setState((s) => ({
      messages: { ...s.messages, [conversationId]: messages },
      conversations: upsertThreadConversation(s.conversations, data, messages),
    }))
  } catch {
    // Keep whatever is loaded — the list refresh surfaces errors.
  }
}

function upsertThreadConversation(
  conversations: Conversation[],
  data: DirectThreadDetail,
  messages: Message[],
): Conversation[] {
  const last = messages[messages.length - 1]
  const existing = conversations.find((c) => c.id === data.counterpart.id)
  const type = conversationTypeOfRole(data.counterpart.role)
  const teacherId =
    type === 'staff'
      ? useTeachersStore.getState().teachers.find((x) => x.serverUserId === data.counterpart.id)?.id
      : undefined
  const fresh: Conversation = existing
    ? {
        ...existing,
        name: data.counterpart.name,
        role: roleLabel(data.counterpart.role),
        teacherId: existing.teacherId ?? teacherId,
        unread: 0, // GET marked the thread read server-side
        ...(last
          ? { lastMessage: last.text, lastTimestamp: last.timestamp, lastFromMe: last.sender === 'me' }
          : {}),
      }
    : {
        id: data.counterpart.id,
        name: data.counterpart.name,
        avatar: avatarFromName(data.counterpart.name),
        role: roleLabel(data.counterpart.role),
        type,
        lastMessage: last?.text ?? '',
        lastTimestamp: last?.timestamp ?? new Date(0).toISOString(),
        lastFromMe: last ? last.sender === 'me' : false,
        unread: 0,
        starred: data.threadState.pinned,
        archived: data.threadState.archived,
        urgent: false,
        teacherId,
      }
  return existing
    ? conversations.map((c) => (c.id === data.counterpart.id ? fresh : c))
    : [fresh, ...conversations]
}

/** Merge a freshly created server row into the store (new or existing). */
function mergeDirectMessage(
  created: DirectMessageCreated['message'],
  contact: { id: string; name: string | null; role: string },
): void {
  const message: Message = {
    id: created.id,
    conversationId: contact.id,
    sender: 'me',
    text: created.body,
    timestamp: created.createdAt,
    status: 'sent',
  }
  const type = conversationTypeOfRole(contact.role)
  useMessagingStore.setState((s) => {
    const existing = s.conversations.find((c) => c.id === contact.id)
    if (existing) {
      return {
        conversations: s.conversations.map((c) =>
          c.id === contact.id
            ? { ...c, lastMessage: created.body, lastTimestamp: created.createdAt, lastFromMe: true }
            : c,
        ),
        messages: { ...s.messages, [contact.id]: [...(s.messages[contact.id] ?? []), message] },
      }
    }
    const conversation: Conversation = {
      id: contact.id,
      name: contact.name ?? 'User',
      avatar: avatarFromName(contact.name ?? 'U'),
      role: roleLabel(contact.role),
      type,
      lastMessage: created.body,
      lastTimestamp: created.createdAt,
      lastFromMe: true,
      unread: 0,
      starred: false,
      archived: false,
      urgent: false,
    }
    return {
      conversations: [conversation, ...s.conversations],
      messages: { ...s.messages, [contact.id]: [message] },
    }
  })
}

// ─── Session sync (teachers-store pattern: once per session) ─────────

async function loadDirectory(): Promise<void> {
  const res = await fetch('/api/contacts', { cache: 'no-store', credentials: 'same-origin' })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: { users?: DirectoryUser[] } }
    | null
  if (!res.ok || !json || json.ok !== true) throw new Error('directory unavailable')
  useMessagingStore.setState({ directory: json.data?.users ?? [] })
}

let syncPromise: Promise<boolean> | null = null

/**
 * One-per-session server hydration: the thread list (server truth) plus
 * the same-school directory that powers the compose picker. Failures
 * flag `syncStatus: 'error'` — the store keeps whatever it has and the
 * UI can offer an honest retry. The auto-refresh listeners keep the
 * THREADS converging afterwards (no directory re-fetch).
 */
export function syncMessagingFromServer(): Promise<boolean> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    useMessagingStore.setState({ syncStatus: 'syncing' })
    try {
      const [threadsOk] = await Promise.all([useMessagingStore.getState().refresh(), loadDirectory()])
      useMessagingStore.setState({ syncStatus: threadsOk ? 'synced' : 'error' })
      return threadsOk
    } catch {
      useMessagingStore.setState({ syncStatus: 'error' })
      return false
    }
  })()
  return syncPromise
}

/** Reset the once-per-session guard (explicit retry / tests). */
export function resetMessagingSyncGuard(): void {
  syncPromise = null
}

// ─── Recipient options (for Compose) ────────────────────────────────

export interface RecipientOption {
  name: string
  role: string
  type: ConversationType
  avatar: string
  /** 8B-7-d — the recipient's USER id (null for local groups). */
  userId: string | null
}

export function getRecipientOptions(): RecipientOption[] {
  const { directory, groups } = useMessagingStore.getState()

  const staff: RecipientOption[] = []
  const parents: RecipientOption[] = []
  const students: RecipientOption[] = []
  for (const u of directory) {
    const name = u.name?.trim() || u.email?.split('@')[0] || 'User'
    const type = conversationTypeOfRole(u.role)
    const option: RecipientOption = {
      name,
      role: roleLabel(u.role),
      type,
      avatar: avatarFromName(name),
      userId: u.id,
    }
    if (type === 'parent') parents.push(option)
    else if (type === 'student') students.push(option)
    else staff.push(option)
  }

  // Groups — pulled from the live store so newly-created groups appear automatically
  const groupOptions: RecipientOption[] = groups.map((g) => ({
    name: g.name,
    role: `Group · ${g.memberRefs.length} member${g.memberRefs.length === 1 ? '' : 's'}`,
    type: 'group' as ConversationType,
    avatar: avatarFromName(g.name),
    userId: null,
  }))

  return [...staff, ...parents, ...students, ...groupOptions]
}

// ─── Group options (for the Groups panel + compose picker) ──────────

export interface GroupOption {
  id: string
  name: string
  type: GroupType
  memberCount: number
  conversationId: string
}

export function getGroupOptions(): GroupOption[] {
  return useMessagingStore.getState().groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    memberCount: g.memberRefs.length,
    conversationId: g.conversationId,
  }))
}

// ─── Format helpers ──────────────────────────────────────────────────

export { formatTimeAgo, formatMessageTime, formatListTime, formatDayLabel }

// ─── Session wiring ──────────────────────────────────────────────────

attachMessagingAutoRefresh({
  refresh: async () => {
    await useMessagingStore.getState().refresh()
  },
  hasOpenThread: () => useMessagingStore.getState().activeConversationId !== null,
})

// The retired localStorage persist key (base + tenant-scoped variants)
// is purged once — the fabricated demo corpus and every ghost thread
// from the pre-DB era must never reappear.
purgeLegacyMessagingStorage('scholario-messaging-v1')
