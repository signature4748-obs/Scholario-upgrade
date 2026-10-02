/**
 * PHASE 8B (§10/§11) — canonical hostname handling for the multi-tenant
 * custom-domain architecture.
 *
 * SECURITY CONTRACT
 * -----------------
 * Tenant resolution must never trust an arbitrary Host header. Hostnames
 * are normalized to ONE canonical form before storage AND before lookup
 * (lowercase; no protocol; no port; no trailing dot; no leading "www."),
 * and only well-formed PUBLIC hostnames are ever accepted as tenant
 * domains (see isValidPublicHostname). A hostname maps to exactly one
 * tenant — enforced by the global UNIQUE constraint on TenantDomain.hostname
 * — so cross-tenant collisions and duplicate domains are structurally
 * impossible, and a malicious Host-header value can only ever fail to
 * resolve (never select another tenant).
 */

/** Hostnames that can never be tenant domains (deployment/platform-owned or local). */
const BLOCKED_SUFFIXES = [
  '.vercel.app',
  '.vercel.dev',
  '.supabase.co',
  '.supabase.in',
  '.localhost',
  '.local',
  '.internal',
  '.test',
  '.invalid',
  '.example',
] as const

const BLOCKED_EXACT = new Set([
  'localhost',
  'scholario.com',
  'scholario.io',
  'scholario.cloud',
  'scholario.app',
])

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const LABEL_MAX = 63
const HOST_MAX = 253
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Normalize any host-ish input to the canonical tenant-domain form:
 * lowercase → strip protocol/path (if a full URL was supplied) → strip
 * port → strip trailing dots → strip a leading "www.".
 * Returns null for empty/garbage input.
 */
export function normalizeHostname(raw: string | null | undefined): string | null {
  if (!raw) return null
  let host = String(raw).trim().toLowerCase()
  if (!host) return null
  // Accept a full URL by accident — parse out the host.
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      return null
    }
  }
  // Strip path/query fragments, port, and trailing dots.
  host = host.split('/')[0].split('?')[0].split(':')[0].replace(/\.+$/, '')
  if (!host) return null
  // Canonical form stores the bare registrable host; "www.school.com" and
  // "school.com" are the same site.
  if (host.startsWith('www.')) host = host.slice(4)
  return host || null
}

/** True when the host is a sandbox/dev host that must never resolve a tenant. */
export function isSandboxHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    IP_RE.test(host)
  )
}

/**
 * Validation gate for ACCEPTING a hostname as a tenant domain (storage):
 * well-formed public DNS name, ≥2 labels, sane lengths, not an IP, not a
 * sandbox/platform/deployment host, not a platform-reserved name.
 * Returns an error string (rejection reason) or null when valid.
 */
export function hostnameRejectionReason(hostname: string): string | null {
  if (!hostname) return 'hostname is empty'
  if (hostname.length > HOST_MAX) return `hostname longer than ${HOST_MAX} characters`
  // Reserved names FIRST — clearer than the generic well-formed error.
  if (BLOCKED_EXACT.has(hostname)) return 'this hostname is reserved by the platform'
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return `${suffix} hosts belong to the deployment, not to a school`
    }
  }
  if (IP_RE.test(hostname)) return 'IP addresses are not supported — use a DNS name'
  if (!HOSTNAME_RE.test(hostname)) return 'hostname is not a well-formed DNS name (a-z, 0-9, hyphens, dots)'
  if (!hostname.includes('.')) return 'hostname must include at least one dot (a public domain)'
  for (const label of hostname.split('.')) {
    if (label.length > LABEL_MAX) return `hostname label longer than ${LABEL_MAX} characters`
    if (label.startsWith('-') || label.endsWith('-')) return 'hostname labels cannot start or end with a hyphen'
  }
  if (BLOCKED_EXACT.has(hostname)) return 'this hostname is reserved by the platform'
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return `${suffix} hosts belong to the deployment, not to a school`
    }
  }
  return null
}

/** Validated convenience wrapper (normalize → reject-reason null check). */
export function isValidPublicHostname(hostname: string): boolean {
  return hostnameRejectionReason(hostname) === null
}
