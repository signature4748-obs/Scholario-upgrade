// Shared QA helper — NOT committed to git (scratch only)
export const BASE = process.env.QA_BASE ?? 'http://localhost:3000';
export const RUN = `qa${Date.now().toString(36).slice(-6)}`;

export interface Resp { status: number; body: any; }

async function resilientFetch(url: string, init: RequestInit): Promise<Response> {
  // Sandbox dev server periodically OOM-restarts (documented flake family);
  // in-flight connections die with ECONNRESET — retry once after respawn.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 2500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function api(path: string, init: RequestInit = {}, token?: string, supportToken?: string): Promise<Resp> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any ?? {}) };
  if (token) headers['x-platform-token'] = token;
  if (supportToken) headers['x-support-token'] = supportToken;
  const res = await resilientFetch(`${BASE}${path}`, { ...init, headers });
  let body: any = null;
  try { body = await res.json(); } catch { body = { raw: 'non-json' }; }
  return { status: res.status, body };
}

export async function platformLogin(email: string, password: string, ipSuffix?: string): Promise<{ token?: string; status: number; body: any }> {
  const ip = `10.207.${(Math.random()*250+1)|0}.${(Math.random()*250+1)|0}`;
  const r = await api('/api/platform/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  });
  return { token: r.body?.data?.sessionToken, status: r.status, body: r.body };
}

export async function schoolLogin(email: string, password: string): Promise<{ token?: string; cookie?: string; status: number; body: any }> {
  const ip = `10.223.${(Math.random()*250+1)|0}.${(Math.random()*250+1)|0}`;
  const res = await resilientFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  });
  let body: any = null; try { body = await res.json(); } catch {}
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/erp_session=([^;]+)/);
  return { token: body?.data?.sessionToken ?? body?.sessionToken, cookie: m?.[1] ? `erp_session=${m[1]}` : undefined, status: res.status, body };
}

export async function schoolApi(path: string, init: RequestInit = {}, auth?: { token?: string; cookie?: string }): Promise<Resp> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any ?? {}) };
  if (auth?.token) headers['authorization'] = `Bearer ${auth.token}`;
  if (auth?.cookie) headers['cookie'] = auth.cookie;
  const res = await resilientFetch(`${BASE}${path}`, { ...init, headers });
  let body: any = null; try { body = await res.json(); } catch { body = { raw: 'non-json' }; }
  return { status: res.status, body };
}

let pass = 0, fail = 0; const failures: string[] = [];
export function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail !== undefined ? '  :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
}
export function summary(label: string) {
  console.log(`\n=== ${label}: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
  if (fail > 0) process.exitCode = 1;
}
export function section(t: string) { console.log(`\n## ${t}`); }
// touch test 1792284860
