/**
 * PHASE 8B (§10/§25) — tenant domain DNS ownership verification.
 *
 * A hostname becomes VERIFIED only when the school proves ownership:
 * a DNS TXT record on `_scholario-verify.<hostname>` carrying the row's
 * verification token. Optionally the routing records are checked too
 * (CNAME → cname.vercel-dns.com for subdomains; A → 76.76.21.21 for
 * apex domains) so the platform can tell the school exactly what is
 * still missing. The DNS resolver is INJECTABLE for hermetic tests —
 * production uses node:dns/promises (Node runtime, works on Vercel).
 */

import { resolve4, resolveCname, resolveTxt } from 'node:dns/promises'

export interface DnsResolver {
  txt(name: string): Promise<string[][]>
  cname(name: string): Promise<string[]>
  a(name: string): Promise<string[]>
}

const nodeResolver: DnsResolver = {
  txt: (name) => resolveTxt(name).catch(() => []) as Promise<string[][]>,
  cname: (name) => resolveCname(name).catch(() => []) as Promise<string[]>,
  a: (name) => resolve4(name).catch(() => []) as Promise<string[]>,
}

/** TXT record name a school must create: `_scholario-verify.<hostname>`. */
export function verificationTxtName(hostname: string): string {
  return `_scholario-verify.${hostname}`
}

/** The exact TXT value string for a token. */
export function verificationTxtValue(token: string): string {
  return `scholario-verify=${token}`
}

/** DNS records the school points at the deployment (Vercel anycast). */
export const ROUTING_TARGETS = {
  cname: 'cname.vercel-dns.com',
  a: '76.76.21.21',
} as const

export interface VerificationOutcome {
  /** TXT ownership proof matched. */
  ownershipProven: boolean
  /** Hostname routes to the deployment (CNAME or A correct). */
  routingConfigured: boolean
  /** Human-readable summary for the onboarding UI (no secrets beyond the
   *  already-tenant-known token). */
  summary: string
}

/**
 * Verify one domain's DNS state. NEVER throws — DNS failure = records
 * missing (verification simply fails; the row stays PENDING).
 */
export async function verifyDomainDns(
  hostname: string,
  token: string,
  resolver: DnsResolver = nodeResolver,
): Promise<VerificationOutcome> {
  const txtName = verificationTxtName(hostname)
  const expected = verificationTxtValue(token)

  const [txtRecords, cnameRecords, aRecords] = await Promise.all([
    resolver.txt(txtName).catch(() => [] as string[][]),
    resolver.cname(hostname).catch(() => [] as string[]),
    resolver.a(hostname).catch(() => [] as string[]),
  ])

  const flat = txtRecords.flatMap((chunks) => chunks.map((c) => c.trim()))
  const ownershipProven = flat.some((v) => v === expected)

  const isApex = hostname.split('.').length <= 2
  const routingConfigured = isApex
    ? aRecords.some((ip) => ip === ROUTING_TARGETS.a)
    : cnameRecords.some((c) => c.toLowerCase() === ROUTING_TARGETS.cname) ||
      aRecords.some((ip) => ip === ROUTING_TARGETS.a)

  const missing: string[] = []
  if (!ownershipProven) missing.push(`TXT ${txtName} = "${expected}"`)
  if (!routingConfigured) {
    missing.push(
      isApex ? `A ${hostname} → ${ROUTING_TARGETS.a}` : `CNAME ${hostname} → ${ROUTING_TARGETS.cname}`,
    )
  }

  return {
    ownershipProven,
    routingConfigured,
    summary:
      missing.length === 0
        ? 'Verified: ownership TXT and routing records are correct.'
        : `Pending — still needed: ${missing.join(' ; ')}`,
  }
}
