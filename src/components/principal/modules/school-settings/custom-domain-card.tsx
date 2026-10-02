'use client'

/**
 * PHASE 8B (§25) — Custom Domain card for the school settings Identity
 * tab (principal-facing domain onboarding).
 *
 * Server-backed through /api/school/domains (GET list + instructions,
 * POST request, [domainId]/verify self-check DNS). The verification
 * token shown here is the SCHOOL'S OWN proof-of-ownership secret — the
 * principal configures the TXT record with it. Honest empty state; no
 * client fabrication; the platform control-plane remains the
 * administrative authority (it can add/verify/remove too).
 */

import { useCallback, useEffect, useState } from 'react'
import { Globe, RefreshCw, ShieldCheck, AlertTriangle, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface DomainRow {
  id: string
  hostname: string
  isPrimary: boolean
  status: string
  lastCheckResult: string | null
  verifiedAt: string | null
  createdAt: string
  instructions: {
    verificationTxt: { name: string; value: string }
    routing: { type: string; name: string; value: string }
    note: string
  }
}

interface Envelope<T> {
  ok: boolean
  error?: string
  data?: T
}

async function api<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  try {
    const r = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
    return ((await r.json().catch(() => null)) as Envelope<T> | null) ?? { ok: false, error: 'Unreadable server response' }
  } catch {
    return { ok: false, error: 'Server unreachable — check your connection and retry.' }
  }
}

export function CustomDomainCard() {
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newHostname, setNewHostname] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await api<{ domains: Domain[] }>('/api/school/domains')
    if (res.ok && res.data) setDomains(res.data.domains)
    else setLoadError(res.error ?? 'Domains could not be loaded.')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const request = async () => {
    setRequesting(true)
    setRequestError(null)
    const res = await api<{ domain: { hostname: string } }>('/api/school/domains', {
      method: 'POST',
      body: JSON.stringify({ hostname: newHostname.trim() }),
    })
    setRequesting(false)
    if (res.ok && res.data) {
      toast.success(`Domain ${res.data.domain.hostname} requested — configure the DNS records below, then verify.`)
      setNewHostname('')
      await load()
    } else {
      setRequestError(res.error ?? 'The domain could not be requested.')
    }
  }

  const verify = async (d: DomainRow) => {
    setBusy(d.id)
    const res = await api<{ summary?: string; alreadyVerified?: boolean }>(
      `/api/school/domains/${d.id}/verify`,
      { method: 'POST' },
    )
    setBusy(null)
    if (res.ok) {
      if (res.data?.summary?.startsWith('Pending')) {
        toast.error(res.data.summary)
      } else {
        toast.success(res.data?.summary ?? 'Verified.')
      }
      await load()
    } else {
      toast.error(res.error ?? 'Verification failed.')
    }
  }

  return (
    <section
      aria-label="Custom domain"
      className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4"
    >
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
          <Globe className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-foreground">Custom domain</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your school&apos;s own website address on Scholario — the public website, login portal
            and branding will serve on it once verified.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={newHostname}
          onChange={(e) => setNewHostname(e.target.value)}
          placeholder="your-school.com"
          aria-label="Your school domain"
          className="font-mono text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newHostname.trim().length >= 4 && !requesting) void request()
          }}
        />
        <Button
          size="sm"
          onClick={() => void request()}
          disabled={requesting || newHostname.trim().length < 4}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {requesting ? 'Requesting…' : 'Request domain'}
        </Button>
      </div>
      {requestError && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {requestError}
        </p>
      )}

      {domains === null && loadError === null && (
        <div className="space-y-2" aria-label="Loading domains">
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {loadError && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {loadError}
        </p>
      )}
      {domains !== null && domains.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No custom domain yet — request your school&apos;s domain above (for example{' '}
          <span className="font-mono">your-school.com</span>) and follow the DNS instructions.
        </p>
      )}

      <ul className="space-y-3" aria-label="Your domains">
        {domains?.map((d) => (
          <li key={d.id} className="rounded-lg border border-border p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-mono text-sm font-semibold text-foreground break-all">
                {d.hostname}
              </span>
              <span
                className={
                  d.status === 'VERIFIED'
                    ? 'inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300'
                    : 'inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300'
                }
              >
                {d.status === 'VERIFIED' ? (
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                )}
                {d.status === 'VERIFIED' ? 'Verified' : 'Pending DNS'}
              </span>
              {d.status !== 'VERIFIED' && (
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void verify(d)}
                    disabled={busy === d.id}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RefreshCw className={busy === d.id ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
                    {busy === d.id ? 'Checking DNS…' : 'Verify now'}
                  </Button>
                </span>
              )}
            </div>

            {d.lastCheckResult && d.status !== 'VERIFIED' && (
              <p className="text-[11px] text-muted-foreground">{d.lastCheckResult}</p>
            )}

            {d.status !== 'VERIFIED' && (
              <div>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 underline underline-offset-2"
                  aria-expanded={expanded === d.id}
                >
                  {expanded === d.id ? 'Hide DNS setup instructions' : 'Show DNS setup instructions'}
                </button>
                {expanded === d.id && (
                  <dl className="mt-2 grid gap-1.5 rounded-md bg-muted/60 p-3 text-xs" aria-label="DNS records to create">
                    <div className="grid grid-cols-[52px_1fr] items-baseline gap-x-2">
                      <dt className="font-mono font-bold text-emerald-700 dark:text-emerald-400">TXT</dt>
                      <dd className="font-mono break-all text-foreground">{d.instructions.verificationTxt.name}</dd>
                      <dt className="sr-only">TXT value</dt>
                      <dd className="font-mono break-all text-muted-foreground">{d.instructions.verificationTxt.value}</dd>
                    </div>
                    <div className="grid grid-cols-[52px_1fr] items-baseline gap-x-2 border-t border-border pt-1.5">
                      <dt className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{d.instructions.routing.type}</dt>
                      <dd className="font-mono break-all text-foreground">{d.instructions.routing.name}</dd>
                      <dt className="sr-only">value</dt>
                      <dd className="font-mono break-all text-muted-foreground">→ {d.instructions.routing.value}</dd>
                    </div>
                    <p className="border-t border-border pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {d.instructions.note}
                    </p>
                  </dl>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

type Domain = DomainRow
