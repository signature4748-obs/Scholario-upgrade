import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { num, dec } from '@/lib/money'

export const runtime = 'nodejs'

// Per-school overview stats (principal/management/teacher) or super-admin platform stats
export async function GET() {
  return withUser(async (user) => {
    // Task 4-d (audit 3-a fix #7): gate the school branch to the
    // 'school.dashboard.read' capability roles (P/M) while keeping the
    // SUPER_ADMIN platform branch reachable. STUDENT/PARENT/DRIVER/
    // ACCOUNTANT get 403 (the school branch carries financials + the
    // activity log). Grep-verified: the only GET consumer is the principal
    // dashboard (use-school-stats.ts); the student and teacher panels use
    // /api/student/dashboard + /api/teacher/dashboard.
    // TQA-13: TEACHER was removed from the school-scope branch — the
    // payload carries school-wide financial aggregates (feesTotal,
    // feesPaid, overdue) and the school activity log. A teacher has no
    // business surface for them (their dashboard is /api/teacher/dashboard,
    // assignment-scoped); direct API access must meet the same policy.
    if (
      user.role !== 'SUPER_ADMIN' &&
      !['PRINCIPAL', 'MANAGEMENT'].includes(user.role)
    ) {
      throw new Error('FORBIDDEN')
    }
    if (user.role === 'SUPER_ADMIN') {
      const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
      const showDemo = setting ? setting.showDemoSchool : true

      const schoolWhere = showDemo ? {} : { isDemo: false }
      const studentWhere = showDemo ? {} : { school: { isDemo: false } }
      const teacherWhere = showDemo ? {} : { school: { isDemo: false } }
      const paymentWhere = showDemo ? {} : { fee: { school: { isDemo: false } } }

      const [schoolsCount, studentsCount, teachersCount, revenueAgg, methodAgg] = await Promise.all([
        db.school.count({ where: schoolWhere }),
        db.student.count({ where: studentWhere }),
        db.teacher.count({ where: teacherWhere }),
        db.payment.aggregate({ where: paymentWhere, _sum: { amount: true } }),
        db.payment.groupBy({
          by: ['method'],
          where: { ...paymentWhere, status: 'SUCCESS' },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ])

      const byPlan = await db.school.groupBy({
        by: ['plan'],
        where: schoolWhere,
        _count: { id: true },
      })

      // Monthly × method collection trend (last 6 months) for the stacked chart.
      // Window slides: ends "now" normally, but if the recent window has no
      // payments (e.g. demo data is older), it ends at the latest payment month
      // so the chart always tells a story instead of rendering flat zeroes.
      const trendSince = new Date()
      trendSince.setMonth(trendSince.getMonth() - 11) // wide fetch, trim to 6 buckets later
      trendSince.setHours(0, 0, 0, 0)
      const trendPayments = await db.payment.findMany({
        where: { ...paymentWhere, status: 'SUCCESS', createdAt: { gte: trendSince } },
        select: { amount: true, method: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      })
      const MONTH_FMT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const monthKey = (d: Date) => `${MONTH_FMT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`

      // determine window end: now, or latest payment month if recent window is empty
      let windowEnd = new Date()
      if (trendPayments.length > 0) {
        const newest = trendPayments[trendPayments.length - 1].createdAt
        // if no payment falls inside the last 6 calendar months, slide back
        const sixAgo = new Date(windowEnd)
        sixAgo.setMonth(sixAgo.getMonth() - 5)
        sixAgo.setDate(1)
        sixAgo.setHours(0, 0, 0, 0)
        const hasRecent = trendPayments.some((p) => new Date(p.createdAt) >= sixAgo)
        if (!hasRecent) {
          windowEnd = new Date(newest)
        }
      }

      const monthBuckets = new Map<string, Record<string, ReturnType<typeof dec>>>()
      // Pre-seed the 6 buckets ending at windowEnd (oldest → newest)
      for (let i = 5; i >= 0; i--) {
        const d = new Date(windowEnd)
        d.setMonth(d.getMonth() - i)
        monthBuckets.set(monthKey(d), {})
      }
      for (const p of trendPayments) {
        const key = monthKey(new Date(p.createdAt))
        if (!monthBuckets.has(key)) continue // outside the chosen window
        const bucket = monthBuckets.get(key) || {}
        const m = (p.method || 'UNKNOWN').toUpperCase()
        bucket[m] = (bucket[m] ?? dec(0)).plus(p.amount)
        monthBuckets.set(key, bucket)
      }
      const methodTrend = Array.from(monthBuckets.entries()).map(([month, byMethod]) => ({
        month,
        ...Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, num(v)])),
      }))

      const recentSchools = await db.school.findMany({
        where: schoolWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          _count: {
            select: { users: true, students: true, teachers: true, classes: true },
          },
        },
      })

      return {
        scope: 'PLATFORM',
        showDemoSchool: showDemo,
        stats: {
          schools: schoolsCount,
          students: studentsCount,
          teachers: teachersCount,
          revenue: num(revenueAgg._sum.amount),
        },
        byPlan,
        // Payment method breakdown for the collections donut (UPI/CARD/…)
        methodBreakdown: methodAgg.map((m) => ({
          method: m.method || 'UNKNOWN',
          amount: num(m._sum.amount),
          count: m._count.id,
        })),
        // Monthly stacked trend: [{ month: 'Sep 25', UPI: 50000, CARD: 25000, … }]
        methodTrend,
        recentSchools: recentSchools.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          code: s.code,
          domain: s.domain,
          city: s.city,
          plan: s.plan,
          status: s.status,
          isDemo: Boolean(s.isDemo),
          createdAt: s.createdAt,
          counts: s._count,
        })),
      }
    }

    const schoolId = schoolScoped(user)
    // FINAL-GATE fix (collected semantics): `feesPaid` now sums Fee.paid across
    // ALL rows. The previous `status: 'PAID'` filter silently dropped the paid
    // portion of PARTIALLY_PAID rows, understating collections and breaking the
    // identity billed = collected + outstanding (the donut's Outstanding segment
    // is billed − collected, and the defaulters API computes outstanding as
    // Σ(amount − paid) over non-PAID rows — with the all-rows sum the two
    // systems agree by algebra instead of drifting).
    const [students, teachers, classes, subjects, exams, vehicles, routes, books, notifications, feesTotal, feesPaid, overdue] = await Promise.all([
      // Enrolled students = ACTIVE roster students (same definition as
      // /api/students/roster) so the dashboard STUDENTS KPI can never
      // disagree with the Students module.
      db.student.count({ where: { schoolId, user: { status: 'ACTIVE' } } }),
      db.teacher.count({ where: { schoolId } }),
      db.class.count({ where: { schoolId } }),
      db.subject.count({ where: { schoolId } }),
      db.exam.count({ where: { schoolId } }),
      db.vehicle.count({ where: { schoolId } }),
      db.route.count({ where: { schoolId } }),
      db.libraryBook.count({ where: { schoolId } }),
      db.notification.count({ where: { schoolId } }),
      db.fee.aggregate({ where: { schoolId }, _sum: { amount: true } }),
      db.fee.aggregate({ where: { schoolId }, _sum: { paid: true } }),
      db.fee.count({ where: { schoolId, status: { in: ['UNPAID', 'OVERDUE'] } } }),
    ])

    // attendance last 7 days
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const attendanceRows = await db.attendance.groupBy({
      by: ['status'],
      where: { schoolId, date: { gte: since } },
      _count: { id: true },
    })
    const present = attendanceRows.find((r) => r.status === 'PRESENT')?._count.id || 0
    const absent = attendanceRows.find((r) => r.status === 'ABSENT')?._count.id || 0
    const late = attendanceRows.find((r) => r.status === 'LATE')?._count.id || 0
    const attendanceRate = students ? Math.round((present / Math.max(1, present + absent + late)) * 100) : 0

    // fee collection trend (last 6 months from payments)
    // FINAL-GATE fix: only SUCCESSFUL payments are recorded collections —
    // FAILED/PENDING gateway rows must not inflate the trend (the platform
    // branch above already filtered status: 'SUCCESS'; the school branch now
    // matches it).
    const payments = await db.payment.findMany({
      where: { fee: { schoolId }, status: 'SUCCESS' },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const months: Record<string, ReturnType<typeof dec>> = {}
    for (const p of payments) {
      const key = p.createdAt.toISOString().slice(0, 7)
      months[key] = (months[key] ?? dec(0)).plus(p.amount)
    }
    const trend = Object.entries(months)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6)
      .map(([month, amount]) => ({ month, amount: num(amount) }))

    const recentActivity = await db.activityLog.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { name: true } } },
    })

    const upcomingExams = await db.exam.findMany({
      // Canonical status vocabulary is title-case ('Scheduled'/'Ongoing'),
      // but legacy-seeded rows carry uppercase ('COMPLETED') — match
      // case-insensitively so upcoming exams are never under-reported.
      where: { schoolId, status: { in: ['Scheduled', 'Ongoing'], mode: 'insensitive' } },
      orderBy: { startDate: 'asc' },
      take: 5,
      include: { class: { select: { name: true } } },
    })

    return {
      scope: 'SCHOOL',
      stats: {
        students,
        teachers,
        classes,
        subjects,
        exams,
        vehicles,
        routes,
        books,
        notifications,
        feesTotal: num(feesTotal._sum.amount),
        feesPaid: num(feesPaid._sum.paid),
        overdue,
        attendanceRate,
      },
      attendance: { present, absent, late },
      trend,
      recentActivity,
      upcomingExams,
    }
  })
}

// allow filtering via query for student/teacher/parent specific dashboards
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const body = await req.json().catch(() => ({}))
    const scope = String(body.scope || 'me')

    if (user.role === 'STUDENT') {
      const student = await db.student.findUnique({
        where: { userId: user.id },
        include: { class: true, route: true, user: { select: { name: true, email: true } } },
      })
      if (!student) throw new Error('NOT_FOUND')
      const results = await db.result.findMany({
        where: { studentId: student.id },
        include: { subject: true, exam: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      const attendance = await db.attendance.groupBy({
        by: ['status'],
        where: { studentId: student.id },
        _count: { id: true },
      })
      const fees = await db.fee.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' } })
      const assignments = await db.assignment.findMany({
        where: { classId: student.classId || undefined },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { subject: true },
      })
      const timetable = await db.timetable.findMany({
        // PHASE 8 §7(G): schoolId leads the where-clause so the existing
        // (schoolId, classId, day, period) unique index serves the student
        // dashboard lookup (was classId-only → seq scan; it also always
        // scopes to the student's own school even if classId is unset).
        where: { schoolId: student.schoolId, classId: student.classId || undefined },
        include: { subject: true },
        orderBy: [{ day: 'asc' }, { period: 'asc' }],
      })
      return { scope: 'STUDENT', student, results, attendance, fees, assignments, timetable }
    }

    if (user.role === 'PARENT') {
      const children = await db.student.findMany({
        where: { guardianId: user.id },
        include: { class: true, user: { select: { name: true, email: true } } },
      })
      if (!children.length) throw new Error('No linked students found')
      const childIds = children.map((c) => c.id)
      const results = await db.result.findMany({
        where: { studentId: { in: childIds } },
        include: { subject: true, exam: true, student: { include: { user: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
      const fees = await db.fee.findMany({ where: { studentId: { in: childIds } }, include: { student: { include: { user: { select: { name: true } } } } } })
      const attendance = await db.attendance.groupBy({
        by: ['status', 'studentId'],
        where: { studentId: { in: childIds } },
        _count: { id: true },
      })
      return { scope: 'PARENT', children, results, fees, attendance }
    }

    if (user.role === 'TEACHER') {
      // Task 4-d: session-derived tenant (schoolScoped throws the safe
      // NO_SCHOOL 403 for schoolless callers — replaces four `user.schoolId!`
      // non-null assertions that 500-crashed for schoolless identities).
      const schoolId = schoolScoped(user)
      const teacher = await db.teacher.findUnique({ where: { userId: user.id } })
      const myClasses = await db.class.findMany({
        where: { schoolId },
        include: { _count: { select: { students: true, subjects: true } } },
      })
      const myAssignments = await db.assignment.findMany({
        where: { createdBy: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { class: true, subject: true },
      })
      const myQuestions = await db.questionBank.count({ where: { schoolId } })
      const myPapers = await db.examPaper.count({ where: { createdBy: user.id } })
      const studentsCount = await db.student.count({ where: { schoolId } })
      // Today's timetable for this teacher
      const todayKey = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3)
      const todaySchedule = await db.timetable.findMany({
        where: { schoolId, day: todayKey, teacherName: { contains: user.name, mode: 'insensitive' as const } },
        include: { subject: true, class: true },
        orderBy: { period: 'asc' },
        take: 10,
      })
      const recentResults = await db.result.count({
        where: { exam: { schoolId } },
      })
      return { scope: 'TEACHER', teacher, myClasses, myAssignments, myQuestions, myPapers, studentsCount, todaySchedule, recentResults }
    }

    if (user.role === 'DRIVER') {
      const driver = await db.driver.findUnique({
        where: { userId: user.id },
        include: { vehicles: { include: { route: true } } },
      })
      if (!driver) throw new Error('NOT_FOUND')
      const routeIds = driver.vehicles.map((v) => v.routeId).filter(Boolean) as string[]
      const studentsOnRoute = routeIds.length
        ? await db.student.count({ where: { routeId: { in: routeIds } } })
        : 0
      const students = routeIds.length
        ? await db.student.findMany({
            where: { routeId: { in: routeIds } },
            include: { user: { select: { name: true, phone: true } } },
            take: 50,
          })
        : []
      return { scope: 'DRIVER', driver, vehicles: driver.vehicles, studentsOnRoute, students }
    }

    return { scope }
  })
}
