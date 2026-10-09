import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

/** Requires an active session; returns the session user or throws a 401 response. */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw fail(401, "Sign in to continue.");
  return user;
}

/** Requires one of the given school roles. Tenant always derives from the session. */
export async function requireRole(...roles: SessionUser["role"][]): Promise<SessionUser> {
  const user = await requireSession();
  if (!roles.includes(user.role)) {
    throw fail(403, "Your role does not have access to this resource.");
  }
  return user;
}

/** Wrap route handlers so thrown `fail()` responses become clean JSON errors. */
export function route(handler: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await handler(req, ctx);
    } catch (err: any) {
      if (err instanceof NextResponse) return err;
      console.error("[api]", err);
      return fail(500, "Something went wrong on our side. Please try again.");
    }
  };
}

export function isoToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
