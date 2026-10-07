'use client'

import { useEffect, useMemo, useState } from 'react'
import { computeAccount, findStructureForStudent } from '@/lib/store/fee-store'
import { useFeeStore, type FeeTransaction } from '@/lib/store/fee-store'
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
 * ONE derivation: computeAccount over the ONE fee ledger (the same engine
 * the school's finance office reads). Balance-first hero, the real
 * configured structure breakdown, the real concession + late-fee policy,
 * and receipts from the official ledger. Online payment is THE path:
 * server-created order → gateway → SERVER-side signature verification →
 * server-minted receipt (RCP-2026-XXXX) → notification. The browser is
 * never trusted to declare success.
 *
 * No big "My Fees" title renders here — the shell header + sidebar are
 * the single WHERE-AM-I (nav dedup rule).
 */
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

  // STUDENT-QA S5-7 — server receipt history: the canonical FeeTransaction
  // rows for THIS student (school + student scoped, session-resolved).
  // The client store's `transactions` holds only live payment mirrors made
  // in THIS browser; historical receipts collected by the office (or paid
  // from another device) live exclusively in the DB. Without this fetch
  // the receipts section rendered "No payments recorded yet this session"
  // on a fresh browser even with real SUCCESS receipts in the ledger.
  // Display-only: computeAccount keeps consuming the raw store list so the
  // paid/standing derivation (roster feePaid + live mirrors) is unchanged.
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
  }, [])

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
  const allSettled = !!acct && acct.totalDue <= 0 && acct.additional.outstanding <= 0

  const [payOpen, setPayOpen] = useState(false)

  if (!student || !acct) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading fees" />
      </div>
    )
  }

  const latestTxn = receiptTxns.find((t) => t.status === 'Success')
  const balanceForPayment = Math.max(0, acct.totalDue)

  return (
    <div className="space-y-5 max-w-4xl">
      {/* STRUCT-REV — guardian acknowledgement request for a mid-session
          fee-structure revision affecting this student's class. */}
      <FeeRevisionApprovalCard canonicalStudentId={student.id} />

      {allSettled ? (
        <AllPaidState acct={acct} latestTxn={latestTxn} receiptSettings={receiptSettings} />
      ) : (
        <BalanceHero
          acct={acct}
          lateFeeRule={lateFeeRule}
          canPayOnline={canPayOnline}
          onPay={() => setPayOpen(true)}
        />
      )}

      {/* Online rails unavailable (platform policy OR no gateway configured
          server-side) → the office is the path, the balance stays visible. */}
      {!allSettled && !canPayOnline && <OnlineUnavailableCard outstanding={balanceForPayment} />}

      <FeeStructure acct={acct} />

      <Statement acct={acct} transactions={receiptTxns} receiptSettings={receiptSettings} />

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
        />
      )}
    </div>
  )
}
