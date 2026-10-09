import { db } from "@/lib/db";
import { verifyPassword, createSession, SESSION_COOKIE } from "@/lib/auth";
import { fail, ok, route } from "@/lib/api";

export const POST = route(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return fail(400, "Enter your email and password.");

  const user = await db.user.findUnique({
    where: { email },
    include: { school: { select: { status: true, name: true } } },
  });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return fail(401, "That email and password combination doesn't match our records.");
  }
  if (user.status !== "ACTIVE") {
    return fail(403, "This account is suspended. Please contact the school office.");
  }
  if (user.school.status !== "ACTIVE") {
    return fail(403, "This school account is not active.");
  }

  const token = await createSession(user.id);
  const res = ok({
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
    school: { slug: user.school.name },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 86400,
  });
  return res;
});
