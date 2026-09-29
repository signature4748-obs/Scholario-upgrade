'use client'

import {
  LayoutDashboard, CalendarCheck, BookMarked,
  FileText, Users, BarChart3, TrendingUp, Wallet, ClipboardList, Settings,
  CalendarDays, MessagesSquare, School,
} from 'lucide-react'
import type { NavGroup } from '@/components/shell/app-shell'
import type { PositionAssignment } from '@/lib/store/teachers-store'

export interface NavRegistryArgs {
  isRelieved: boolean
  /**
   * REAL server-derived appointment (GET /api/teacher/role): the classes
   * this teacher is class teacher of. The Class Teacher Hub group exists
   * ONLY for appointed class teachers — position permissions never grant
   * it, and a teacher with no appointment sees the plain teacher panel.
   */
  classTeacherOf: { id: string; label: string }[]
  /** live server-derived unread messages — drives the Communication Hub badge */
  hubUnread?: number
}

export function buildTeacherNavGroups({ isRelieved, classTeacherOf, hubUnread = 0 }: NavRegistryArgs): NavGroup[] {
  if (isRelieved) {
    return [
      {
        label: 'Restricted Access (Relieved Staff)',
        items: [
          { key: 'profile', label: 'My Profile & Record', icon: <Users className="h-4.5 w-4.5" /> },
          { key: 'payroll', label: 'Payroll & Salary Slips', icon: <FileText className="h-4.5 w-4.5" /> },
          { key: 'fee-management', label: 'My Fee Collections', icon: <BarChart3 className="h-4.5 w-4.5" /> },
        ],
      },
    ]
  }

  const navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
        { key: 'payroll', label: 'My Salary & Payments', icon: <Wallet className="h-4.5 w-4.5" /> },
        { key: 'my-attendance', label: 'My Attendance', icon: <CalendarCheck className="h-4.5 w-4.5" /> },
        { key: 'my-timetable', label: 'My Timetable', icon: <CalendarDays className="h-4.5 w-4.5" /> },
      ],
    },
    {
      label: 'Academics & Teaching',
      items: [
        { key: 'attendance', label: 'Class Attendance', icon: <CalendarCheck className="h-4.5 w-4.5" /> },
        { key: 'lesson-planner', label: 'Lesson Planner', icon: <BookMarked className="h-4.5 w-4.5" /> },
        { key: 'marks', label: 'Marks Entry', icon: <FileText className="h-4.5 w-4.5" /> },
        { key: 'students', label: 'Student Directory', icon: <Users className="h-4.5 w-4.5" /> },
        // Growth lives with teaching scope — every teacher awards points to
        // the students they teach (spec §13); the module is NOT
        // class-teacher-gated.
        { key: 'growth', label: 'Student Growth', icon: <TrendingUp className="h-4.5 w-4.5" /> },
      ],
    },
  ]

  // Class Teacher Hub — ONLY for teachers actually appointed class teacher
  // of a class (the server-derived classTeacherOf list). Not appointed ⇒
  // the group (and every module in it) does not exist for this teacher.
  // My Class is the command center: class-level fee handling lives INSIDE
  // it (spec §4/§22) — no separate Fees nav item for class teachers.
  if (classTeacherOf.length > 0) {
    navGroups.push({
      label: 'Class Teacher Hub',
      items: [
        { key: 'class-hub', label: 'My Class', icon: <School className="h-4.5 w-4.5" /> },
      ],
    })
  }

  // In-charge duties sit BELOW the teaching + class-teacher groups (§4).
  navGroups.push({
    // Applications & Forms assigned to this teacher (Application / Event In-charge)
    label: 'In-charge Duties',
    items: [
      { key: 'app-reviews', label: 'Application Reviews', icon: <ClipboardList className="h-4.5 w-4.5" /> },
    ],
  })

  // Communication — the single teacher-facing messaging surface (parents,
  // colleagues, principal — parent messaging absorbed from Parent Connect)
  navGroups.push({
    label: 'Communication',
    items: [
      { key: 'communication', label: 'Communication Hub', icon: <MessagesSquare className="h-4.5 w-4.5" />, badge: hubUnread > 0 ? hubUnread : undefined },
    ],
  })

  // Account — personal settings in their own quiet group. (Student Growth
  // is the UNIFIED growth + performance experience — the former Performance
  // Analytics module was merged into it; no duplicate analytics entry.)
  navGroups.push({
    label: 'Account',
    items: [
      { key: 'settings', label: 'Settings', icon: <Settings className="h-4.5 w-4.5" /> },
    ],
  })

  return navGroups
}

export function getPendingAssignments(teacher: { positions: PositionAssignment[] } | undefined, isRelieved: boolean): PositionAssignment[] {
  if (!teacher || isRelieved) return []
  return teacher.positions.filter((p) => p.status === 'Pending Acceptance' || p.status === 'Pending Removal')
}
