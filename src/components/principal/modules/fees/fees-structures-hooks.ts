'use client'

/**
 * fees-structures-hooks — server-backed React hooks for the Fee Structures
 * admin (Phase 7-D wiring).
 *
 * THE CONTRACT (src/app/api/fees/structures/*):
 *   GET    /api/fees/structures?status=&classId=   → FeeStructureDTO[]
 *          (heads Decimal→number via num(), versions (take 5 in the list,
 *          ALL in the detail route), _count.transactions)
 *   POST   /api/fees/structures                    → DRAFT (classId FK
 *          validated in-tenant, catalogue FKs batch-validated, ≤60 heads,
 *          per-head zod amount 0..500000, one-current-per-class → 409)
 *   GET    /api/fees/structures/[id]               → full detail (all versions)
 *   PATCH  /api/fees/structures/[id]               → draft/archived ONLY
 *          (heads replacement = deleteMany+recreate in ONE transaction;
 *          current structures must be archived first)
 *   DELETE /api/fees/structures/[id]?reason=       → hard-delete for drafts,
 *          soft-archive (archivedAt + archivedReason) for others
 *   POST   /api/fees/structures/[id]/publish       → atomic promote
 *          draft/scheduled→current, archives the prior current
 *          (effectiveTo=now), version++, immutable FeeStructureVersion
 *          JSON snapshot; P2002 → 409.
 *
 * MONEY SAFETY — head amounts are STRINGS from the UI all the way to the
 * server zod (`z.coerce.number().finite().min(0).max(500000)`). The only
 * client-side Number() use is the range CHECK in parseAmountInput() —
 * never arithmetic, never a derived total. Display formatting happens in
 * the components (formatINRAmount), on server-emitted numbers only.
 *
 * Follows the codebase's canonical hook pattern (src/lib/exams/use-exams.ts)
 * and the canonical AppError-envelope fetch handling
 * (src/lib/exams/api-client.ts): success `{ ok: true, data }`, failure
 * `{ ok: false, error, code, requestId }` (src/lib/api.ts). 409 CONFLICT
 * and other server-authored publicMessages surface verbatim to callers.
 */

import { useState, useEffect, useCallback } from 'react'

// ─── Transport ─────────────────────────────────────────────────────────

/** Parsed AppError envelope — `message` is the server's publicMessage. */
export interface FeeApiError {
  message: string
  status?: number
  code?: string
}

async function feeApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`
    let code: string | undefined
    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>
      // AppError envelope: { ok:false, error, code, requestId }
      if (typeof obj.error === 'string') message = obj.error
      else if (typeof obj.message === 'string') message = obj.message
      if (typeof obj.code === 'string') code = obj.code
    } else if (typeof payload === 'string' && payload.trim().length > 0) {
      // Non-JSON error body (proxy/gateway pages) — never surface raw HTML.
      const snippet = payload.trim().replace(/\s+/g, ' ').slice(0, 120)
      message = `Request failed: ${res.status} ${res.statusText} — ${snippet}`
    }
    const err: FeeApiError = { message, status: res.status, code }
    throw err
  }
  // 2xx envelope: { ok: true, data }
  if (payload && typeof payload === 'object' && 'ok' in (payload as Record<string, unknown>)) {
    const obj = payload as { ok: boolean; data?: unknown; error?: string }
    if (obj.ok) return obj.data as T
    throw { message: obj.error ?? 'Unknown error', status: res.status } as FeeApiError
  }
  if (typeof payload === 'string' && payload.trim().startsWith('<')) {
    // HTML body on a 200 — the gateway answered for a dead/busy backend.
    throw {
      message: 'Service temporarily unavailable — please retry in a moment.',
      status: res.status,
    } as FeeApiError
  }
  return payload as T
}

function isFeeApiError(e: unknown): e is FeeApiError {
  return typeof e === 'object' && e !== null && 'message' in e
}

function errorMessage(e: unknown): string {
  if (isFeeApiError(e)) return e.message
  if (e instanceof Error) return e.message
  return 'Unexpected error'
}

// ─── DTOs (server shapes) ──────────────────────────────────────────────

export type FeeStructureStatus = 'draft' | 'current' | 'scheduled' | 'archived'

export interface FeeHeadDTO {
  id: string
  schoolId: string
  structureId: string
  /** Null = custom head typed by the principal (not in the catalogue). */
  catalogueId: string | null
  name: string
  category: string
  /** Server emits num(Decimal) — exact for 2-decimal NUMERIC values. */
  amount: number
  frequency: string
  mandatory: boolean
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Immutable publish snapshot — `snapshot` is a JSON string (heads already
 *  num()-normalized server-side). NEVER edited by any route. */
export interface FeeStructureVersionDTO {
  id: string
  schoolId: string
  structureId: string
  version: number
  snapshot: string
  publishedAt: string
  publishedBy: string | null
  notes: string | null
}

export interface FeeStructureDTO {
  id: string
  schoolId: string
  classId: string
  className: string
  classLevel: string
  status: FeeStructureStatus
  version: number
  effectiveFrom: string | null
  effectiveTo: string | null
  publishedAt: string | null
  archivedAt: string | null
  archivedReason: string | null
  createdAt: string
  updatedAt: string
  heads: FeeHeadDTO[]
  /** List route: take 5, version desc. Detail route: ALL versions. */
  versions: FeeStructureVersionDTO[]
  _count?: { transactions: number }
}

/** MasterFeeHead catalogue row (GET /api/fees/catalogue; amount via num()). */
export interface MasterFeeHeadDTO {
  id: string
  name: string
  category: string
  frequency: string
  amount: number
  mandatory: boolean
  active: boolean
  description: string | null
  sortOrder: number
  _count?: { structures: number }
}

/** GET /api/classes row — the school's REAL class registry (the POST route
 *  FK-validates classId in-tenant, so mock class ids would 404). */
export interface FeeClassDTO {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
  stream: string | null
}

/** Parsed FeeStructureVersion.snapshot JSON (immutable, display-only). */
export interface VersionSnapshotHead {
  id?: string
  catalogueId?: string | null
  name: string
  category?: string
  amount: number
  frequency?: string
  mandatory?: boolean
  active?: boolean
  sortOrder?: number
}

export interface VersionSnapshot {
  structureId?: string
  classId?: string
  className?: string
  classLevel?: string
  version?: number
  heads?: VersionSnapshotHead[]
  publishedAt?: string
}

export function parseVersionSnapshot(snapshot: string): VersionSnapshot | null {
  try {
    const v = JSON.parse(snapshot)
    return v && typeof v === 'object' ? (v as VersionSnapshot) : null
  } catch {
    return null
  }
}

// ─── Amount validation (STRING in → STRING out, no arithmetic) ─────────

/** Mirrors the server zod bound (z.coerce.number().min(0).max(500000)). */
export const MAX_HEAD_AMOUNT = 500000

/** Server cap — POST/PATCH both reject structures with more than 60 heads. */
export const MAX_HEADS = 60

/** Up to 7 integer digits + optional 2-decimal fraction. */
const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/

/**
 * Validate a user-typed amount string against the server contract:
 * required, digits with ≤2 decimals, 0 ≤ value ≤ 500000.
 *
 * The Number() call is a RANGE CHECK ONLY (exact for values this small —
 * no float arithmetic, no rounding, no derived totals); the validated
 * string is what travels to the server, where z.coerce.number() parses it.
 */
export function parseAmountInput(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = raw.trim()
  if (t === '') return { ok: false, error: 'Amount is required' }
  if (!AMOUNT_RE.test(t)) {
    return { ok: false, error: 'Enter a rupee amount with up to 2 decimals (e.g. 1250 or 125.50)' }
  }
  if (Number(t) > MAX_HEAD_AMOUNT) {
    return { ok: false, error: `Amount must be at most ${MAX_HEAD_AMOUNT}` }
  }
  return { ok: true, value: t }
}

// ─── Head payloads (POST / PATCH bodies) ───────────────────────────────

/**
 * One head as sent to POST /api/fees/structures and PATCH
 * /api/fees/structures/[id]. `amount` stays a STRING (server:
 * z.coerce.number()). catalogueId omitted/null = custom head.
 */
export interface FeeHeadInput {
  catalogueId?: string | null
  name: string
  category?: string
  amount: string
  frequency?: string
  mandatory?: boolean
  active?: boolean
}

export interface CreateFeeStructureInput {
  classId: string
  className: string
  classLevel?: string
  heads: FeeHeadInput[]
}

export interface UpdateFeeStructureDraftInput {
  heads?: FeeHeadInput[]
  className?: string
  classLevel?: string
}

// ─── List hook ─────────────────────────────────────────────────────────

export interface UseFeeStructuresParams {
  /** 'all' (default) omits the query param; otherwise ?status=<value>. */
  status?: FeeStructureStatus | 'all'
  classId?: string
}

export function useFeeStructures(params: UseFeeStructuresParams = {}) {
  const { status = 'all', classId } = params
  const [structures, setStructures] = useState<FeeStructureDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = new URLSearchParams()
    if (status && status !== 'all') qs.set('status', status)
    if (classId) qs.set('classId', classId)
    const q = qs.toString()
    feeApi<FeeStructureDTO[]>(`/api/fees/structures${q ? `?${q}` : ''}`)
      .then((rows) => {
        if (cancelled) return
        setStructures(Array.isArray(rows) ? rows : [])
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setStructures([])
        setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, classId, reloadKey])

  return { structures, loading, error, reload }
}

// ─── Detail hook (full structure + ALL versions) ───────────────────────

export function useFeeStructureDetail(id: string | null) {
  const [structure, setStructure] = useState<FeeStructureDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!id) {
      setStructure(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    feeApi<FeeStructureDTO>(`/api/fees/structures/${id}`)
      .then((d) => {
        if (cancelled) return
        setStructure(d)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setStructure(null)
        setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  return { structure, loading, error, reload }
}

// ─── Mutations ─────────────────────────────────────────────────────────

/** POST /api/fees/structures — creates a DRAFT. 409 when a current
 *  structure already exists for the class. */
export function useCreateFeeStructure() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useCallback(async (input: CreateFeeStructureInput): Promise<FeeStructureDTO> => {
    setLoading(true)
    try {
      const result = await feeApi<FeeStructureDTO>('/api/fees/structures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      setError(null)
      return result
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { create, loading, error }
}

/** PATCH /api/fees/structures/[id] — draft/archived ONLY (server rejects
 *  current structures). Replaces heads atomically when provided. */
export function useUpdateFeeStructureDraft() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = useCallback(async (id: string, input: UpdateFeeStructureDraftInput): Promise<FeeStructureDTO> => {
    setLoading(true)
    try {
      const result = await feeApi<FeeStructureDTO>(`/api/fees/structures/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      setError(null)
      return result
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { update, loading, error }
}

/** POST /api/fees/structures/[id]/publish — atomic promote
 *  draft/scheduled→current; prior current archived + versioned. */
export function usePublishFeeStructure() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const publish = useCallback(async (id: string): Promise<FeeStructureDTO> => {
    setLoading(true)
    try {
      const result = await feeApi<FeeStructureDTO>(`/api/fees/structures/${id}/publish`, {
        method: 'POST',
      })
      setError(null)
      return result
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { publish, loading, error }
}

/** DELETE /api/fees/structures/[id]?reason= — non-drafts are ARCHIVED with
 *  the reason (server soft-delete); drafts are hard-deleted. */
export function useArchiveStructure() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archive = useCallback(async (id: string, reason: string): Promise<{ ok: boolean; archived?: boolean; deleted?: boolean }> => {
    setLoading(true)
    try {
      const result = await feeApi<{ ok: boolean; archived?: boolean; deleted?: boolean }>(
        `/api/fees/structures/${id}?reason=${encodeURIComponent(reason)}`,
        { method: 'DELETE' },
      )
      setError(null)
      return result
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { archive, loading, error }
}

/** DELETE /api/fees/structures/[id] for DRAFT structures (hard delete). */
export function useDeleteDraft() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = useCallback(async (id: string): Promise<{ ok: boolean; deleted?: boolean }> => {
    setLoading(true)
    try {
      const result = await feeApi<{ ok: boolean; deleted?: boolean }>(`/api/fees/structures/${id}`, {
        method: 'DELETE',
      })
      setError(null)
      return result
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { remove, loading, error }
}

// ─── Create-flow sources ───────────────────────────────────────────────

/** The school's real class registry — POST FK-validates classId in-tenant,
 *  so this MUST come from /api/classes (never the mock ACADEMIC_CLASSES). */
export function useFeeClasses() {
  const [classes, setClasses] = useState<FeeClassDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    feeApi<FeeClassDTO[]>('/api/classes')
      .then((rows) => {
        if (cancelled) return
        setClasses(Array.isArray(rows) ? rows : [])
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setClasses([])
        setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return { classes, loading, error, reload }
}

/** Master fee-head catalogue (optional when adding heads — a custom name
 *  with no catalogueId is always allowed by the POST/PATCH contract). */
export function useFeeCatalogue() {
  const [catalogue, setCatalogue] = useState<MasterFeeHeadDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    feeApi<MasterFeeHeadDTO[]>('/api/fees/catalogue')
      .then((rows) => {
        if (cancelled) return
        setCatalogue(Array.isArray(rows) ? rows : [])
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setCatalogue([])
        setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return { catalogue, loading, error, reload }
}
