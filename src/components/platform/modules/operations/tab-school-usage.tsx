'use client'

// ============================================================
// Platform Operations — School-wise Usage tab
// ------------------------------------------------------------
// Fair metering: per-school APP-MEASURED metrics (logins, API
// operations, emails, uploads, active users) with date-range filter
// and per-school drill-down. The attribution note is part of the API
// contract — shared provider usage is never falsely attributed.
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../../platform-client'
import {
  OPS_CARD,
  OpsEmptyState,
  OpsErrorState,
  formatBytes,
  formatNumber,
} from './shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
} from 'recharts'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } as const

interface UsageRow {
  schoolId: string
  schoolName: string | null
  schoolStatus: string | null
  apiOperations: number
  activeUsers: number
  dau: number
  mau: number
  logins: number
  failedLogins: number
  loginLockouts: number
  emailsAttempted: number
  emailsAccepted: number
  emailsFailed: number
  emailsDelivered: number
  uploads: number
  uploadBytes: number
}

interface SchoolUsageData {
  window: { from: string; to: string; days: number }
  schoolId: string | null
  schoolMeta: { name: string; status: string; plan: string | null } | null
  rows: UsageRow[]
  series: Array<{ date: string; apiOperations: number }>
  attributionNote: string
  definitions: Record<string, string>
}

export function SchoolUsageTab({ refreshKey }: { refreshKey: number }) {
  const [days, setDays] = useState('7')
  const [schoolId, setSchoolId] = useState<string>('')
  const [data, setData] = useState<SchoolUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ days })
      if (schoolId) p.set('schoolId', schoolId)
      const d = await platformApi<SchoolUsageData>(`/api/platform/operations/school-usage?${p.toString()}`)
      setData(d)
    } catch (e) {
      setError((e as PlatformApiError).error || 'Failed to load school usage')
    } finally {
      setLoading(false)
    }
  }, [days, schoolId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const chartData = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => r.apiOperations > 0)
        .slice(0, 12)
        .map((r) => ({
          name: r.schoolName ?? r.schoolId.slice(0, 8),
          ops: r.apiOperations,
        })),
    [data],
  )

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={OPS_CARD}>
              <Skeleton className="h-3 w-24 bg-slate-200" />
              <Skeleton className="mt-3 h-8 w-16 bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (error) return <OpsErrorState message={error} onRetry={() => void load()} retrying={loading} />
  if (!data) return null

  return (
    <div className="space-y-5">
      {/* Filters + attribution note */}
      <div className={`${OPS_CARD} flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Date range
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-9 w-40 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Today (1 day)</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          School (all = cross-tenant aggregate)
          <Select
            value={schoolId || 'ALL'}
            onValueChange={(v) => setSchoolId(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-64 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All schools</SelectItem>
              {data.rows.map((r) => (
                <SelectItem key={r.schoolId} value={r.schoolId}>
                  {r.schoolName ?? r.schoolId.slice(0, 12)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button size="sm" onClick={() => void load()} className="h-9 bg-teal-600 text-white hover:bg-teal-700">
          Apply
        </Button>
      </div>

      <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
        {data.attributionNote}
      </p>

      {data.schoolId && data.schoolMeta ? (
        /* ── Drill-down view ── */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{data.schoolMeta.name}</h2>
            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
              {data.schoolMeta.status}
            </span>
            {data.schoolMeta.plan && (
              <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700">
                plan {data.schoolMeta.plan}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSchoolId('')}
              className="ml-auto h-7 text-xs text-slate-500 hover:bg-slate-100"
            >
              ← All schools
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(() => {
              const r = data.rows.find((x) => x.schoolId === data.schoolId)
              if (!r) return null
              const tiles: Array<{ label: string; value: string; hint: string }> = [
                { label: 'API operations', value: formatNumber(r.apiOperations), hint: 'window sum (metered)' },
                { label: 'Active users', value: formatNumber(r.activeUsers), hint: 'distinct users in window' },
                { label: 'MAU (30d)', value: formatNumber(r.mau), hint: 'distinct users, last 30 days' },
                { label: 'Uploads', value: formatNumber(r.uploads), hint: formatBytes(r.uploadBytes) },
                { label: 'Logins', value: formatNumber(r.logins), hint: 'successful (ActivityLog)' },
                { label: 'Failed logins', value: formatNumber(r.failedLogins), hint: 'window count' },
                { label: 'Emails attempted', value: formatNumber(r.emailsAttempted), hint: 'EmailDelivery rows' },
                {
                  label: 'Emails delivered',
                  value: formatNumber(r.emailsDelivered),
                  hint: `${formatNumber(r.emailsAccepted)} accepted-unconfirmed · ${formatNumber(r.emailsFailed)} failed`,
                },
              ]
              return tiles.map((t, i) => (
                <motion.div key={t.label} {...fadeUp} transition={{ delay: i * 0.02 }} className={OPS_CARD}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900">{t.value}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{t.hint}</p>
                </motion.div>
              ))
            })()}
          </div>
          {data.series.length > 0 ? (
            <div className={OPS_CARD}>
              <p className="mb-3 text-xs font-semibold text-slate-600">API operations per day</p>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                    <ChartTooltip
                      formatter={(v) => [formatNumber(Number(v)), 'API operations']}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar dataKey="apiOperations" fill="#0f766e" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <OpsEmptyState
              title="No API operations recorded in this window"
              hint="Metering starts counting from the deployment of the operations center — the chart populates as schools use the platform."
            />
          )}
        </div>
      ) : (
        /* ── Cross-tenant table ── */
        <>
          {chartData.length > 0 && (
            <div className={OPS_CARD}>
              <p className="mb-3 text-xs font-semibold text-slate-600">API operations by school (top 12, window sum)</p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <ChartTooltip
                      formatter={(v) => [formatNumber(Number(v)), 'API operations']}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar dataKey="ops" fill="#0f766e" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className={`${OPS_CARD} overflow-x-auto`}>
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-medium">School</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">API ops</th>
                  <th className="py-2 pr-3 font-medium">Active users</th>
                  <th className="py-2 pr-3 font-medium">MAU</th>
                  <th className="py-2 pr-3 font-medium">Logins</th>
                  <th className="py-2 pr-3 font-medium">Failed logins</th>
                  <th className="py-2 pr-3 font-medium">Emails sent</th>
                  <th className="py-2 pr-3 font-medium">Emails failed</th>
                  <th className="py-2 pr-3 font-medium">Uploads</th>
                  <th className="py-2 font-medium" aria-label="Drill-down" />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-4 text-center text-slate-500">
                      No schools in scope.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.schoolId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="max-w-48 truncate py-2 pr-3 font-medium text-slate-700">{r.schoolName ?? r.schoolId.slice(0, 10)}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            r.schoolStatus === 'ACTIVE'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : r.schoolStatus === 'SUSPENDED'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          {r.schoolStatus ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-700">{formatNumber(r.apiOperations)}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-slate-300" aria-hidden="true" />
                          {formatNumber(r.activeUsers)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{formatNumber(r.mau)}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{formatNumber(r.logins)}</td>
                      <td className={`py-2 pr-3 tabular-nums ${r.failedLogins > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {formatNumber(r.failedLogins)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{formatNumber(r.emailsDelivered)}</td>
                      <td className={`py-2 pr-3 tabular-nums ${r.emailsFailed > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        {formatNumber(r.emailsFailed)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{formatNumber(r.uploads)}</td>
                      <td className="py-2">
                        <button
                          onClick={() => {
                            setSchoolId(r.schoolId)
                            toast.info('Loading school drill-down…')
                          }}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-teal-700 hover:text-teal-800"
                        >
                          Details <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Definitions */}
      <details className={`${OPS_CARD} text-xs text-slate-500`}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Metric definitions & sources</summary>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(data.definitions).map(([k, v]) => (
            <li key={k}>
              <span className="font-mono text-[11px] text-slate-600">{k}</span> — {v}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
