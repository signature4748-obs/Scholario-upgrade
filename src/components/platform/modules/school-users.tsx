'use client'

// ============================================================
// SchoolUsersTab — school workspace · Users & Access tab
// ------------------------------------------------------------
// Tenant-scoped user administration roster: who holds an account on
// THIS school, with role, account status, credential state, lock
// state and last sign-in — DB-derived, never fabricated.
//
// READ-ONLY by design (mission §9): status changes, credential
// re-issue and access resets each happen through their own audited
// routes (danger zone, Overview's re-issue credential, support
// sessions). Sensitive fields (password hashes) never leave the
// server; the API returns state words only.
//
// Data: GET /api/platform/schools/[id]/users (permission
// schools.read — the platform plane only).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Lock,
  RefreshCw,
  Search,
  UserCog,
  Users,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  status: string
  accountLocked: boolean
  credentialState: 'BOOTSTRAP_PENDING' | 'OWNED' | 'UNKNOWN'
  lastLoginAt: string | null
  createdAt: string
  liveSessions: number
}

interface UsersData {
  school: { id: string; name: string; slug: string; code: string; status: string }
  users: UserRow[]
  roleCounts: Record<string, number>
  liveSessions: number
  total: number
  page: number
  pageSize: number
}

const ROLE_FILTERS = ['ALL', 'PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'STUDENT', 'PARENT'] as const
const STATUS_FILTERS = ['ALL', 'ACTIVE', 'SUSPENDED', 'PENDING'] as const

const ROLE_STYLES: Record<string, string> = {
  PRINCIPAL: 'border-teal-200 bg-teal-50 text-teal-700',
  MANAGEMENT: 'border-sky-200 bg-sky-50 text-sky-700',
  TEACHER: 'border-violet-200 bg-violet-50 text-violet-700',
  STUDENT: 'border-slate-200 bg-slate-100 text-slate-600',
  PARENT: 'border-slate-200 bg-slate-50 text-slate-500',
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN')
}

export function SchoolUsersTab({ schoolId }: { schoolId: string }) {
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState<string>('ALL')
  const [status, setStatus] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<UsersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounced search (~300ms) → resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (role !== 'ALL') params.set('role', role)
      if (status !== 'ALL') params.set('status', status)
      params.set('page', String(page))
      const res = await platformApi<UsersData>(`/api/platform/schools/${schoolId}/users?${params.toString()}`)
      setData(res)
    } catch (e) {
      const pae = e as PlatformApiError
      setError(pae.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [schoolId, q, role, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4" aria-label="School users and access">
      {/* Role summary — DB-derived counts from the same endpoint */}
      {data && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Users by role">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700">
            <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {data.total} accounts
          </span>
          {Object.entries(data.roleCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([r, count]) => (
              <span
                key={r}
                className={`rounded-lg border px-2.5 py-1.5 text-xs tabular-nums ${ROLE_STYLES[r] ?? 'border-slate-200 bg-white text-slate-600'}`}
              >
                {r.toLowerCase()} {count}
              </span>
            ))}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {data.liveSessions} live session{data.liveSessions === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search school users"
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11 pl-9"
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by role" className="h-11 w-full sm:w-36 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-900">
            {ROLE_FILTERS.map((r) => (
              <SelectItem key={r} value={r} className="focus:bg-slate-100">
                {r === 'ALL' ? 'All roles' : r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by account status" className="h-11 w-full sm:w-36 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-900">
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s} className="focus:bg-slate-100">
                {s === 'ALL' ? 'All statuses' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh users list"
            className="h-11 w-11 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()} className="mt-3 h-9 border-slate-300 bg-white text-slate-700">
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Roster — table on sm+, cards below */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading || !data ? (
          <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading users">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-slate-200" />
            ))}
          </div>
        ) : data.users.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <UserCog className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900">No users match</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              {q || role !== 'ALL' || status !== 'ALL'
                ? 'Nothing matches the current search and filters — try clearing them.'
                : 'No user accounts exist for this school yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto custom-scrollbar">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-500 font-semibold h-11">User</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Role</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Status</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Credential</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Last sign-in</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Live sessions</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((u) => (
                    <TableRow key={u.id} className="border-slate-200 hover:bg-slate-50">
                      <TableCell className="max-w-[18rem] py-3">
                        <p className="truncate font-semibold text-slate-900">{u.name ?? '—'}</p>
                        <p className="truncate font-mono text-[11px] text-slate-500">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`normal-case ${ROLE_STYLES[u.role] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                          {u.role.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant="outline"
                            className={`normal-case ${
                              u.status === 'ACTIVE'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : u.status === 'SUSPENDED'
                                  ? 'border-red-200 bg-red-50 text-red-600'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {u.status}
                          </Badge>
                          {u.accountLocked && (
                            <span className="text-[10px] font-medium text-orange-600" title="Account-level subscription lock — distinct from tenant lifecycle">
                              account locked
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.credentialState === 'BOOTSTRAP_PENDING' ? (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700" title="One-time bootstrap credential not yet replaced — re-issue from the Overview tab">
                            bootstrap
                          </span>
                        ) : u.credentialState === 'OWNED' ? (
                          <span className="text-[11px] text-emerald-600" title="The user set their own password">
                            owned
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400" title="No forced-change flag and no recorded rotation">
                            unknown
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">{fmtRelative(u.lastLoginAt)}</TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">{u.liveSessions}</TableCell>
                      <TableCell className="text-slate-500" title={new Date(u.createdAt).toLocaleString()}>
                        {fmtRelative(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-200" aria-label="School users">
              {data.users.map((u) => (
                <div key={u.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{u.name ?? u.email}</p>
                    <Badge variant="outline" className={`normal-case shrink-0 ${ROLE_STYLES[u.role] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                      {u.role.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{u.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <Badge
                      variant="outline"
                      className={`normal-case ${
                        u.status === 'ACTIVE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : u.status === 'SUSPENDED'
                            ? 'border-red-200 bg-red-50 text-red-600'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {u.status}
                    </Badge>
                    {u.accountLocked && <span className="text-orange-600">account locked</span>}
                    {u.credentialState === 'BOOTSTRAP_PENDING' && <span className="text-amber-700">bootstrap credential pending</span>}
                    <span>· last sign-in {fmtRelative(u.lastLoginAt)}</span>
                    <span>· {u.liveSessions} live session{u.liveSessions === 1 ? '' : 's'}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {data.page} of {totalPages} · {data.total} user{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                >
                  <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                >
                  Next
                  <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Read-only roster — user lifecycle changes, credential re-issue and access resets each happen through their own
        audited routes (danger zone, Overview access card, support sessions). Platform-plane accounts are never listed
        here.
      </p>
    </div>
  )
}
