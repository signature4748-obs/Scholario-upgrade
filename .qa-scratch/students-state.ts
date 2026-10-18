import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const classId = 'cmvd45c5g001rnek5d1l0i0de';
const students = await db.student.findMany({ where: { classId }, select: { id: true, rollNo: true, admissionNo: true, schoolId: true } });
const cls = await db.class.findUnique({ where: { id: classId }, select: { id: true, name: true, section: true, schoolId: true } });
const users = await db.user.findMany({ where: { email: { contains: 'qad56cap' } }, select: { id: true, email: true, role: true, status: true, schoolId: true } });
const orphanUsers = await db.user.findMany({ where: { role: 'STUDENT', schoolId: cls?.schoolId }, select: { id: true, email: true, createdAt: true } });
console.log(JSON.stringify({ cls, students, qaUsers: users, studentUsers: orphanUsers }, null, 1));
await db.$disconnect();
