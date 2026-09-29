'use client'

/**
 * Schools (mock control plane · SaaS-STAGE-2A) — tenant ledger + selection.
 *
 * LIST: ledger-style table (School / Status / Current Session / Enabled
 * Modules / Users / Plan) — the exact column set the platform spec asks
 * for. Row click selects the tenant and swaps the content area into the
 * School Control Center (same content-swap pattern as the Fee Catalogue
 * view; shell/sidebar untouched, back preserves list state).
 *
 * All config reads come from useTenantStore configs[tenantId] — the Super
 * Admin edits ANY school, not just the active one.
 */

import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import { useTenantStore } from '@/lib/tenant/store'
import { TENANTS } from '@/lib/tenant/schools'
import { MODULE_CATALOG } from '@/lib/tenant/registry'
import type { TenantStatus } from '@/lib/tenant/types'
import { Panel } from '@/components/principal/modules/shared/panel'
import { cn } from '@/lib/utils'
import {
  TenantInitialsTile, TenantPlanChip, TenantStatusPill,
} from './tenant-badges'
import { SchoolControlCenter } from './school-control'

export interface SchoolsModuleProps {
  selectedTenantId: string | null
  onSelectTenant: (id: string | null) => void
}

const STATUS_FILTERS: Array<'all' | TenantStatus> = ['all', 'active', 'trial', 'suspended']

export function SchoolsModule({ selectedTenantId, onSelectTenant }: SchoolsModuleProps) {
  const configs = useTenantStore((s) => s.configs)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TenantStatus>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TENANTS
      .map((t) => ({ tenant: t, config: configs[t.id] ?? t.config }))
      .filter(({ tenant, config }) => {
        if (statusFilter !== 'all' && config.status !== statusFilter) return false
        if (!q) return true
        return (
          tenant.name.toLowerCase().includes(q) ||
          tenant.code.toLowerCase().includes(q) ||
          tenant.city.toLowerCase().includes(q)
        )
      })
  }, [configs, query, statusFilter])

  const selected = selectedTenantId ? TENANTS.find((t) => t.id === selectedTenantId) ?? null : null

  if (selected) {
    return <SchoolControlCenter tenantId={selected.id} onBack={() => onSelectTenant(null)} />
  }

  return (
    <div className="space-y-4">
      <div className="mb-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Schools</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {TENANTS.length} registered {TENANTS.length === 1 ? 'school' : 'schools'} — select a school to open its Control Center
        </p>
      </div>

      <Panel bodyClassName="p-0" heading={false}>
        {/* Toolbar: search + status filter */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border/40">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, code or city…"
              aria-label="Search schools"
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'h-7 px-2 rounded-md text-[11px] font-medium capitalize transition-colors',
                  statusFilter === s
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{rows.length} schools</span>
        </div>

        {/* Ledger table (desktop) / stacked cards (mobile) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
                <th className="px-3 py-2 font-semibold">School</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Current Session</th>
                <th className="px-3 py-2 font-semibold">Enabled Modules</th>
                <th className="px-3 py-2 font-semibold text-right">Users</th>
                <th className="px-3 py-2 font-semibold">Plan</th>
                <th className="px-3 py-2" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tenant, config }) => {
                const enabled = MODULE_CATALOG.filter((m) => config.features[m.key])
                const shown = enabled.slice(0, 3).map((m) => m.label)
                return (
                  <tr
                    key={tenant.id}
                    onClick={() => onSelectTenant(tenant.id)}
                    className="border-t border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TenantInitialsTile initials={tenant.initials} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{tenant.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{tenant.code} · {tenant.city}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><TenantStatusPill status={config.status} /></td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{tenant.session}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs font-semibold tabular-nums mr-1">{enabled.length}</span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                          {shown.join(' · ')}{enabled.length > 3 ? ` +${enabled.length - 3}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">{tenant.stats.users.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5"><TenantPlanChip plan={config.plan} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 ml-auto" aria-hidden />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {rows.map(({ tenant, config }) => {
            const enabled = MODULE_CATALOG.filter((m) => config.features[m.key])
            return (
              <button
                key={tenant.id}
                onClick={() => onSelectTenant(tenant.id)}
                className="w-full text-left px-3 py-3 border-t border-border/30 first:border-t-0 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <TenantInitialsTile initials={tenant.initials} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{tenant.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{tenant.code} · {tenant.city}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" aria-hidden />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <TenantStatusPill status={config.status} />
                  <TenantPlanChip plan={config.plan} />
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-muted text-muted-foreground ring-1 ring-border">
                    {tenant.session}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {enabled.length} modules · {tenant.stats.users.toLocaleString('en-IN')} users
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {rows.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-xs font-semibold text-muted-foreground">No schools match your filters</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">Adjust the search or status filter.</p>
          </div>
        )}
      </Panel>

      {/* Back helper for mobile users who landed via a deep state */}
      {selectedTenantId === null && (
        <button
          onClick={() => onSelectTenant(null)}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
      )}
    </div>
  )
}
