import { db } from "@/lib/db";
import { requireSession, ok, fail, route } from "@/lib/api";

export const GET = route(async (req: Request) => {
  const user = await requireSession();
  const url = new URL(req.url);

  if (user.role === "PRINCIPAL") {
    const studentId = url.searchParams.get("studentId");
    if (studentId) return ok(await studentLedger(user.schoolId, studentId));
    return ok(await principalOverview(user.schoolId));
  }

  if (user.role === "STUDENT") {
    if (!user.studentId) throw fail(400, "No student profile is linked to this account.");
    return ok(await studentLedger(user.schoolId, user.studentId));
  }

  // Teachers reach fees through /api/payments (their collections); the ledger
  // itself is a principal/student view.
  throw fail(403, "The fee ledger is available to the principal and students.");
});

async function principalOverview(schoolId: string) {
  const [classes, structures, students, collectedAgg, dueAgg, dueCount, verifyAgg, verifyCount] = await Promise.all([
    db.class.findMany({ where: { schoolId }, orderBy: { gradeLevel: "asc" }, select: { id: true, name: true } }),
    db.feeStructure.findMany({
      where: { schoolId },
      orderBy: [{ class: { gradeLevel: "asc" } }, { sort: "asc" }, { head: "asc" }],
      select: { id: true, classId: true, head: true, amount: true, frequency: true, mandatory: true, sort: true },
    }),
    db.student.findMany({
      where: { schoolId, status: "ACTIVE" },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, admissionNo: true, class: { select: { name: true } } },
    }),
    db.payment.aggregate({ where: { schoolId, status: "SUCCESS" }, _sum: { amount: true } }),
    db.feeAssessment.aggregate({ where: { student: { schoolId }, status: "DUE" }, _sum: { amount: true } }),
    db.feeAssessment.count({ where: { student: { schoolId }, status: "DUE" } }),
    db.payment.aggregate({ where: { schoolId, status: "UNDER_VERIFICATION" }, _sum: { amount: true } }),
    db.payment.count({ where: { schoolId, status: "UNDER_VERIFICATION" } }),
  ]);

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  const grouped = new Map<string, { classId: string; className: string; heads: typeof structures }>();
  for (const s of structures) {
    const g = grouped.get(s.classId) ?? { classId: s.classId, className: classNameById.get(s.classId) ?? "—", heads: [] as typeof structures };
    g.heads.push(s);
    grouped.set(s.classId, g);
  }

  return {
    role: "PRINCIPAL" as const,
    kpis: {
      collected: collectedAgg._sum.amount ?? 0,
      outstanding: dueAgg._sum.amount ?? 0,
      dueCount,
      toVerify: verifyAgg._sum.amount ?? 0,
      toVerifyCount: verifyCount,
    },
    classes,
    structures: [...grouped.values()],
    students: students.map((s) => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, className: s.class.name })),
  };
}

/** Assessments + payment ledger for one student (tenant-checked). */
async function studentLedger(schoolId: string, studentId: string) {
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { class: { select: { name: true } } },
  });
  if (!student || student.schoolId !== schoolId) throw fail(404, "Student not found in this school.");

  const [assessments, payments] = await Promise.all([
    db.feeAssessment.findMany({
      where: { studentId },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      select: { id: true, amount: true, concession: true, dueOn: true, status: true, feeStructure: { select: { head: true, frequency: true } } },
    }),
    db.payment.findMany({
      where: { studentId },
      orderBy: [{ paidOn: "desc" }, { receiptNo: "desc" }],
      select: {
        id: true, receiptNo: true, amount: true, mode: true, status: true, note: true, paidOn: true,
        verifiedAt: true,
        collector: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);

  const totalDue = assessments.filter((a) => a.status === "DUE").reduce((t, a) => t + a.amount - a.concession, 0);
  const totalPaid = payments.filter((p) => p.status === "SUCCESS").reduce((t, p) => t + p.amount, 0);

  return {
    role: "STUDENT" as const,
    student: { id: student.id, name: student.name, admissionNo: student.admissionNo, className: student.class.name },
    totalDue,
    totalPaid,
    assessments: assessments.map((a) => ({
      id: a.id, head: a.feeStructure.head, frequency: a.feeStructure.frequency,
      amount: a.amount - a.concession, dueOn: a.dueOn, status: a.status,
    })),
    payments: payments.map((p) => ({
      id: p.id, receiptNo: p.receiptNo, amount: p.amount, mode: p.mode, status: p.status,
      note: p.note, paidOn: p.paidOn, verifiedAt: p.verifiedAt,
      collector: p.collector?.user.name ?? null,
    })),
  };
}
