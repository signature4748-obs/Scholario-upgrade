/** Client-side DTOs (mirror of server session + API payloads). */

export type Role = "PRINCIPAL" | "TEACHER" | "STUDENT";

export interface SchoolDTO {
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
}

export interface MeDTO {
  id: string;
  schoolId: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  school: SchoolDTO;
  teacherId: string | null;
  studentId: string | null;
  studentClassId: string | null;
}

export interface ModuleCtx {
  me: MeDTO;
  /** navigate the hash router from within modules */
  go: (moduleId: string) => void;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data as T;
}
