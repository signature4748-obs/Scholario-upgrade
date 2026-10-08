'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeAccount, findStructureForStudent } from '@/lib/store/fee-store'
import { useFeeStore, type FeeTransaction, type StudentFeeAccount, type FeePaymentStatus } from '@/lib/store/fee-store'
import { useMyStudentRecord } from '@/lib/store/students-store'
import { useFeatureGate } from '@/lib/tenant/store'
// STRUCT-REV — mid-session fee-structure acknowledgement (student side).
import { FeeRevisionApprovalCard } from './fee-revision-card'
import { BalanceHero } from './balance-hero'
import { FeeStructure } from './fee-structure'
import { Statement } from './statement'
import { AllPaidState, OnlineUnavailableCard } from './paid-state'
import { PaymentDialog } from './payment-dialog'
import type { PaymentConfigResponse } from './data'

/**
 * FeesModule — the student's financial truth.
 *
 * 7-E — the DISPLAYED BALANCE is SERVER-DERIVED. The local computeAccount
 * engine (fee-store) still supplies the structure breakdown, concession
 * and late-fee policy context, but the money truth (outstanding / paid /
 * status) is read from the server's own canonical standing: the caller's
 * OWN row in GET /api/students/roster carries fees.totalBilled / totalPaid /
 * outstanding / status computed from the canonical Fee + FeeTransaction
 * rows — the exact ledger every server-verified payment path (webhook,
 * /api/student/payments/verify, sandbox confirm, office collections)
 * credits. Payments made ANYWHERE (office counter, another device, the
 * gateway) therefore reduce this balance; the persisted localStorage
 * fee-store is never the source of the displayed balance again.
 *
 * Receipts: server rows first (canonical history), live in-session mirrors
 * after — display-only for the receipts list. Online payment is THE path:
 * server-created order → gateway → SERVER-side signature verification →
 * server-minted receipt → notification. The browser is never trusted to
 * declare success.
 *
 * No big "My Fees" title renders here — the shell header + sidebar are
 * the single WHERE-AM-I (nav dedup rule).
 */

/** The server's canonical fee standing for THIS student (roster self row's
 * `fees` block — computed server-side from Fee + FeeTransaction rows). */
interface ServerFeeStanding {
  totalBilled: number
  totalPaid: number
  outstanding: number
  status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'NONE'
  awaitingVerification: number
}

/** Map the server standing's status onto the account display vocabulary. */
function serverStatusToDisplay(status: ServerFeeStanding['status']): FeePaymentStatus {
  switch (status) {
    case 'OVERDUE': return 'Overdue'
    case 'PARTIAL': return 'Partially Paid'
    case 'UNPAID': return 'Due'
    // NONE (no fee rows) / PAID — nothing outstanding.
    default: return 'Paid'
  }
}

export function FeesModule() {
  // Canonical identity — the session user's own roster record (server
  // sync stamps the userId/email link fields; the legacy demo record
  // covers the pre-sync paint). The guard below renders the loading
  // tile while the record resolves.
  const student = useMyStudentRecord()

  // Reactive slices of the ONE fee ledger — computeAccount re-derives the
  // entire account whenever any of them changes (a payment made here
  // counts immediately).
  const transactions = useFeeStore((s) => s.transactions)
  const lateFeeRule = useFeeStore((s) => s.lateFeeRule)
  const additionalCharges = useFeeStore((s) => s.additionalCharges)
  const concessions = useFeeStore((s) => s.concessions)
  const optionalHeadApplicability = useFeeStore((s) => s.optionalHeadApplicability)
  const receiptSettings = useFeeStore((s) => s.receiptSettings)

  // ── 7-E server refresh key — bumped after a server-verified payment so
  // BOTH server sources (receipt history + fee standing) refetch.
  const [serverRefresh, setServerRefresh] = useState(0)
  const refreshServerData = useCallback(() => {
    setServerRefresh((k) => k + 1)
  }, [])

  // STUDENT-QA S5-7 — server receipt history: the canonical FeeTransaction
  // rows for THIS student (school + student scoped, session-resolved).
  // The client store's `transactions` holds only live payment mirrors made
  // in THIS browser; historical receipts collected by the office (or paid
  // from another device) live exclusively in the DB. Without this fetch
  // the receipts section rendered "No payments recorded yet this session"
  // on a fresh browser even with real SUCCESS receipts in the ledger.
  const [serverPayments, setServerPayments] = useState<FeeTransaction[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/student/payments', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const list = j && typeof j === 'object' && 'data' in j && j.data && Array.isArray(j.data.payments) ? j.data.payments : null
        setServerPayments(list ?? [])
      })
      .catch(() => { if (!cancelled) setServerPayments([]) })
    return () => { cancelled = true }
  }, [serverRefresh])

  // ── 7-E SERVER STANDING — the canonical money truth for THIS student.
  // GET /api/students/roster answers the caller's OWN row with a
  // server-computed `fees` block (totalBilled / totalPaid / outstanding /
  // status / awaitingVerification — derived from the canonical Fee +
  // FeeTransaction rows, exactly where applyPaymentToLedger credits
  // money). Component-local read: the students-store roster sync is NOT
  // re-triggered (its once-per-session guard exists precisely so live
  // in-session mirrors are not double-counted against a refreshed
  // feePaid); this fetch only READS the standing.
  // Falls back to the local derivation ONLY while the server row is
  // loading/unavailable (documented — the balance then renders from the
  // engine until the next successful fetch, e.g. on remount).
  const [standing, setStanding] = useState<ServerFeeStanding | null>(null)
  const studentId = student?.id
  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    fetch('/api/students/roster', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const data = j && typeof j === 'object' && 'data' in j ? j.data : null
        const self = data && Array.isArray(data.students)
          ? data.students.find((s: { id: string }) => s.id === studentId)
          : null
        const fees = self && typeof self === 'object' && self.fees && typeof self.fees.outstanding === 'number'
          ? self.fees
          : null
        setStanding(fees)
      })
      .catch(() => { if (!cancelled) setStanding(null) })
    return () => { cancelled = true }
  }, [studentId, serverRefresh])

  // Receipt list for display — server rows first (canonical history),
  // then any live mirror rows not already present (id-deduped, newest first).
  const receiptTxns = useMemo(() => {
    const byId = new Map<string, FeeTransaction>()
    for (const t of serverPayments) byId.set(t.id, t)
    for (const t of transactions) if (!byId.has(t.id)) byId.set(t.id, t)
    return [...byId.values()].sort((a, b) => (a.recordedAt ?? a.date) < (b.recordedAt ?? b.date) ? 1 : -1)
  }, [serverPayments, transactions])

  const acct = useMemo(
    () => (student
      ? computeAccount(student, transactions, lateFeeRule, additionalCharges, concessions, optionalHeadApplicability)
      : null),
    [student, transactions, lateFeeRule, additionalCharges, concessions, optionalHeadApplicability],
  )

  // 7-E — the account the UI renders: the local engine's structure context
  // (heads / concession / late-fee policy / ledger narrative) with the
  // MONEY TRUTH overridden by the server standing (exact server integers
  // — no client arithmetic on money). While the standing is loading (or a
  // fetch failed) the local derivation is the documented fallback.
  const displayAcct = useMemo<StudentFeeAccount | null>(() => {
    if (!acct) return null
    if (!standing) return acct
    return {
      ...acct,
      outstanding: standing.outstanding,
      totalDue: standing.outstanding,
      paid: standing.totalPaid,
      status: serverStatusToDisplay(standing.status),
    }
  }, [acct, standing])

  // The primary core fee head (largest billed head) — the note the server
  // stamps on the payment order.
  const primaryHead = useMemo(() => {
    if (!student) return 'Tuition Fee'
    const structure = findStructureForStudent(student.className, student.classId)
    const head = structure?.components
      .filter((c) => c.active && c.mandatory !== false)
      .sort((a, b) => b.amount - a.amount)[0]
    return head?.name ?? 'Tuition Fee'
  }, [student])

  // SaaS-STAGE-2A §20 — school payment-channel policy: without the
  // fee_online_payments sub-feature there are no self-service rails.
  const onlinePaymentsFeature = useFeatureGate().isSubFeatureEnabled('fee_online_payments')

  // Server payment capability — the actual provider availability
  // (Razorpay keys or the sandbox gateway), probed from the API that owns
  // it. Null while resolving.
  const [payConfig, setPayConfig] = useState<PaymentConfigResponse | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/student/payments/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const data = j && typeof j === 'object' && 'data' in j ? (j as { data?: PaymentConfigResponse }).data : null
        if (data) setPayConfig(data)
        else setPayConfig({ available: false, provider: null, mode: null, keyId: null })
      })
      .catch(() => { if (!cancelled) setPayConfig({ available: false, provider: null, mode: null, keyId: null }) })
    return () => { cancelled = true }
  }, [])

  const canPayOnline = onlinePaymentsFeature && !!payConfig?.available
  // 7-E — settled + payable figures consume the SERVER-derived account.
  const allSettled = !!displayAcct && displayAcct.totalDue <= 0 && displayAcct.additional.outstanding <= 0

  const [payOpen, setPayOpen] = useState(false)

  if (!student || !displayAcct) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading fees" />
      </div>
    )
  }

  const latestTxn = receiptTxns.find((t) => t.status === 'Success')
  // The payable amount is the SERVER outstanding — the gateway order is
  // bounded by the canonical ledger, never by a localStorage balance.
  const balanceForPayment = Math.max(0, displayAcct.totalDue)

  return (
    <div className="space-y-5 max-w-4xl">
      {/* STRUCT-REV — guardian acknowledgement request for a mid-session
          fee-structure revision affecting this student's class. */}
      <FeeRevisionApprovalCard canonicalStudentId={student.id} />

      {allSettled ? (
        <AllPaidState acct={displayAcct} latestTxn={latestTxn} receiptSettings={receiptSettings} />
      ) : (
        <BalanceHero
          acct={displayAcct}
          lateFeeRule={lateFeeRule}
          canPayOnline={canPayOnline}
          onPay={() => setPayOpen(true)}
        />
      )}

      {/* Online rails unavailable (platform policy OR no gateway configured
          server-side) → the office is the path, the balance stays visible. */}
      {!allSettled && !canPayOnline && <OnlineUnavailableCard outstanding={balanceForPayment} />}

      <FeeStructure acct={displayAcct} />

      <Statement acct={displayAcct} transactions={receiptTxns} receiptSettings={receiptSettings} />

      {canPayOnline && balanceForPayment > 0 && (
        <PaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          studentId={student.id}
          student={{
            name: student.name,
            admissionNo: student.admissionNo,
            className: student.className,
            section: student.section,
          }}
          balanceDue={balanceForPayment}
          primaryHead={primaryHead}
          config={payConfig}
          onPaymentSuccess={refreshServerData}
        />
      )}
    </div>
  )
}
