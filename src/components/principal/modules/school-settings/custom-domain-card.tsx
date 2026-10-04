'use client'

/**
 * SaaS-HARDENING (§4) — read-only domain STATUS card for school settings.
 *
 * Custom-domain management is platform-owned infrastructure: a principal
 * must NOT see or manage DNS records, verification tokens, CNAME/TXT
 * configuration or routing targets. This card shows only the simple
 * connection status of the school's website domains (the honest signal
 * the principal needs) plus the route to request changes (contact
 * SCHOLARIO support — the platform team configures and verifies).
 *
 * Server-backed through GET /api/school/domains (read-only projection —
 * the API no longer returns tokens or DNS instructions at all).
 */

import { useEffect, useState } from 'react'
import { Globe, RefreshCw, ShieldCheck, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

interface DomainRow {
  id: string
  hostname: string
  isPrimary: boolean
  status: string
  lastCheckedAt: string | null
  verifiedAt: string | null
  createdAt: string
}

interface Envelope<T> {
  ok: boolean
  error?: string
  data?: T
}

export function CustomDomainCard() {
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/school/domains', { cache: 'no-store' })
      const env = ((await r.json().catch(() => null)) as Envelope<{ domains: DomainRow[]; note?: string }> | null)
      if (env?.ok && env.data) {
        setDomains(env.data.domains)
        setNote(env.data.note ?? null)
      } else {
        setError(env?.error ?? 'Could not load domain status.')
      }
    } catch {
      setError('Could not load domain status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Globe className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">School website domain</h3>
            <p className="text-xs text-muted-foreground">
              Connection status of your school website address
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="Refresh domain status">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive text-xs p-3" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : domains === null ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : domains.length === 0 ? (
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 text-muted-foreground text-xs p-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            No custom domain connected yet. Your school website is served on its
            SCHOLARIO address. Contact SCHOLARIO support to connect your own domain
            (e.g. www.yourschool.com) — the platform team configures and verifies it.
          </span>
        </div>
      ) : (
        <ul className="space-y-2">
          {domains.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{d.hostname}</p>
                <p className="text-xs text-muted-foreground">
                  {d.status === 'VERIFIED'
                    ? `Connected${d.verifiedAt ? ` since ${new Date(d.verifiedAt).toLocaleDateString()}` : ''}`
                    : 'Connection in progress — the platform team is verifying it'}
                  {d.isPrimary ? ' · primary' : ''}
                </p>
              </div>
              <Badge
                variant={d.status === 'VERIFIED' ? 'default' : 'secondary'}
                className="gap-1 shrink-0"
              >
                {d.status === 'VERIFIED' ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {d.status === 'VERIFIED' ? 'Connected' : d.status.toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
          {note}
        </p>
      )}
    </div>
  )
}
