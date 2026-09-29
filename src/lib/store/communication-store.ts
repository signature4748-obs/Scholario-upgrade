/**
 * Communication store — Zustand store for the Communication Center.
 *
 * One connected communication lifecycle:
 *   Compose → Send/Schedule → History → Pin/Archive
 *
 * Audience counts come from canonical Students store + Teachers data.
 * Pinning an announcement updates the Notice Board automatically.
 * Archiving removes from active view but preserves in History.
 */

import { create } from 'zustand'
import { useStudentsStore } from '@/lib/store/students-store'
import { teachers } from '@/lib/mock/teachers'

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

function _getAudienceCount(audience: Audience): number {
  const students = useStudentsStore.getState().students
  const activeStudents = students.filter((s) => s.status === 'Active')

  if (audience === 'All Parents') return activeStudents.length
  if (audience === 'All Students') return activeStudents.length
  if (audience === 'All Teachers') return teachers.length
  if (audience === 'All Staff') return teachers.length + 8 // teachers + admin/support staff (approx)
  // Specific class like "Class 10" or "Class 10-A"
  const isSpecificSection = /-\w$/.test(audience) // ends with -A, -B etc.
  return activeStudents.filter((s) => {
    if (isSpecificSection) {
      return `${s.className}-${s.section}` === audience
    }
    return s.className === audience
  }).length
}

// ─── Seed Data (coherent AY 2025-26 timeline) ────────────────────────

const SEED_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'AN-001',
    title: 'Annual Sports Day — 15 December',
    message: 'The Annual Sports Day will be held on 15 December 2025 at the school sports ground. All students must report by 7:30 AM in sports uniform. Parents are cordially invited to cheer for their children.',
    category: 'Event',
    audience: 'All Parents',
    channels: ['Push', 'SMS'],
    status: 'Sent',
    author: 'Dr. Ananya Iyer',
    createdAt: '2025-11-26T10:00:00Z',
    sentAt: '2025-11-26T10:05:00Z',
    recipientCount: 1842,
    deliveredCount: 1814,
    failedCount: 28,
    pinned: true,
    archived: false,
    relatedModule: 'Calendar',
    relatedItemId: 'E06',
  },
  {
    id: 'AN-002',
    title: 'Pre-Board Examination Schedule Released',
    message: 'Pre-Board examinations for Class 10 & 12 will commence from 9 December 2025. Detailed timetable is available in the Examination module.',
    category: 'Examination',
    audience: 'All Students',
    channels: ['Push', 'Email'],
    status: 'Sent',
    author: 'Pooja Bhatt',
    createdAt: '2025-11-25T14:00:00Z',
    sentAt: '2025-11-25T14:10:00Z',
    recipientCount: 1842,
    deliveredCount: 1798,
    failedCount: 44,
    pinned: false,
    archived: false,
    relatedModule: 'Examinations',
  },
  {
    id: 'AN-003',
    title: 'Parent–Teacher Meeting — Class 1 to 5',
    message: 'PTM for primary classes is scheduled on Saturday, 7 December 2025 from 9:00 AM to 12:00 PM. Please be on time.',
    category: 'Parents',
    audience: 'Class 1',
    channels: ['Push', 'SMS', 'Email'],
    status: 'Sent',
    author: 'Deepa Menon',
    createdAt: '2025-11-24T09:00:00Z',
    sentAt: '2025-11-24T09:05:00Z',
    recipientCount: 124,
    deliveredCount: 122,
    failedCount: 2,
    pinned: false,
    archived: false,
  },
  {
    id: 'AN-004',
    title: 'Winter Vacation Notice',
    message: 'School will remain closed for winter vacation from 24 December 2025 to 1 January 2026. School reopens on 2 January 2026.',
    category: 'Holiday',
    audience: 'All Parents',
    channels: ['Push', 'SMS', 'Email'],
    status: 'Scheduled',
    author: 'Dr. Ananya Iyer',
    createdAt: '2025-11-22T11:00:00Z',
    scheduledFor: '2025-12-20T09:00:00Z',
    recipientCount: 1842,
    pinned: false,
    archived: false,
  },
  {
    id: 'AN-005',
    title: 'Transport Route Change — Route 4',
    message: 'Due to road construction on Sector 14, Bus Route 4 will take a diversion from 1 December. New pickup times have been updated in the Transport module.',
    category: 'Transport',
    audience: 'All Parents',
    channels: ['Push', 'SMS'],
    status: 'Sent',
    author: 'Ramesh Kumar',
    createdAt: '2025-11-20T08:30:00Z',
    sentAt: '2025-11-20T08:35:00Z',
    recipientCount: 1842,
    deliveredCount: 1800,
    failedCount: 42,
    pinned: true,
    archived: false,
    relatedModule: 'Transport',
  },
  {
    id: 'AN-006',
    title: 'Science Exhibition — Class 6 to 10',
    message: 'The Annual Science Exhibition will be held on 12 December 2025. Students should submit their project names to their science teacher by 5 December.',
    category: 'Event',
    audience: 'Class 6',
    channels: ['Push'],
    status: 'Sent',
    author: 'Pooja Bhatt',
    createdAt: '2025-11-18T13:00:00Z',
    sentAt: '2025-11-18T13:05:00Z',
    recipientCount: 248,
    deliveredCount: 245,
    failedCount: 3,
    pinned: false,
    archived: false,
  },
  {
    id: 'AN-007',
    title: 'Fee Reminder — Quarter 3',
    message: 'This is a reminder that the quarterly fee for Q3 is due by 15 December 2025. Please pay before the due date to avoid late fee. Visit Fee Management for details.',
    category: 'Parents',
    audience: 'All Parents',
    channels: ['Push', 'SMS', 'Email'],
    status: 'Draft',
    author: 'Ramesh Kumar',
    createdAt: '2025-11-15T15:00:00Z',
    recipientCount: 1842,
    pinned: false,
    archived: false,
    relatedModule: 'Fee Management',
  },
  {
    id: 'AN-008',
    title: 'Diwali Break — School Closed',
    message: 'School will remain closed from 28 October to 3 November for Diwali celebrations. Wishing all a safe and happy Diwali!',
    category: 'Holiday',
    audience: 'All Parents',
    channels: ['Push', 'SMS', 'Email'],
    status: 'Archived',
    author: 'Dr. Ananya Iyer',
    createdAt: '2025-10-25T10:00:00Z',
    sentAt: '2025-10-25T10:05:00Z',
    recipientCount: 1842,
    deliveredCount: 1820,
    failedCount: 22,
    pinned: false,
    archived: true,
  },
]

const SEED_CIRCULARS: Circular[] = [
  { id: 'CIR-001', refNo: 'DSO/CIR/2025/042', title: 'Pre-Board Exam Circular', date: '2025-11-25', audience: 'Class 10 & 12', category: 'Examination', status: 'Active', color: 'oklch(0.62 0.2 25)' },
  { id: 'CIR-002', refNo: 'DSO/CIR/2025/041', title: 'Winter Uniform Circular', date: '2025-11-20', audience: 'All Classes', category: 'General', status: 'Active', color: 'oklch(0.7 0.15 200)' },
  { id: 'CIR-003', refNo: 'DSO/CIR/2025/040', title: 'Transport Fee Revision', date: '2025-11-15', audience: 'All Parents', category: 'Transport', status: 'Active', color: 'oklch(0.55 0.14 162)' },
  { id: 'CIR-004', refNo: 'DSO/CIR/2025/039', title: 'Annual Day Practice Schedule', date: '2025-11-12', audience: 'Class 3–8', category: 'Event', status: 'Active', color: 'oklch(0.65 0.16 75)' },
  { id: 'CIR-005', refNo: 'DSO/CIR/2025/038', title: 'Diwali Holiday Circular', date: '2025-10-25', audience: 'All', category: 'Holiday', status: 'Archived', color: 'oklch(0.6 0.18 300)' },
  { id: 'CIR-006', refNo: 'DSO/CIR/2025/037', title: 'PTM Schedule — Term 2', date: '2025-10-18', audience: 'All Parents', category: 'Parents', status: 'Active', color: 'oklch(0.55 0.16 250)' },
]

const SEED_AUDIT: CommunicationAudit[] = [
  { id: 'CA-001', action: 'announcement.sent', actor: 'Dr. Ananya Iyer', timestamp: '2025-11-26T10:05:00Z', description: 'Annual Sports Day announcement sent to All Parents via Push + SMS' },
  { id: 'CA-002', action: 'announcement.pinned', actor: 'Dr. Ananya Iyer', timestamp: '2025-11-26T11:00:00Z', description: 'Annual Sports Day pinned to Notice Board' },
  { id: 'CA-003', action: 'announcement.scheduled', actor: 'Dr. Ananya Iyer', timestamp: '2025-11-22T11:00:00Z', description: 'Winter Vacation Notice scheduled for 20 December 2025' },
]

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
  announcements: SEED_ANNOUNCEMENTS,
  circulars: SEED_CIRCULARS,
  audit: SEED_AUDIT,

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
      { label: 'All Teachers', value: 'All Teachers', count: teachers.length },
      { label: 'All Staff', value: 'All Staff', count: teachers.length + 8 },
    ],
    classes,
    sections,
  }
}
