/** Client-safe formatting helpers — Indian school conventions. */

export function inr(amount: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) {
    if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(amount % 10000000 === 0 ? 0 : 2)} Cr`;
    if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(amount % 100000 === 0 ? 0 : 2)} L`;
    if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(0)}k`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "09 Oct 2026" */
export function fmtDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")) : iso;
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Fri, 09 Oct" */
export function fmtDayDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")) : iso;
  if (isNaN(d.getTime())) return "—";
  return `${DAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

/** "09 Oct, 10:42 AM" */
export function fmtDateTime(dt: string | Date): string {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (isNaN(d.getTime())) return "—";
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}, ${h12}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}

/** "a min ago" style relative time */
export function timeAgo(dt: string | Date): string {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return fmtDate(d);
}

export const DAYS_FULL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYS_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function gradeFor(pct: number): string {
  if (pct >= 91) return "A1";
  if (pct >= 81) return "A2";
  if (pct >= 71) return "B1";
  if (pct >= 61) return "B2";
  if (pct >= 51) return "C1";
  if (pct >= 41) return "C2";
  if (pct >= 35) return "D";
  if (pct >= 33) return "E";
  return "F";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Deterministic pastel-ish avatar tint from a string. */
export function avatarTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `oklch(0.9 0.045 ${hue})`;
}
