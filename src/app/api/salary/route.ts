import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requireSession, ok, fail, route } from "@/lib/api";

/** Statutory deductions: EPF 12% of gross capped at ₹1,800 + Professional Tax ₹200. */
function epfFor(gross: number): number {
  return Math.min(Math.round(gross * 0.12), 1800);
}

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const idx = parseInt(m ?? "", 10) - 1;
  return `${MONTHS_FULL[idx] ?? m} ${y}`;
}

const processSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM form."),
});

export const GET = route(async () => {
  const user = await requireSession();

  if (user.role === "PRINCIPAL") {
    const [teachers, payslips] = await Promise.all([
      db.teacher.findMany({
        where: { schoolId: user.schoolId, status: "ACTIVE" },
        include: {
          user: { select: { name: true, email: true } },
          payslips: { orderBy: { month: "desc" }, take: 1, select: { month: true, net: true, status: true } },
        },
        orderBy: { monthlySalary: "desc" },
      }),
      db.payslip.findMany({
        where: { schoolId: user.schoolId },
        orderBy: [{ month: "desc" }, { teacher: { user: { name: "asc" } } }],
        include: { teacher: { select: { user: { select: { name: true } }, designation: true } } },
      }),
    ]);

    return ok({
      role: "PRINCIPAL" as const,
      totals: {
        teachers: teachers.length,
        monthlyGross: teachers.reduce((t, x) => t + x.monthlySalary, 0),
        payslipCount: payslips.length,
      },
      teachers: teachers.map((t) => ({
        id: t.id, name: t.user.name, designation: t.designation, employeeCode: t.employeeCode,
        gross: t.monthlySalary,
        lastPayslip: t.payslips[0] ? { month: t.payslips[0].month, net: t.payslips[0].net } : null,
      })),
      payslips: payslips.map((p) => ({
        id: p.id, month: p.month, gross: p.gross, deductions: p.deductions, net: p.net,
        status: p.status, paidOn: p.paidOn,
        epf: epfFor(p.gross), pt: 200,
        teacherName: p.teacher.user.name,
      })),
    });
  }

  if (user.role === "TEACHER") {
    const teacherId = user.teacherId;
    if (!teacherId) throw fail(400, "No teacher profile is linked to this account.");
    const [teacher, payslips] = await Promise.all([
      db.teacher.findUnique({
        where: { id: teacherId },
        include: { user: { select: { name: true, email: true } } },
      }),
      db.payslip.findMany({ where: { teacherId }, orderBy: { month: "desc" } }),
    ]);
    if (!teacher) throw fail(400, "No teacher profile is linked to this account.");

    return ok({
      role: "TEACHER" as const,
      teacher: {
        name: teacher.user.name, designation: teacher.designation,
        employeeCode: teacher.employeeCode, gross: teacher.monthlySalary,
      },
      payslips: payslips.map((p) => ({
        id: p.id, month: p.month, gross: p.gross, deductions: p.deductions, net: p.net,
        status: p.status, paidOn: p.paidOn,
        epf: epfFor(p.gross), pt: 200,
      })),
    });
  }

  throw fail(403, "Salary records are visible to the principal and teachers.");
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = processSchema.parse(await req.json().catch(() => ({})));

  const teachers = await db.teacher.findMany({
    where: { schoolId: user.schoolId, status: "ACTIVE" },
    select: { id: true, monthlySalary: true },
  });
  if (!teachers.length) throw fail(400, "No active teachers to process payslips for.");

  const existing = await db.payslip.findMany({
    where: { schoolId: user.schoolId, month: body.month },
    select: { teacherId: true },
  });
  const done = new Set(existing.map((e) => e.teacherId));
  const pending = teachers.filter((t) => !done.has(t.id));
  if (!pending.length) {
    return ok({ month: body.month, processed: 0, skipped: done.size, reason: "already-processed" });
  }

  await db.$transaction([
    ...pending.map((t) => {
      const gross = t.monthlySalary;
      const deductions = epfFor(gross) + 200;
      return db.payslip.create({
        data: {
          schoolId: user.schoolId, teacherId: t.id, month: body.month,
          gross, deductions, net: gross - deductions,
          status: "PAID", paidOn: new Date(),
        },
      });
    }),
    db.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Salary",
        detail: `${monthLabel(body.month)} payslips processed for ${pending.length} staff`,
      },
    }),
  ]);

  return ok({ month: body.month, processed: pending.length, skipped: done.size });
});
