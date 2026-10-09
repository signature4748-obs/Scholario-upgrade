import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";

/** GET /api/profile — the signed-in student's own record, class info,
 *  session attendance summary and fee dues. STUDENT role only; tenant
 *  and identity always derive from the session. */
export const GET = route(async () => {
  const user = await requireRole("STUDENT");

  const student = await db.student.findUnique({
    where: { id: user.studentId ?? "" },
    include: {
      user: { select: { email: true } },
      class: {
        include: {
          room: { select: { name: true } },
          classTeacher: { select: { designation: true, user: { select: { name: true } } } },
          _count: { select: { students: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });
  if (!student || student.schoolId !== user.schoolId) {
    throw fail(404, "No student profile linked to this account.");
  }

  // Attendance across the whole session (PRESENT + LATE count as attended,
  // matching the student dashboard).
  const att = await db.attendance.findMany({
    where: { studentId: student.id },
    select: { status: true },
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
  for (const a of att) {
    if (a.status in counts) counts[a.status as keyof typeof counts]++;
  }
  const considered = att.length;
  const pct = considered > 0 ? Math.round(((counts.PRESENT + counts.LATE) / considered) * 1000) / 10 : null;

  // Fee dues (amount net of concession, same rule as the ledger).
  const dueRows = await db.feeAssessment.findMany({
    where: { studentId: student.id, status: "DUE" },
    select: { amount: true, concession: true },
  });
  const totalDue = dueRows.reduce((t, f) => t + f.amount - f.concession, 0);

  return ok({
    student: {
      name: student.name,
      admissionNo: student.admissionNo,
      rollNo: student.rollNo,
      gender: student.gender,
      dob: student.dob,
      admittedOn: student.admittedOn,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      address: student.address,
      email: student.user?.email ?? user.email,
    },
    class: {
      name: student.class.name,
      classTeacher: student.class.classTeacher?.user?.name ?? null,
      classTeacherDesignation: student.class.classTeacher?.designation ?? null,
      room: student.class.room?.name ?? null,
      strength: student.class._count.students,
    },
    attendance: { pct, counts, considered },
    fees: { totalDue, dueCount: dueRows.length },
  });
});
