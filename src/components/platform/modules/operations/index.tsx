'use client'

// ============================================================
// OperationsModule — the /platform/operations page (Task 2026-10)
// ------------------------------------------------------------
// The Super Admin Platform Operations center: six tabs (Overview ·
// Usage & Limits · Errors & Incidents · Service Health · School
// Usage · Audit & Diagnostics), permission-gated by ops.read (root
// admins hold it implicitly; the server re-authorizes every API —
// hiding the nav entry for non-holders is UX, not access control).
//
// Tab state rides the URL (?tab=…&fp=…) so drill-down links from the
// Overview deep-link correctly (e.g. /platform/operations?tab=errors).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react'
import { usePlatformSession } from '../../platform-client'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { scrollConsoleToTop } from '@/lib/platform/console-scroll'
import { OverviewTab } from './tab-overview'
import { UsageTab } from './tab-usage'
import { ErrorsTab } from './tab-errors'
import { HealthTab } from './tab-health'
import { SchoolUsageTab } from './tab-school-usage'
import { DiagnosticsTab } from './tab-diagnostics'

const VALID_TABS = ['overview', 'usage', 'errors', 'health', 'schools', 'diagnostics'] as const
type TabKey = (typeof VALID_TABS)[number]

export function OperationsModule() {
  const { can } = usePlatformSession()
  const canOps = can('ops.read')
  const params = useSearchParams()

  const initialTab = (params.get('tab') as TabKey | null) ?? null
  const [tab, setTab] = useState<TabKey>(
    initialTab && (VALID_TABS as readonly string[]).includes(initialTab) ? initialTab : 'overview',
  )
  const [refreshKey, setRefreshKey] = useState(0)

  // Deep-link (?fp=…) opens the error detail directly.
  const initialFp = params.get('fp')

  useEffect(() => {
    const t = params.get('tab') as TabKey | null
    if (t && (VALID_TABS as readonly string[]).includes(t) && t !== tab) {
      setTab(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const refreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  if (!canOps) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
            <ShieldCheck className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Platform Operations</h1>
            <p className="text-xs text-slate-500">Cross-tenant monitoring capability required</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          This section requires the <span className="font-mono text-xs">ops.read</span> platform capability. Root
          administrators hold it implicitly; any other admin needs an explicit grant (Users &amp; Access → permissions).
          The server enforces this on every request — the missing navigation entry is only a courtesy.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Platform Operations</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Observability · usage &amp; limits · error diagnosis · service health — real data only, honest
                unavailability everywhere else
              </p>
            </div>
          </div>
        </motion.div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Refresh all
        </Button>
      </div>

      {/* Tab switches land at the TOP of the new tab's content — the same
          contract as the school dossier (scrollConsoleToTop targets the
          shell's single content scroller; instant, never animated). */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabKey)
          scrollConsoleToTop()
        }}
        className="gap-4"
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 custom-scrollbar">
          <TabsTrigger
            value="overview"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="usage"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            Usage &amp; Limits
          </TabsTrigger>
          <TabsTrigger
            value="errors"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            Errors &amp; Incidents
          </TabsTrigger>
          <TabsTrigger
            value="health"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            Service Health
          </TabsTrigger>
          <TabsTrigger
            value="schools"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            School Usage
          </TabsTrigger>
          <TabsTrigger
            value="diagnostics"
            className="px-3 py-1.5 text-xs data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800"
          >
            Audit &amp; Diagnostics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="usage" className="mt-0">
          <UsageTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="errors" className="mt-0">
          <ErrorsTab refreshKey={refreshKey} initialFingerprint={initialFp} />
        </TabsContent>
        <TabsContent value="health" className="mt-0">
          <HealthTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="schools" className="mt-0">
          <SchoolUsageTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="diagnostics" className="mt-0">
          <DiagnosticsTab refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
