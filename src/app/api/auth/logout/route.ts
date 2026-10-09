import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { ok, route } from "@/lib/api";

export const POST = route(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  const res = ok({ signedOut: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
