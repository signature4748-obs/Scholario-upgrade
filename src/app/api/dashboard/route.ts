import { db } from "@/lib/db";
import { requireSession, ok, route, isoToday } from "@/lib/api";

export const GET = route(async () => {
  const user = await requireSession();
  const today = isoToday();
  const dow = new Date(today + "T00:00:00").getDay(); // 0 Sun … 6 Sat

  if (user.role === "PRINCIPAL") return ok(await principalDashboard(user.schoolId, today, dow));
  if (user.role === "TEACHER") return ok(await teacherDashboard(user, today, dow));
  return ok(await studentDashboard(user, today, dow));
});

async function principalDashboard(schoolId: string, today: string, dow: number) {
  const [students, suspended, teachers, classes, rooms] = await Promise.all([
    db.student.count({ where: { schoolId, status: "ACTIVE" } }),
    db.student.count({ where: { schoolId, status: "SUSPENDED" } }),
    db.teacher.count({ where: { schoolId, status: "ACTIVE" } }),
    db.class.findMany({ where: { schoolId }, orderBy: { gradeLevel: "asc" }, include: { _count: { select: { students: { where: { status: "ACTIVE" } } } }, classTeacher: { select: { user: { select: { name: true } } } } } }),
    db.room.count({ where: { schoolId } }),
  ]);

  // Today's attendance: per marked class + overall %
  const todayByClass = await db.attendance.groupBy({
    by: ["classId", "status"],
    where: { schoolId, date: today },
    _count: { _all: true },
  });
  const classToday = new Map<string, { present: number; total: number }>();
  for (const row of todayByClass) {
    const e = classToday.get(row.classId) ?? { present: 0, total: 0 };
    if (row.status === "ABSENT") { e.total += row._count._all; }
    else { e.present += row._count._all; e.total += row._count._all; }
    classToday.set(row.classId, e);
  }
  const markedToday = classToday.size;
  let presentToday = 0, totalToday = 0;
  for (const v of classToday.values()) { presentToday += v.present; totalToday += v.total; }

  // Attendance trend: last 10 school days
  const trendDays: string[] = [];
  for (let i = 0; trendDays.length < 10 && i < 21; i++) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue;
    if (d.toISOString().slice(0, 10) === "2026-10-02") continue;
    trendDays.push(d.toISOString().slice(0, 10));
  }
  trendDays.reverse();
  const trend = await db.attendance.groupBy({
    by: ["date", "status"],
    where: { schoolId, date: { in: trendDays } },
    _count: { _all: true },
  });
  const trendMap = new Map<string, { present: number; total: number }>();
  for (const row of trend) {
    const e = trendMap.get(row.date) ?? { present: 0, total: 0 };
    if (row.status !== "ABSENT") e.present += row._count._all;
    e.total += row._count._all;
    trendMap.set(row.date, e);
  }

  // Fees: collected per month (SUCCESS + under verification), outstanding dues
  const payments = await db.payment.findMany({
    where: { schoolId },
    select: { amount: true, status: true, paidOn: true },
  });
  const monthKey = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const collectedByMonth: Record<string, number> = {};
  let underVerification = 0, underVerificationCount = 0;
  for (const p of payments) {
    if (p.status === "SUCCESS") {
      collectedByMonth[monthKey(p.paidOn)] = (collectedByMonth[monthKey(p.paidOn)] ?? 0) + p.amount;
    } else if (p.status === "UNDER_VERIFICATION") {
      underVerification += p.amount;
      underVerificationCount++;
    }
  }
  const dues = await db.feeAssessment.aggregate({
    where: { student: { schoolId }, status: "DUE" },
    _sum: { amount: true },
  });
  const dueCount = await db.feeAssessment.count({ where: { student: { schoolId }, status: "DUE" } });

  // Admissions funnel
  const inquiries = await db.admissionInquiry.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } });

  // PA1 class averages (top classes)
  const pa1 = await db.exam.findFirst({ where: { schoolId, term: "PA1" }, select: { id: true, name: true } });
  let pa1Averages: { className: string; pct: number }[] = [];
  if (pa1) {
    const slots = await db.examSubject.findMany({
      where: { examId: pa1.id },
      select: { classId: true, maxMarks: true, marks: { select: { obtained: true } }, class: { select: { name: true } } },
    });
    const byClass = new Map<string, { name: string; obtained: number; max: number }>();
    for (const slot of slots) {
      const e = byClass.get(slot.classId) ?? { name: slot.class.name, obtained: 0, max: 0 };
      for (const m of slot.marks) { e.obtained += m.obtained; e.max += slot.maxMarks; }
      byClass.set(slot.classId, e);
    }
    pa1Averages = [...byClass.values()]
      .filter((e) => e.max > 0)
      .map((e) => ({ className: e.name, pct: Math.round((e.obtained / e.max) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
  }

  const activity = await db.activityLog.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    take: 9,
  });
  const notices = await db.notice.findMany({
    where: { schoolId, audience: { in: ["ALL"] } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 3,
    select: { id: true, title: true, publishedAt: true, pinned: true },
  });
  const upcomingExam = await db.exam.findFirst({
    where: { schoolId, status: "SCHEDULED" },
    orderBy: { startsOn: "asc" },
    select: { name: true, startsOn: true, endsOn: true },
  });

  return {
    role: "PRINCIPAL" as const,
    kpis: {
      students, suspended, teachers, sections: classes.length, rooms,
      attendanceToday: totalToday > 0 ? Math.round((presentToday / totalToday) * 1000) / 10 : null,
      classesMarked: markedToday, classesTotal: classes.length,
      collectedThisSession: Object.values(collectedByMonth).reduce((a, b) => a + b, 0),
      collectedByMonth, underVerification, underVerificationCount,
      outstandingDues: dues._sum.amount ?? 0, dueCount,
    },
    classes: classes.map((c) => ({
      id: c.id, name: c.name, classTeacher: c.classTeacher?.user?.name ?? "—",
      strength: c._count.students, capacity: c.capacity,
      attendanceToday: classToday.has(c.id)
        ? Math.round((classToday.get(c.id)!.present / Math.max(1, classToday.get(c.id)!.total)) * 100)
        : null,
    })),
    attendanceTrend: trendDays.map((d) => {
      const e = trendMap.get(d);
      return { date: d, pct: e && e.total > 0 ? Math.round((e.present / e.total) * 1000) / 10 : null };
    }),
    admissionsFunnel: Object.fromEntries(inquiries.map((i) => [i.status, i._count._all])),
    pa1: pa1 ? { name: pa1.name, averages: pa1Averages } : null,
    upcomingExam, activity, notices,
  };
}

async function teacherDashboard(user: any, today: string, dow: number) {
  const teacherId = user.teacherId!;
  const [teacher] = await Promise.all([
    db.teacher.findUnique({ where: { id: teacherId }, include: { user: { select: { name: true, email: true } } } }),
  ]);
  if (!teacher) return { role: "TEACHER" as const, error: "No teacher profile linked to this account." };

  const classTeacherOf = await db.class.findMany({
    where: { schoolId: user.schoolId, classTeacherId: teacherId },
    include: { _count: { select: { students: { where: { status: "ACTIVE" } } } } },
    orderBy: { gradeLevel: "asc" },
  });

  // subjects taught
  const assignments = await db.classSubject.findMany({
    where: { teacherId },
    include: { class: { select: { id: true, name: true } }, subject: { select: { id: true, name: true, code: true } } },
    orderBy: { class: { gradeLevel: "asc" } },
  });
  const classesTaught = [...new Map(assignments.map((a) => [a.class.id, a.class.name])).entries()].map(([id, name]) => ({ id, name }));

  // today's timetable (teacher view)
  const todaySlots = dow >= 1 && dow <= 6
    ? await db.timetableSlot.findMany({
        where: { schoolId: user.schoolId, teacherId, dayOfWeek: dow },
        include: { class: { select: { name: true } }, subject: { select: { name: true } }, room: { select: { name: true } } },
        orderBy: { period: "asc" },
      })
    : [];

  // pending attendance for my home classes today
  const pendingAttendance = await Promise.all(
    classTeacherOf.map(async (c) => {
      const marked = await db.attendance.count({ where: { classId: c.id, date: today } });
      return { id: c.id, name: c.name, marked: marked > 0, strength: c._count.students };
    }),
  );

  // PA1 marks completeness for my subject slots
  const pa1 = await db.exam.findFirst({ where: { schoolId: user.schoolId, term: "PA1" }, select: { id: true, name: true } });
  let marksPending: { slotId: string; className: string; subject: string; entered: number; total: number }[] = [];
  if (pa1) {
    const slots = await db.examSubject.findMany({
      where: { examId: pa1.id, subject: { classSubjects: { some: { teacherId } } } },
      include: { class: { select: { name: true } }, subject: { select: { name: true } }, _count: { select: { marks: true } } },
    });
    for (const slot of slots) {
      const totalStudents = await db.student.count({ where: { classId: slot.classId, status: "ACTIVE" } });
      if (slot._count.marks < totalStudents) {
        marksPending.push({ slotId: slot.id, className: slot.class.name, subject: slot.subject.name, entered: slot._count.marks, total: totalStudents });
      }
    }
  }

  // my fee collections this month
  const monthStart = today.slice(0, 8) + "01";
  const [collections, myUnderVerification] = await Promise.all([
    db.payment.aggregate({
      where: { schoolId: user.schoolId, collectedById: teacherId, paidOn: { gte: new Date(monthStart) } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.payment.count({ where: { schoolId: user.schoolId, collectedById: teacherId, status: "UNDER_VERIFICATION" } }),
  ]);

  // my payslip (latest)
  const payslip = await db.payslip.findFirst({
    where: { teacherId },
    orderBy: { month: "desc" },
    select: { month: true, gross: true, deductions: true, net: true, status: true, paidOn: true },
  });

  // lesson plans this week
  const lessonsThisWeek = await db.lessonPlan.findMany({
    where: { teacherId, date: { gte: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) } },
    include: { class: { select: { name: true } }, subject: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: 5,
  });

  const notices = await db.notice.findMany({
    where: { schoolId: user.schoolId, audience: { in: ["ALL", "TEACHERS"] } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 4,
    select: { id: true, title: true, body: true, publishedAt: true, pinned: true },
  });

  return {
    role: "TEACHER" as const,
    teacher: { name: teacher.user.name, designation: teacher.designation, employeeCode: teacher.employeeCode, specialization: teacher.specialization },
    classTeacherOf: classTeacherOf.map((c) => ({ id: c.id, name: c.name, strength: c._count.students })),
    classesTaught, assignments: assignments.map((a) => ({ classId: a.class.id, className: a.class.name, subjectId: a.subject.id, subject: a.subject.name })),
    todaySlots: todaySlots.map((s) => ({ period: s.period, className: s.class.name, subject: s.subject.name, room: s.room?.name ?? null })),
    pendingAttendance, marksPending: marksPending.slice(0, 6),
    collections: { sum: collections._sum.amount ?? 0, count: collections._count?._all ?? 0, underVerification: myUnderVerification },
    payslip, lessonsThisWeek: lessonsThisWeek.map((l) => ({ id: l.id, topic: l.topic, className: l.class.name, subject: l.subject.name, date: l.date, status: l.status })),
    notices,
  };
}

async function studentDashboard(user: any, today: string, dow: number) {
  const student = await db.student.findUnique({
    where: { id: user.studentId! },
    include: { class: { include: { classTeacher: { select: { user: { select: { name: true } }, designation: true } } } } },
  });
  if (!student) return { role: "STUDENT" as const, error: "No student profile linked to this account." };

  // attendance: last 30 school days + overall
  const att = await db.attendance.findMany({
    where: { studentId: student.id },
    select: { date: true, status: true },
    orderBy: { date: "desc" },
    take: 40,
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
  att.forEach((a) => { counts[a.status as keyof typeof counts]++; });
  const considered = att.length;
  const attendancePct = considered > 0 ? Math.round(((counts.PRESENT + counts.LATE) / considered) * 1000) / 10 : null;
  const recentAtt = att.slice(0, 14).reverse().map((a) => ({ date: a.date, status: a.status }));

  // today's timetable for my class
  const todaySlots = dow >= 1 && dow <= 6
    ? await db.timetableSlot.findMany({
        where: { classId: student.classId, dayOfWeek: dow },
        include: { subject: { select: { name: true } }, teacher: { include: { user: { select: { name: true } } } }, room: { select: { name: true } } },
        orderBy: { period: "asc" },
      })
    : [];

  // upcoming exam datesheet for my class
  const upcoming = await db.exam.findFirst({
    where: { schoolId: user.schoolId, status: "SCHEDULED" },
    include: { slots: { where: { classId: student.classId }, include: { subject: { select: { name: true } } }, orderBy: { heldOn: "asc" } } },
    orderBy: { startsOn: "asc" },
  });

  // PA1 results
  const pa1 = await db.exam.findFirst({ where: { schoolId: user.schoolId, term: "PA1", status: "PUBLISHED" } });
  let results: { subject: string; obtained: number; maxMarks: number; grade: string | null; classAvg: number | null }[] = [];
  if (pa1) {
    const slots = await db.examSubject.findMany({
      where: { examId: pa1.id, classId: student.classId },
      include: { subject: { select: { name: true } }, marks: { select: { obtained: true, studentId: true } } },
    });
    for (const slot of slots) {
      const mine = slot.marks.find((m) => m.studentId === student.id);
      const avg = slot.marks.length ? slot.marks.reduce((t, m) => t + m.obtained, 0) / slot.marks.length : null;
      results.push({
        subject: slot.subject.name,
        obtained: mine?.obtained ?? null,
        maxMarks: slot.maxMarks,
        grade: mine?.grade ?? null,
        classAvg: avg != null ? Math.round(avg * 10) / 10 : null,
      });
    }
  }

  // fees
  const feeItems = await db.feeAssessment.findMany({
    where: { studentId: student.id, status: "DUE" },
    include: { feeStructure: { select: { head: true, frequency: true } } },
    orderBy: { dueOn: "asc" },
  });
  const totalDue = feeItems.reduce((t, f) => t + f.amount - f.concession, 0);
  const recentPayments = await db.payment.findMany({
    where: { studentId: student.id, status: "SUCCESS" },
    orderBy: { paidOn: "desc" },
    take: 3,
    select: { receiptNo: true, amount: true, mode: true, paidOn: true },
  });

  const notices = await db.notice.findMany({
    where: { schoolId: user.schoolId, audience: { in: ["ALL", "STUDENTS"] } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 4,
    select: { id: true, title: true, body: true, publishedAt: true, pinned: true },
  });

  return {
    role: "STUDENT" as const,
    student: {
      name: student.name, admissionNo: student.admissionNo, rollNo: student.rollNo,
      className: student.class.name, classTeacher: student.class.classTeacher?.user?.name ?? "—",
      guardianName: student.guardianName,
    },
    attendance: { pct: attendancePct, counts, considered, recent: recentAtt },
    todaySlots: todaySlots.map((s) => ({ period: s.period, subject: s.subject.name, teacher: s.teacher.user.name, room: s.room?.name ?? null })),
    upcomingExam: upcoming ? { name: upcoming.name, startsOn: upcoming.startsOn, endsOn: upcoming.endsOn, slots: upcoming.slots.map((sl) => ({ subject: sl.subject.name, heldOn: sl.heldOn })) } : null,
    pa1: pa1 ? { name: pa1.name, results } : null,
    fees: { totalDue, items: feeItems.slice(0, 6).map((f) => ({ head: f.feeStructure.head, amount: f.amount - f.concession, dueOn: f.dueOn })), recentPayments },
    notices,
  };
}
