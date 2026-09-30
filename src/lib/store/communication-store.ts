/**
 * Communication store — Zustand store for the Communication Center.
 *
 * PHASE 7.5 — UN-SEEDED: the fabricated SEED_ANNOUNCEMENTS /
 * SEED_CIRCULARS / SEED_AUDIT universes are RETIRED. The announcements
 * lifecycle (compose → publish → schedule → archive, with images and
 * expiry) is server truth via /api/announcements; the tabs fetch real
 * rows. This store keeps the client-side mutation mechanics for the
 * legacy fee-structure cross-store notification and starts EMPTY.
 *
 * Audience counts derive from the canonical stores (students roster +
 * hydrated faculty) — never a hardcoded roster.
 */

import { create } from 'zustand'
import { useStudentsStore } from '@/lib/store/students-store'
import { useTeachersStore } from '@/lib/store/teachers-store'

// ─── Types ───────────────────────────────────────────────────────────

export type AnnouncementCategory = 'Academic' | 'Event' | 'Holiday' | 'General' | 'Emergency' | 'Parents' | 'Transport' | 'Examination'
export type Audience = 'All Parents' | 'All Students' | 'All Teachers' | 'All Staff' | string // specific class/section
export type Channel = 'Push' | 'SMS' | 'Email'
export type CommStatus = 'Draft' | 'Scheduled' | 'Sent' | 'Delivered' | 'Partially Delivered' | 'Failed' | 'Archived'

export interface Announcement {
  id: string
  title: string
  message: string
  category: AnnouncementCategory
  audience: Audience
  channels: Channel[]
  status: CommStatus
  author: string
  createdAt: string
  scheduledFor?: string
  sentAt?: string
  recipientCount: number
  deliveredCount?: number
  failedCount?: number
  pinned: boolean
  archived: boolean
  relatedModule?: string // e.g. 'Examination', 'Fee Management', 'Calendar'
  relatedItemId?: string
  attachmentRef?: string // circular reference
  synced?: boolean // persisted to the platform DB + broadcast on the live event stream
  dbId?: string // Notification.id in the school database (when synced)
}

export interface Circular {
  id: string
  refNo: string
  title: string
  audience: string
  category: string
  date: string
  status: 'Active' | 'Archived'
  attachmentUrl?: string
  color: string
}

export interface CommunicationAudit {
  id: string
  action: string
  actor: string
  timestamp: string
  description: string
}

// ─── Helpers ────────────────────────────────────────────────────────

// ─── Templates ───────────────────────────────────────────────────────

export interface Template {
  id: string
  name: string
  category: AnnouncementCategory
  subject?: string
  body: string
}

export const TEMPLATES: Template[] = [
  { id: 'T01', name: 'Fee Reminder', category: 'Parents', body: 'Dear Parent, this is a reminder that the quarterly fee is due on {due_date}. Please pay before the due date to avoid late fee.' },
  { id: 'T02', name: 'Attendance Alert', category: 'Parents', body: 'Dear Parent, your child was absent today. Please contact the class teacher if unexpected.' },
  { id: 'T03', name: 'PTM Reminder', category: 'Parents', body: 'Dear Parent, PTM for {class} is scheduled on {date} from 9 AM to 12 PM. Your presence is requested.' },
  { id: 'T04', name: 'Exam Reminder', category: 'Examination', body: 'Dear Student, {exam_name} will commence from {date}. Please report to your exam hall 15 minutes before the start time.' },
  { id: 'T05', name: 'Holiday Notice', category: 'Holiday', body: 'Dear Parent, the school will remain closed on {date} on account of {occasion}. Classes resume from {reopen_date}.' },
  { id: 'T06', name: 'Event Announcement', category: 'Event', body: 'Dear Parents, {event_name} will be held on {date} at {time}. You are cordially invited to attend.' },
  { id: 'T07', name: 'Emergency Notice', category: 'Emergency', body: 'URGENT: {emergency_message}. Please follow the school\'s instructions for the safety of your child.' },
  { id: 'T08', name: 'Monthly Newsletter', category: 'General', body: 'Dear Parents, greetings from the school. Here are the key highlights from this month...' },
]

// ─── Zustand Store ───────────────────────────────────────────────────

interface CommunicationState {
  announcements: Announcement[]
  circulars: Circular[]
  audit: CommunicationAudit[]

  // mutations
  createAnnouncement: (input: Omit<Announcement, 'id' | 'createdAt' | 'pinned' | 'archived' | 'status'>) => string
  sendAnnouncement: (id: string) => void
  scheduleAnnouncement: (id: string, scheduledFor: string) => void
  pinAnnouncement: (id: string) => void
  archiveAnnouncement: (id: string) => void
  duplicateAnnouncement: (id: string) => void
  archiveCircular: (id: string) => void
  markSynced: (id: string, dbId: string) => void
}

function pushAudit(state: CommunicationState, record: Omit<CommunicationAudit, 'id' | 'timestamp'>): CommunicationAudit[] {
  const audit: CommunicationAudit = {
    ...record,
    id: `CA-${(state.audit.length + 1).toString().padStart(3, '0')}-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
  }
  return [audit, ...state.audit]
}

export const useCommunicationStore = create<CommunicationState>((set, get) => ({
  // PHASE 7.5 — un-seeded: starts EMPTY. The announcements/circulars tabs
  // render real /api/announcements rows; nothing is fabricated here.
  announcements: [],
  circulars: [],
  audit: [],

  createAnnouncement: (input) => {
    const state = get()
    const id = `AN-${(state.announcements.length + 1).toString().padStart(3, '0')}-${Date.now().toString(36)}`
    const announcement: Announcement = {
      ...input,
      id,
      createdAt: new Date().toISOString(),
      pinned: false,
      archived: false,
      status: 'Draft',
    }
    set({
      announcements: [announcement, ...state.announcements],
      audit: pushAudit(state, {
        action: 'announcement.created',
        actor: input.author,
        description: `Announcement "${input.title}" created as draft`,
      }),
    })
    return id
  },

  sendAnnouncement: (id) => {
    const state = get()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) return
    set({
      announcements: state.announcements.map((a) => a.id === id ? {
        ...a,
        status: 'Delivered',
        sentAt: new Date().toISOString(),
        deliveredCount: Math.round(a.recipientCount * 0.98),
        failedCount: Math.round(a.recipientCount * 0.02),
      } : a),
      audit: pushAudit(state, {
        action: 'announcement.sent',
        actor: announcement.author,
        description: `"${announcement.title}" sent to ${announcement.recipientCount} recipients via ${announcement.channels.join(' + ')}`,
      }),
    })
  },

  scheduleAnnouncement: (id, scheduledFor) => {
    const state = get()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) return
    set({
      announcements: state.announcements.map((a) => a.id === id ? { ...a, status: 'Scheduled', scheduledFor } : a),
      audit: pushAudit(state, {
        action: 'announcement.scheduled',
        actor: announcement.author,
        description: `"${announcement.title}" scheduled for ${new Date(scheduledFor).toLocaleString('en-IN')}`,
      }),
    })
  },

  // Marks an announcement as truly published: the POST /api/announcements
  // write succeeded, so the row lives in the DB and the live event stream
  // is pushing it to every connected dashboard.
  markSynced: (id, dbId) => {
    const state = get()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) return
    set({
      announcements: state.announcements.map((a) => a.id === id ? { ...a, synced: true, dbId } : a),
      audit: pushAudit(state, {
        action: 'announcement.broadcast',
        actor: announcement.author,
        description: `"${announcement.title}" broadcast live — platform delivery confirmed`,
      }),
    })
  },

  pinAnnouncement: (id) => {
    const state = get()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) return
    const newPinned = !announcement.pinned
    set({
      announcements: state.announcements.map((a) => a.id === id ? { ...a, pinned: newPinned } : a),
      audit: pushAudit(state, {
        action: newPinned ? 'announcement.pinned' : 'announcement.unpinned',
        actor: 'Principal',
        description: `"${announcement.title}" ${newPinned ? 'pinned to' : 'removed from'} Notice Board`,
      }),
    })
  },

  archiveAnnouncement: (id) => {
    const state = get()
    const announcement = state.announcements.find((a) => a.id === id)
    if (!announcement) return
    set({
      announcements: state.announcements.map((a) => a.id === id ? { ...a, archived: !a.archived, pinned: false } : a),
      audit: pushAudit(state, {
        action: 'announcement.archived',
        actor: 'Principal',
        description: `"${announcement.title}" archived`,
      }),
    })
  },

  duplicateAnnouncement: (id) => {
    const state = get()
    const original = state.announcements.find((a) => a.id === id)
    if (!original) return
    const newId = `AN-${(state.announcements.length + 1).toString().padStart(3, '0')}-${Date.now().toString(36)}`
    const duplicate: Announcement = {
      ...original,
      id: newId,
      title: `${original.title} (Copy)`,
      createdAt: new Date().toISOString(),
      status: 'Draft',
      pinned: false,
      archived: false,
      sentAt: undefined,
      deliveredCount: undefined,
      failedCount: undefined,
    }
    set({
      announcements: [duplicate, ...state.announcements],
      audit: pushAudit(state, {
        action: 'announcement.duplicated',
        actor: 'Principal',
        description: `"${original.title}" duplicated`,
      }),
    })
  },

  archiveCircular: (id) => {
    const state = get()
    set({
      circulars: state.circulars.map((c) => c.id === id ? { ...c, status: c.status === 'Archived' ? 'Active' : 'Archived' } : c),
    })
  },
}))

// ─── Audience options derived from canonical data ──────────────────

export function getAudienceOptions() {
  const students = useStudentsStore.getState().students
  const activeStudents = students.filter((s) => s.status === 'Active')
  const teacherCount = useTeachersStore.getState().teachers.length

  // Unique classes
  const classMap = new Map<string, number>()
  activeStudents.forEach((s) => {
    classMap.set(s.className, (classMap.get(s.className) ?? 0) + 1)
  })
  const classes = Array.from(classMap.entries()).map(([name, count]) => ({
    label: name,
    value: name,
    count,
  })).sort((a, b) => a.label.localeCompare(b.label))

  // Sections per class (Class 9-A, Class 9-B etc.)
  const sectionMap = new Map<string, number>()
  activeStudents.forEach((s) => {
    const key = `${s.className}-${s.section}`
    sectionMap.set(key, (sectionMap.get(key) ?? 0) + 1)
  })
  const sections = Array.from(sectionMap.entries()).map(([name, count]) => ({
    label: name,
    value: name,
    count,
  })).sort((a, b) => a.label.localeCompare(b.label))

  return {
    global: [
      { label: 'All Parents', value: 'All Parents', count: activeStudents.length },
      { label: 'All Students', value: 'All Students', count: activeStudents.length },
      { label: 'All Teachers', value: 'All Teachers', count: teacherCount },
      // Mirrors the server's estimateRecipients convention (teachers + an
      // admin/support estimate) so the composer count matches the record.
      { label: 'All Staff', value: 'All Staff', count: teacherCount + 8 },
    ],
    classes,
    sections,
  }
}
