'use client'

/**
 * ServerFeeStep — the Fee step of the admission wizard for the
 * SERVER-ISSUED workflow (FEE-ADMISSIONS MVP, Phase F; rendered only
 * while the `admissionsServerIssuance` flag is ON).
 *
 * The legacy FeeStructureStep derives amounts from local school
 * settings. This step instead asks the SERVER quote engine
 * (POST /api/fees/quote) for the published fee structure that applies
 * to the chosen class + the school's canonical academic year, and lets
 * the principal make the EXPLICIT selections the engine validates:
 *   · FIXED heads           — always applied (display only)
 *   · OPTIONAL heads        — explicit toggle
 *   · QUANTITY heads        — explicit count (1..99; mandatory
 *                             quantity heads cannot be left unset)
 *   · discount              — one configured rule, or none
 * Every amount shown comes from the server response — the client never
 * computes or falls back on a fee figure. Missing configuration fails
 * closed (FEE_CONFIGURATION_REQUIRED is displayed, the selections stay
 * empty, and enrolment will refuse to run until a structure is
 * published — the server enforces the same fail-closed rule).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { formatINR } from '@/lib/format'
import { toast } from 'sonner'
import {
  fetchServerQuote,
  type QuoteSelections,
  type ServerQuoteResponse,
} from '../lib/server-admissions-client'
import { fetchSchoolClasses, matchServerClass } from '../lib/server-classes'

interface ServerFeeStepProps {
  className: string
  section: string
  /** Server Class id resolved for the wizard's className (cached in FormData). */
  classId?: string
  selections?: QuoteSelections
  onClassIdResolved: (classId: string | undefined) => void
  onChangeSelections: (selections: QuoteSelections) => void
}

interface DiscountRule {
  id: string
  code: string
  name: string
  type: 'PERCENT' | 'FLAT'
  value: number
  active: boolean
}

const MAX_QUANTITY = 99

export function ServerFeeStep({
  className,
  section,
  classId,
  selections,
  onClassIdResolved,
  onChangeSelections,
}: ServerFeeStepProps) {
  const [resolvedClassId, setResolvedClassId] = useState<string | undefined>(classId)
  const [classesLoading, setClassesLoading] = useState(false)
  const [classesError, setClassesError] = useState<string | null>(null)
  const [quote, setQuote] = useState<ServerQuoteResponse | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([])
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const quoteSeq = useRef(0)

  // ── resolve the wizard's className → server Class id ──────────────
  useEffect(() => {
    if (!className.trim()) {
      setResolvedClassId(undefined)
      onClassIdResolved(undefined)
      return
    }
    let cancelled = false
    setClassesLoading(true)
    setClassesError(null)
    ;(async () => {
      try {
        const classes = await fetchSchoolClasses()
        if (cancelled) return
        const id = matchServerClass(classes, className, section)
        setResolvedClassId(id || undefined)
        onClassIdResolved(id || undefined)
      } catch (e) {
        if (!cancelled) setClassesError(e instanceof Error ? e.message : 'Could not load classes.')
      } finally {
        if (!cancelled) setClassesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // className/section identity only — re-running on every keystroke of
    // another field would refetch unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, section])

  // ── load the school's configured discount rules (advisory list) ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/fees/discount-rules', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: DiscountRule[] }
          | null
        if (!cancelled && res.ok && json?.ok && Array.isArray(json.data)) {
          setDiscountRules(json.data.filter((r) => r.active))
        }
      } catch {
        // advisory only — the quote engine validates codes server-side
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── the server quote (recomputed on class/selection change) ──────
  const fetchQuote = useCallback(
    async (forClassId: string, sel: QuoteSelections | undefined) => {
      const seq = ++quoteSeq.current
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const res = await fetchServerQuote(forClassId, sel)
        if (seq !== quoteSeq.current) return
        setQuote(res)
      } catch (e) {
        if (seq !== quoteSeq.current) return
        setQuote(null)
        setQuoteError(e instanceof Error ? e.message : 'The fee quote could not be loaded.')
      } finally {
        if (seq === quoteSeq.current) setQuoteLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!resolvedClassId) {
      setQuote(null)
      setQuoteError(null)
      return
    }
    void fetchQuote(resolvedClassId, selections)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedClassId])

  // ── selection mutations (each re-quotes the server) ──────────────
  const updateSelections = (next: QuoteSelections) => {
    onChangeSelections(next)
    if (resolvedClassId) void fetchQuote(resolvedClassId, next)
  }

  const toggleOptional = (headId: string, on: boolean) => {
    const current = selections?.optionalHeadIds ?? []
    const next = on ? [...current, headId] : current.filter((id) => id !== headId)
    updateSelections({ ...selections, optionalHeadIds: next.length ? next : undefined })
  }

  const setQuantity = (headId: string, raw: string) => {
    setQuantityDrafts((prev) => ({ ...prev, [headId]: raw }))
    const n = Number(raw)
    if (raw !== '' && (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY)) return
    const quantities = { ...(selections?.quantities ?? {}) }
    if (raw === '') delete quantities[headId]
    else quantities[headId] = n
    updateSelections({
      ...selections,
      quantities: Object.keys(quantities).length ? quantities : undefined,
    })
  }

  const setDiscount = (code: string) => {
    updateSelections({ ...selections, discountCode: code === 'NONE' ? undefined : code })
  }

  const retry = () => {
    if (resolvedClassId) void fetchQuote(resolvedClassId, selections)
    else toast.error('Choose a class first — the fee quote needs a matching class.')
  }

  const heads = useMemo(() => quote?.selectableHeads ?? [], [quote])
  const fixedHeads = useMemo(() => heads.filter((h) => h.kind === 'FIXED'), [heads])
  const optionalHeads = useMemo(() => heads.filter((h) => h.kind === 'OPTIONAL'), [heads])
  const quantityHeads = useMemo(() => heads.filter((h) => h.kind === 'QUANTITY'), [heads])
  const q = quote?.quote
  const selectedOptional = new Set(selections?.optionalHeadIds ?? [])

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-foreground">Fee Structure (Server-Verified)</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Amounts come from the school&apos;s <strong>published fee structure</strong> for{' '}
          <strong>{className || 'the selected class'}</strong>
          {quote ? (
            <>
              {' '}· Academic Year <strong>{quote.academicYear}</strong> · Structure v
              <strong>{quote.structureVersion}</strong>
            </>
          ) : null}
          . Every figure is computed by the server — nothing here is editable.
        </p>
      </div>

      {/* Class resolution status */}
      {classesLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Matching the class on the server…
        </div>
      )}
      {classesError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>{classesError} The class can still be set at enrolment.</p>
        </div>
      )}
      {!classesLoading && !classesError && className && !resolvedClassId && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          No single server class matches &ldquo;{className}
          {section ? ` · ${section}` : ''}&rdquo; — the fee quote needs an unambiguous class. Adjust the class in
          the Applying-For step or set it at enrolment.
        </div>
      )}

      {/* Quote failure — fail-closed, never a client-side fallback amount */}
      {quoteError && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 break-words">{quoteError}</p>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={retry} className="h-8 gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </Button>
          </div>
        </div>
      )}

      {quoteLoading && !quoteError && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Computing the fee quote on the server…
        </div>
      )}

      {q && (
        <>
          {/* Applied heads */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Applied Fee Heads
            </h4>
            {fixedHeads.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-foreground">{h.name}</span>
                  <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                    {h.category} · {h.frequency} · fixed
                  </span>
                </div>
                <span className="font-mono font-semibold">{formatINR(h.unitAmount)}</span>
              </div>
            ))}
            {q.lineItems
              .filter((li) => li.kind === 'QUANTITY')
              .map((li) => (
                <div
                  key={li.headId}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-foreground">{li.name}</span>
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                      × {li.quantity} @ {formatINR(li.unitAmount)}
                    </span>
                  </div>
                  <span className="font-mono font-semibold">{formatINR(li.amount)}</span>
                </div>
              ))}
          </div>

          {/* Optional heads */}
          {optionalHeads.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Optional Heads (select explicitly)
              </h4>
              {optionalHeads.map((h) => (
                <label
                  key={h.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedOptional.has(h.id)}
                      onChange={(e) => toggleOptional(h.id, e.target.checked)}
                      className="h-4 w-4 accent-emerald-600"
                      aria-label={`Include ${h.name}`}
                    />
                    <div>
                      <span className="font-semibold text-foreground">{h.name}</span>
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                        {h.category} · {h.frequency}
                      </span>
                    </div>
                  </div>
                  <span className="font-mono font-semibold">{formatINR(h.unitAmount)}</span>
                </label>
              ))}
            </div>
          )}

          {/* Quantity heads */}
          {quantityHeads.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Quantity Heads
              </h4>
              {quantityHeads.map((h) => {
                const selectedQty = selections?.quantities?.[h.id]
                return (
                  <div key={h.id} className="rounded-lg border px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-semibold text-foreground">{h.name}</span>
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          {h.category} · {h.mandatory ? 'required count' : 'optional'} · {formatINR(h.unitAmount)} each
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`qty-${h.id}`} className="sr-only">
                          Quantity for {h.name}
                        </Label>
                        <Input
                          id={`qty-${h.id}`}
                          type="number"
                          min={1}
                          max={MAX_QUANTITY}
                          inputMode="numeric"
                          value={quantityDrafts[h.id] ?? (selectedQty !== undefined ? String(selectedQty) : '')}
                          onChange={(e) => setQuantity(h.id, e.target.value)}
                          placeholder="0"
                          className="h-8 w-20 text-right"
                          aria-describedby={h.mandatory ? `qty-req-${h.id}` : undefined}
                        />
                      </div>
                    </div>
                    {h.mandatory && selectedQty === undefined && (
                      <p id={`qty-req-${h.id}`} className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        A count is required before this application can be enrolled.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Discount */}
          {discountRules.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Concession (one rule, never stacked)
              </h4>
              <Select
                value={selections?.discountCode ?? 'NONE'}
                onValueChange={setDiscount}
              >
                <SelectTrigger className="h-9 text-xs" aria-label="Concession rule">
                  <SelectValue placeholder="No concession" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No concession</SelectItem>
                  {discountRules.map((r) => (
                    <SelectItem key={r.id} value={r.code}>
                      {r.name} ({r.type === 'PERCENT' ? `${r.value}%` : formatINR(r.value)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                The server applies the rule only to its eligible fee heads and validates eligibility — an
                ineligible rule is rejected, never silently ignored.
              </p>
            </div>
          )}

          {/* Totals — server-computed */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross (all selected heads)</span>
              <span className="font-mono font-semibold">{formatINR(q.totals.gross)}</span>
            </div>
            {q.discount && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Concession — {q.discount.name}</span>
                <span className="font-mono font-semibold">- {formatINR(q.totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1.5 text-sm font-extrabold">
              <span>Net Payable</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-300">
                {formatINR(q.totals.net)}
              </span>
            </div>
            <p className="pt-1 text-[10px] text-muted-foreground">
              The amounts on the official admission letter and fee receipt are finalized from the
              server&apos;s immutable fee snapshot at enrolment.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
