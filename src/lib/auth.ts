import { db } from "@/lib/db";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "scholario_session";
const SESSION_TTL_DAYS = 14;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface SessionUser {
  id: string;
  schoolId: string;
  name: string;
  email: string;
  role: "PRINCIPAL" | "TEACHER" | "STUDENT";
  status: string;
  school: {
    id: string;
    slug: string;
    name: string;
    code: string;
    shortName: string | null;
    tagline: string | null;
    city: string | null;
    academicYear: string;
    isDemo: boolean;
    principalName: string | null;
    established: string | null;
    board: string;
  };
  teacherId: string | null;
  studentId: string | null;
  studentClassId: string | null;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  await db.session.create({ data: { token, userId, expiresAt } });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { token } });
}

/** Resolve the session user with tenant + actor context. Null when absent/expired. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          school: true,
          teacher: { select: { id: true } },
          student: { select: { id: true, classId: true } },
        },
      },
    },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  const u = session.user;
  return {
    id: u.id,
    schoolId: u.schoolId,
    name: u.name,
    email: u.email,
    role: u.role as SessionUser["role"],
    status: u.status,
    school: {
      id: u.school.id,
      slug: u.school.slug,
      name: u.school.name,
      code: u.school.code,
      shortName: u.school.shortName,
      tagline: u.school.tagline,
      city: u.school.city,
      academicYear: u.school.academicYear,
      isDemo: u.school.isDemo,
      principalName: u.school.principalName,
      established: u.school.established,
      board: u.school.board,
    },
    teacherId: u.teacher?.id ?? null,
    studentId: u.student?.id ?? null,
    studentClassId: u.student?.classId ?? null,
  };
}
