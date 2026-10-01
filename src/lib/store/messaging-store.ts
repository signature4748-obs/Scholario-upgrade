/**
 * Messaging store — Zustand store for the Messages & Inbox module.
 *
 * One connected messaging system:
 *   Conversations → Messages → Send/Reply → Star/Archive/Draft
 *   Groups → Group Members → Group Conversation → Send to Group
 *
 * Recipient data comes from canonical Teachers + Students (for parents).
 * No fake "online" status — we use role/department labels instead.
 * No fake "read receipts" or "typing" indicators.
 *
 * Folders: Inbox · Starred · Sent · Groups · Drafts · Archive
 * Labels: Staff · Parents · Groups · Urgent (all functional filters)
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: conversations, messages, drafts +
 * groups survive reload (per-school namespace via createTenantScopedStorage).
 * activeConversationId / folder / label / searchQuery are ephemeral UI state
 * and are NOT persisted. The simulated delivery/auto-reply timers live
 * inside the sendMessage action (runtime-only) — nothing non-serializable
 * ever enters state, so no sanitization is needed in partialize.
 *
 * State mutations:
 *   - sendMessage (creates/replies to conversation; group replies use a random member name)
 *   - markRead (clears unread on open)
 *   - starConversation / unstarConversation
 *   - archiveConversation / unarchiveConversation
 *   - saveDraft / deleteDraft / sendDraft
 *   - markUrgent
 *   - composeNew (recipient picker)
 *   - createGroup / addMember / removeMember (group management)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { teachers } from '@/lib/mock/teachers'
import { useStudentsStore } from '@/lib/store/students-store'
import { makeDemoSeedApplier, readIsDemoTenant } from '@/lib/store/demo-tenant'
import { migrateLegacyScopedStore, createTenantScopedStorage } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-messaging-v1', DEFAULT_TENANT_ID)

// ─── Types ───────────────────────────────────────────────────────────

export type ConversationType = 'staff' | 'parent' | 'group'
export type Folder = 'inbox' | 'starred' | 'sent' | 'groups' | 'drafts' | 'archive'
export type Label = 'Staff' | 'Parents' | 'Groups' | 'Urgent'
export type MessageStatus = 'sent' | 'delivered'

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
  status?: MessageStatus
}

export interface Conversation {
  id: string
  name: string
  avatar: string
  role: string // e.g. "Senior Teacher · Maths" or "Parent · Aarav Sharma" or "Group · 18 members"
  type: ConversationType
  lastMessage: string
  lastTimestamp: string // ISO string
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
  // For staff — linked teacher
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
 * Group — a managed chat group with structured membership.
 *
 * `memberRefs` is an array of stable references:
 *   - `t:T-014` → teacher by id
 *   - `p:STU-12` → parent of a student by student id (we resolve the father's name)
 *
 * A Group ALWAYS has a linked Conversation (same name) so the existing
 * message-thread UI works without changes — opening the group's conversation
 * shows the chat thread; the Group panel surfaces member management.
 */
export interface Group {
  id: string
  name: string
  type: GroupType
  memberRefs: string[]
  conversationId: string
  createdAt: string
}

// ─── Member ref helpers ─────────────────────────────────────────────

export type MemberType = 'teacher' | 'parent'

export interface MemberDisplay {
  ref: string
  type: MemberType
  name: string
  avatar: string
  role: string
}

/** Resolve a single member ref into a display object. Returns null if not found. */
export function resolveMemberRef(ref: string): MemberDisplay | null {
  if (ref.startsWith('t:')) {
    const id = ref.slice(2)
    const t = teachers.find((x) => x.id === id)
    if (!t || t.archived) return null
    return {
      ref,
      type: 'teacher',
      name: t.name,
      avatar: t.avatar,
      role: `${t.designation} · ${t.department}`,
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

/** All parents (as refs) of active students in a given class+section. */
export function getParentsOfClassSection(className: string, section: string): string[] {
  return useStudentsStore
    .getState()
    .students.filter((s) => s.status === 'Active' && s.className === className && s.section === section)
    .map((s) => `p:${s.id}`)
}

/** All teachers (as refs) whose classes array includes a given class name (e.g. "Class 10-A"). */
export function getTeachersOfClass(className: string): string[] {
  return teachers.filter((t) => !t.archived && t.classes.includes(className)).map((t) => `t:${t.id}`)
}

/** All teachers (as refs) in a given department. */
export function getTeachersOfDepartment(department: string): string[] {
  return teachers.filter((t) => !t.archived && t.department === department).map((t) => `t:${t.id}`)
}

/** All active teachers (as refs) — used by Staff Group default. */
export function getAllStaffRefs(): string[] {
  return teachers.filter((t) => !t.archived).map((t) => `t:${t.id}`)
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

// ─── Seed Conversations (connected to canonical data) ───────────────

const SEED_CONVERSATIONS: Conversation[] = [
  // Staff conversations — linked to real teachers
  { id: 'C01', name: 'Rohan Mehta', avatar: 'RM', role: 'Senior Teacher · Maths', type: 'staff', lastMessage: 'Submitted the Unit Test 3 marks, please review.', lastTimestamp: new Date(Date.now() - 2 * 60000).toISOString(), unread: 2, starred: true, archived: false, urgent: false, teacherId: 'T-014' },
  { id: 'C03', name: 'Pooja Bhatt', avatar: 'PB', role: 'HoD Science', type: 'staff', lastMessage: 'Lab equipment needs restocking — 4 microscopes down.', lastTimestamp: new Date(Date.now() - 60 * 60000).toISOString(), unread: 1, starred: false, archived: false, urgent: true, teacherId: 'T-038' },
  { id: 'C05', name: 'Rajesh Khanna', avatar: 'RK', role: 'HoD Mathematics', type: 'staff', lastMessage: 'Pre-board timetable draft attached for approval.', lastTimestamp: new Date(Date.now() - 5 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false, teacherId: 'T-035' },
  { id: 'C06', name: 'Suresh Pillai', avatar: 'SP', role: 'Teacher · Social Sci', type: 'staff', lastMessage: 'On medical leave till Friday, sub arranged.', lastTimestamp: new Date(Date.now() - 26 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false, teacherId: 'T-029' },
  { id: 'C08', name: 'Admin Office', avatar: 'AO', role: 'Front Office', type: 'staff', lastMessage: '3 new admission enquiries logged today.', lastTimestamp: new Date(Date.now() - 2 * 24 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false },

  // Parent conversations — linked to students
  { id: 'C04', name: 'Vikram Sharma', avatar: 'VS', role: 'Parent · Aarav Sharma', type: 'parent', lastMessage: 'When is the next parent-teacher meeting?', lastTimestamp: new Date(Date.now() - 3 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false, studentName: 'Aarav Sharma', studentClass: 'Class 2-A' },
  { id: 'C07', name: 'Sriram Iyer', avatar: 'SI', role: 'Parent · Myra Iyer', type: 'parent', lastMessage: 'Myra will be late today due to a doctor appointment.', lastTimestamp: new Date(Date.now() - 26 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false, studentName: 'Myra Iyer', studentClass: 'Class 2-A' },

  // Group conversations — linked to class structure (groupId linked below).
  // memberCount / role are kept in sync with the Group.memberRefs length at
  // seed time (see buildSeedGroups) so add/remove mutations stay consistent.
  { id: 'C02', name: 'Class 2-A Parents', avatar: '2A', role: 'Group · 6 members', type: 'group', lastMessage: 'Mrs. Sharma: Thank you for the PTM update!', lastTimestamp: new Date(Date.now() - 18 * 60000).toISOString(), unread: 5, starred: true, archived: false, urgent: false, memberCount: 6, groupId: 'G01' },
  { id: 'C09', name: 'Science Department', avatar: 'SD', role: 'Group · 6 members', type: 'group', lastMessage: 'Kavita: Lab safety protocols updated for Term 2.', lastTimestamp: new Date(Date.now() - 4 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: false, urgent: false, memberCount: 6, groupId: 'G02' },
  { id: 'C10', name: 'Class 10 Teachers', avatar: '10T', role: 'Group · 8 members', type: 'group', lastMessage: 'Rajesh: Pre-board exam preparation meeting tomorrow.', lastTimestamp: new Date(Date.now() - 8 * 60 * 60000).toISOString(), unread: 3, starred: false, archived: false, urgent: true, memberCount: 8, groupId: 'G03' },

  // Archived
  { id: 'C11', name: 'Deepa Menon', avatar: 'DM', role: 'Senior Teacher · English', type: 'staff', lastMessage: 'PTM preparation notes shared.', lastTimestamp: new Date(Date.now() - 5 * 24 * 60 * 60000).toISOString(), unread: 0, starred: false, archived: true, urgent: false, teacherId: 'T-020' },
]

const SEED_MESSAGES: Record<string, Message[]> = {
  C01: [
    { id: 'M01', conversationId: 'C01', sender: 'them', text: "Good morning, Ma'am. I've completed the Unit Test 3 marking for Class 2-A Mathematics.", timestamp: new Date(Date.now() - 90 * 60000).toISOString() },
    { id: 'M02', conversationId: 'C01', sender: 'them', text: 'Overall class average is 78%. Top scorer is Myra Iyer with 48/50.', timestamp: new Date(Date.now() - 88 * 60000).toISOString() },
    { id: 'M03', conversationId: 'C01', sender: 'me', text: 'Excellent work, Rohan! Please publish the results and send me the analysis report.', timestamp: new Date(Date.now() - 80 * 60000).toISOString(), status: 'delivered' },
    { id: 'M04', conversationId: 'C01', sender: 'them', text: 'Will do. I noticed 3 students scored below 60% — should I schedule remedial sessions?', timestamp: new Date(Date.now() - 78 * 60000).toISOString() },
    { id: 'M05', conversationId: 'C01', sender: 'me', text: "Yes, please coordinate with their parents. Let's discuss in the staff meeting at 3 PM.", timestamp: new Date(Date.now() - 75 * 60000).toISOString(), status: 'delivered' },
    { id: 'M06', conversationId: 'C01', sender: 'them', text: 'Submitted the Unit Test 3 marks, please review.', timestamp: new Date(Date.now() - 2 * 60000).toISOString() },
  ],
  C02: [
    { id: 'M01', conversationId: 'C02', sender: 'me', text: 'Dear Parents, the Primary PTM is scheduled for Saturday, 7th December from 9 AM to 12 PM. Please be on time.', timestamp: new Date(Date.now() - 30 * 60000).toISOString(), status: 'delivered' },
    { id: 'M02', conversationId: 'C02', sender: 'them', senderName: 'Mrs. Sharma', text: 'Thank you for the PTM update! Will be there.', timestamp: new Date(Date.now() - 18 * 60000).toISOString() },
    { id: 'M03', conversationId: 'C02', sender: 'them', senderName: 'Mr. Patel', text: 'Can we get a specific time slot to avoid waiting?', timestamp: new Date(Date.now() - 15 * 60000).toISOString() },
    { id: 'M04', conversationId: 'C02', sender: 'me', text: "Mr. Patel — slots are first-come-first-serve but we'll try to keep it under 10 min per family.", timestamp: new Date(Date.now() - 12 * 60000).toISOString(), status: 'delivered' },
  ],
  C03: [
    { id: 'M01', conversationId: 'C03', sender: 'them', text: 'Lab equipment needs restocking — 4 microscopes down.', timestamp: new Date(Date.now() - 60 * 60000).toISOString() },
    { id: 'M02', conversationId: 'C03', sender: 'them', text: 'Can we approve the procurement request by Friday?', timestamp: new Date(Date.now() - 58 * 60000).toISOString() },
  ],
  C04: [
    { id: 'M01', conversationId: 'C04', sender: 'them', text: "Good morning Ma'am, this is Vikram, Aarav's father.", timestamp: new Date(Date.now() - 4 * 60 * 60000).toISOString() },
    { id: 'M02', conversationId: 'C04', sender: 'them', text: 'When is the next parent-teacher meeting?', timestamp: new Date(Date.now() - 3 * 60 * 60000).toISOString() },
    { id: 'M03', conversationId: 'C04', sender: 'me', text: "Hello Mr. Sharma! The primary PTM is on 7th December, 9 AM–12 PM. Looking forward to discussing Aarav's excellent progress.", timestamp: new Date(Date.now() - 2.5 * 60 * 60000).toISOString(), status: 'delivered' },
  ],
  C05: [
    { id: 'M01', conversationId: 'C05', sender: 'them', text: 'Pre-board timetable draft attached for approval.', timestamp: new Date(Date.now() - 5 * 60 * 60000).toISOString() },
  ],
  C10: [
    { id: 'M01', conversationId: 'C10', sender: 'them', senderName: 'Rajesh Khanna', text: 'Pre-board exam preparation meeting tomorrow at 2 PM in the staff room.', timestamp: new Date(Date.now() - 8 * 60 * 60000).toISOString() },
    { id: 'M02', conversationId: 'C10', sender: 'them', senderName: 'Pooja Bhatt', text: 'I will share the science practical schedule after the meeting.', timestamp: new Date(Date.now() - 7 * 60 * 60000).toISOString() },
    { id: 'M03', conversationId: 'C10', sender: 'them', senderName: 'Deepa Menon', text: 'Should we also discuss the answer sheet evaluation rubric?', timestamp: new Date(Date.now() - 6.5 * 60 * 60000).toISOString() },
  ],
}

const SEED_DRAFTS: Draft[] = [
  { id: 'D01', conversationId: 'C03', text: 'Yes, I will approve the procurement request today. Please send the vendor details.', timestamp: new Date(Date.now() - 30 * 60000).toISOString() },
  { id: 'D02', conversationId: 'C10', text: 'Yes, please include the rubric discussion in the agenda.', timestamp: new Date(Date.now() - 45 * 60000).toISOString() },
  { id: 'D03', recipientName: 'Accounts Office', text: 'Please share the Q3 expense summary for the board meeting.', timestamp: new Date(Date.now() - 2 * 60 * 60000).toISOString() },
]

// ─── Seed Groups (linked to existing seed conversations) ────────────

function buildSeedGroups(): Group[] {
  // Class 2-A Parents — pull parents from ALL Class 2 sections so the
  // membership roster is rich enough (the seed has only 2 students per
  // section, so limiting to section A would give just 2 parents).
  const class2Sections = ['A', 'B', 'C']
  const class2Parents = Array.from(
    new Set(class2Sections.flatMap((sec) => getParentsOfClassSection('Class 2', sec))),
  ).slice(0, 6)
  // Science Department — all Science-dept teachers + a couple of HoDs that work with Science
  const scienceTeachers = getTeachersOfDepartment('Science')
  // Class 10 Teachers — teachers of Class 10 + senior-school HoDs that coordinate
  const class10a = getTeachersOfClass('Class 10-A')
  const class10b = getTeachersOfClass('Class 10-B')
  const class9 = getTeachersOfClass('Class 9-A')
  const class11Sci = getTeachersOfClass('Class 11-Sci-A')
  const class12Sci = getTeachersOfClass('Class 12-Sci-A')
  const class10Teachers = Array.from(new Set([...class10a, ...class10b, ...class9, ...class11Sci, ...class12Sci]))
  // Backfill with senior HoDs / teachers to reach 8
  const backfill = ['T-020', 'T-029', 'T-032', 'T-026', 'T-014', 'T-023']
    .map((id) => `t:${id}`)
    .filter((r) => !class10Teachers.includes(r))
  const class10Final = [...class10Teachers, ...backfill].slice(0, 8)
  // Science Department backfill to reach 6
  const sciBackfill = ['T-041', 'T-014']
    .map((id) => `t:${id}`)
    .filter((r) => !scienceTeachers.includes(r))
  const sciFinal = [...scienceTeachers, ...sciBackfill].slice(0, 6)

  return [
    {
      id: 'G01',
      name: 'Class 2-A Parents',
      type: 'Class Group',
      memberRefs: class2Parents,
      conversationId: 'C02',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString(),
    },
    {
      id: 'G02',
      name: 'Science Department',
      type: 'Department Group',
      memberRefs: sciFinal,
      conversationId: 'C09',
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60000).toISOString(),
    },
    {
      id: 'G03',
      name: 'Class 10 Teachers',
      type: 'Teachers Group',
      memberRefs: class10Final,
      conversationId: 'C10',
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60000).toISOString(),
    },
  ]
}

const SEED_GROUPS: Group[] = buildSeedGroups()

// ─── Zustand Store ───────────────────────────────────────────────────

interface MessagingState {
  conversations: Conversation[]
  messages: Record<string, Message[]>
  drafts: Draft[]
  groups: Group[]
  activeConversationId: string | null
  activeFolder: Folder
  activeLabel: Label | null
  searchQuery: string
  /** FINAL-GATE (EG-9F/R4) — set once the demo seed has been applied. */
  demoSeeded?: boolean
  /** FINAL-GATE (EG-9F/R4) — one-shot demo-tier seeder (module root). */
  ensureDemoSeed: () => void

  // actions
  setActiveFolder: (folder: Folder) => void
  setActiveLabel: (label: Label | null) => void
  setSearchQuery: (query: string) => void
  openConversation: (id: string) => void
  sendMessage: (conversationId: string, text: string) => void
  starConversation: (id: string) => void
  archiveConversation: (id: string) => void
  unarchiveConversation: (id: string) => void
  markUrgent: (id: string) => void
  markUnread: (id: string) => void
  saveDraft: (conversationId: string, text: string) => void
  saveNewDraft: (recipientName: string, text: string) => void
  deleteDraft: (id: string) => void
  sendDraft: (id: string) => void
  composeNew: (recipientName: string, text: string) => void

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

export const useMessagingStore = create<MessagingState>()(
  persist(
    (set, get) => ({
  // FINAL-GATE (EG-9F/R4) — the seed corpus above is the sanctioned DEMO
  // TIER content (School.isDemo): the store now boots EMPTY and the
  // Messages module root applies it once per session via `ensureDemoSeed`.
  // A real production tenant keeps this honest empty state; persisted
  // tenant-scoped state always wins over re-seeding.
  conversations: [],
  messages: {},
  drafts: [],
  groups: [],
  activeConversationId: null,
  activeFolder: 'inbox',
  activeLabel: null,
  searchQuery: '',
  ensureDemoSeed: () => ensureMessagingDemoSeed(),

  setActiveFolder: (folder) => set({ activeFolder: folder, activeLabel: null }),
  setActiveLabel: (label) => set({ activeLabel: label }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  openConversation: (id) => {
    const state = get()
    const convo = state.conversations.find((c) => c.id === id)
    if (!convo) return
    set({
      activeConversationId: id,
      conversations: state.conversations.map((c) => c.id === id ? { ...c, unread: 0 } : c),
    })
  },

  sendMessage: (conversationId, text) => {
    const state = get()
    if (!text.trim()) return
    const newMsg: Message = {
      id: `M${Date.now()}`,
      conversationId,
      sender: 'me',
      text: text.trim(),
      timestamp: new Date().toISOString(),
      status: 'sent',
    }
    const existingMessages = state.messages[conversationId] ?? []
    set({
      messages: {
        ...state.messages,
        [conversationId]: [...existingMessages, newMsg],
      },
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: text.trim(), lastTimestamp: new Date().toISOString(), unread: 0 }
          : c,
      ),
    })

    // Simulate delivered status after 800ms
    setTimeout(() => {
      const currentState = get()
      set({
        messages: {
          ...currentState.messages,
          [conversationId]: (currentState.messages[conversationId] ?? []).map((m) =>
            m.id === newMsg.id ? { ...m, status: 'delivered' as MessageStatus } : m,
          ),
        },
      })
    }, 800)

    // Simulate auto-reply for staff/parent/group conversations after 3.5s.
    // DEMO-TIER ONLY (PIH-4c): the inbound auto-reply is a fabrication — a
    // real tenant must never see a message nobody actually sent. Gated on
    // the server-derived demo signal exactly like the seed corpus above.
    if (!readIsDemoTenant()) return
    const convo = state.conversations.find((c) => c.id === conversationId)
    if (convo && (convo.type === 'staff' || convo.type === 'parent' || convo.type === 'group')) {
      const replies = [
        'Thank you, Ma\'am. I will follow up on this.',
        'Noted. Will get back to you shortly.',
        'Understood. I will take care of it.',
        'Thanks for the update. Let me check and confirm.',
        'Got it. Will coordinate accordingly.',
      ]
      setTimeout(() => {
        const replyState = get()
        // For groups, pick a real member name; for staff/parent, senderName is undefined (uses convo.name)
        let senderName: string | undefined
        if (convo.type === 'group') {
          const group = replyState.groups.find((g) => g.id === convo.groupId)
          if (group && group.memberRefs.length > 0) {
            const members = resolveMemberRefs(group.memberRefs)
            if (members.length > 0) {
              const pick = members[Math.floor(Math.random() * members.length)]
              senderName = pick.name
            }
          }
          if (!senderName) senderName = convo.name.split(' ')[0]
        }
        const reply: Message = {
          id: `M${Date.now() + 1}`,
          conversationId,
          sender: 'them',
          senderName,
          text: replies[Math.floor(Math.random() * replies.length)],
          timestamp: new Date().toISOString(),
        }
        set({
          messages: {
            ...replyState.messages,
            [conversationId]: [...(replyState.messages[conversationId] ?? []), reply],
          },
          conversations: replyState.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: reply.text, lastTimestamp: reply.timestamp }
              : c,
          ),
        })
      }, 3500)
    }
  },

  starConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => c.id === id ? { ...c, starred: !c.starred } : c),
    })
  },

  archiveConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => c.id === id ? { ...c, archived: true, starred: false } : c),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })
  },

  unarchiveConversation: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => c.id === id ? { ...c, archived: false } : c),
    })
  },

  markUrgent: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => c.id === id ? { ...c, urgent: !c.urgent } : c),
    })
  },

  markUnread: (id) => {
    const state = get()
    set({
      conversations: state.conversations.map((c) => c.id === id && c.unread === 0 ? { ...c, unread: 1 } : c),
    })
  },

  saveDraft: (conversationId, text) => {
    const state = get()
    if (!text.trim()) return
    // Remove existing draft for this conversation
    const filteredDrafts = state.drafts.filter((d) => d.conversationId !== conversationId)
    set({
      drafts: [...filteredDrafts, {
        id: `D${Date.now()}`,
        conversationId,
        text: text.trim(),
        timestamp: new Date().toISOString(),
      }],
    })
  },

  saveNewDraft: (recipientName, text) => {
    const state = get()
    if (!text.trim()) return
    set({
      drafts: [...state.drafts, {
        id: `D${Date.now()}`,
        recipientName,
        text: text.trim(),
        timestamp: new Date().toISOString(),
      }],
    })
  },

  deleteDraft: (id) => {
    const state = get()
    set({ drafts: state.drafts.filter((d) => d.id !== id) })
  },

  sendDraft: (id) => {
    const state = get()
    const draft = state.drafts.find((d) => d.id === id)
    if (!draft) return
    if (draft.conversationId) {
      get().sendMessage(draft.conversationId, draft.text)
    } else if (draft.recipientName) {
      get().composeNew(draft.recipientName, draft.text)
    }
    set({ drafts: state.drafts.filter((d) => d.id !== id) })
  },

  composeNew: (recipientName, text) => {
    const state = get()
    if (!text.trim()) return

    // Check if conversation with this recipient already exists
    const existing = state.conversations.find((c) => c.name === recipientName && !c.archived)
    if (existing) {
      get().sendMessage(existing.id, text)
      set({ activeFolder: 'inbox', activeConversationId: existing.id })
      return
    }

    // Create new conversation
    const id = `C${Date.now()}`
    const isGroup = recipientName.includes('Parents') || recipientName.includes('Department') || recipientName.includes('Teachers') || recipientName.includes('Group')
    const isStaff = !isGroup && teachers.some((t) => t.name === recipientName)
    const teacher = teachers.find((t) => t.name === recipientName)
    const type: ConversationType = isGroup ? 'group' : isStaff ? 'staff' : 'parent'

    const newConvo: Conversation = {
      id,
      name: recipientName,
      avatar: avatarFromName(recipientName),
      role: teacher ? `${teacher.designation} · ${teacher.department}` : isGroup ? 'Group' : 'Parent',
      type,
      lastMessage: text.trim(),
      lastTimestamp: new Date().toISOString(),
      unread: 0,
      starred: false,
      archived: false,
      urgent: false,
      teacherId: teacher?.id,
      memberCount: isGroup ? 1 : undefined,
    }

    const newMsg: Message = {
      id: `M${Date.now()}`,
      conversationId: id,
      sender: 'me',
      text: text.trim(),
      timestamp: new Date().toISOString(),
      status: 'sent',
    }

    set({
      conversations: [newConvo, ...state.conversations],
      messages: { ...state.messages, [id]: [newMsg] },
      activeFolder: 'inbox',
      activeConversationId: id,
    })
  },

  // ─── Group actions ─────────────────────────────────────────────────

  createGroup: ({ name, type, memberRefs }) => {
    const state = get()
    const trimmed = name.trim()
    const groupId = `G${Date.now()}`
    const conversationId = `C${Date.now() + 1}`
    const uniqueMembers = Array.from(new Set(memberRefs))
    const memberCount = uniqueMembers.length

    // Build the linked conversation
    const newConvo: Conversation = {
      id: conversationId,
      name: trimmed,
      avatar: avatarFromName(trimmed),
      role: `Group · ${memberCount} member${memberCount === 1 ? '' : 's'}`,
      type: 'group',
      lastMessage: 'Group created · say hi to your members!',
      lastTimestamp: new Date().toISOString(),
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
      status: 'delivered',
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
      groups: state.groups.map((g) => g.id === groupId ? { ...g, memberRefs: nextRefs } : g),
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
      groups: state.groups.map((g) => g.id === groupId ? { ...g, memberRefs: nextRefs } : g),
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
      groups: state.groups.map((g) => g.id === groupId ? { ...g, name: trimmed } : g),
      conversations: state.conversations.map((c) =>
        c.id === group.conversationId ? { ...c, name: trimmed, avatar: avatarFromName(trimmed) } : c,
      ),
    })
  },

  deleteGroup: (groupId) => {
    const state = get()
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return
    set({
      groups: state.groups.filter((g) => g.id !== groupId),
      conversations: state.conversations.filter((c) => c.id !== group.conversationId),
      activeConversationId: state.activeConversationId === group.conversationId ? null : state.activeConversationId,
      // Remove any drafts tied to the conversation
      drafts: state.drafts.filter((d) => d.conversationId !== group.conversationId),
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
        // Conversations where the last message was sent by me
        result = result.filter((c) => {
          const msgs = state.messages[c.id] ?? []
          return msgs.length > 0 && msgs[msgs.length - 1].sender === 'me' && !c.archived
        })
        break
      case 'groups':
        result = result.filter((c) => c.type === 'group' && !c.archived)
        break
      case 'drafts':
        // Conversations that have an associated draft
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

    // Search filter
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase()
      result = result.filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true
        if (c.lastMessage.toLowerCase().includes(q)) return true
        // Search in message content
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
    }),
    {
      name: 'scholario-messaging-v1',
      storage: createTenantScopedStorage('scholario-messaging-v1'),
      version: 2,
      // DATA slices only — plain JSON (arrays, records, strings). UI state
      // (active folder/label/conversation, search) and actions excluded.
      partialize: (s) => ({
        conversations: s.conversations,
        messages: s.messages,
        drafts: s.drafts,
        groups: s.groups,
      }),
    },
  ),
)

// ─── FINAL-GATE (EG-9F/R4) demo-tier seeder ──────────────────────────
// Built lazily on first call (the store exists by then). Applies the
// sanctioned demo corpus at most once, never over non-pristine state —
// see makeDemoSeedApplier guard rules.
let _ensureMessagingDemoSeed: (() => void) | null = null
function ensureMessagingDemoSeed(): void {
  _ensureMessagingDemoSeed ??= makeDemoSeedApplier(useMessagingStore, {
    conversations: SEED_CONVERSATIONS,
    messages: SEED_MESSAGES,
    drafts: SEED_DRAFTS,
    groups: SEED_GROUPS,
    // Pre-open the flagship thread (C01) exactly as the seed era did.
    activeConversationId: 'C01',
  })
  _ensureMessagingDemoSeed()
}

// ─── Recipient options (for Compose) ────────────────────────────────

export interface RecipientOption {
  name: string
  role: string
  type: ConversationType
  avatar: string
}

export function getRecipientOptions(): RecipientOption[] {
  const students = useStudentsStore.getState().students
  const activeStudents = students.filter((s) => s.status === 'Active')

  const staff: RecipientOption[] = teachers
    .filter((t) => !t.archived)
    .map((t) => ({
      name: t.name,
      role: `${t.designation} · ${t.department}`,
      type: 'staff' as ConversationType,
      avatar: t.avatar,
    }))

  // Parents — deduped by guardian name (one entry per parent; siblings
  // are collapsed into a single row so recipient keys stay unique).
  const parents: RecipientOption[] = []
  const seenParent = new Set<string>()
  for (const s of activeStudents) {
    if (seenParent.has(s.fatherName)) continue
    seenParent.add(s.fatherName)
    const wards = activeStudents.filter((x) => x.fatherName === s.fatherName).map((x) => x.name)
    const wardLabel =
      wards.length === 1
        ? wards[0]
        : wards.length === 2
          ? wards.join(' & ')
          : `${wards[0]} +${wards.length - 1} more`
    parents.push({
      name: s.fatherName,
      role: `Parent · ${wardLabel}`,
      type: 'parent' as ConversationType,
      avatar: s.fatherName.split(' ').map((n) => n[0]).slice(0, 2).join(''),
    })
    if (parents.length >= 12) break
  }

  // Groups — pulled from the live store so newly-created groups appear automatically
  const groups: RecipientOption[] = useMessagingStore.getState().groups.map((g) => ({
    name: g.name,
    role: `Group · ${g.memberRefs.length} member${g.memberRefs.length === 1 ? '' : 's'}`,
    type: 'group' as ConversationType,
    avatar: avatarFromName(g.name),
  }))

  return [...staff, ...parents, ...groups]
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
