/**
 * Pure fee derivation — the same pipeline as useFeeCalculations, but as a
 * plain function (no hooks) so non-React surfaces (issuance artifacts,
 * documents, exports) can compute the REAL fee numbers for an application
 * instead of hardcoding demo values.
 *
* THREE-STATE SEMANTICS (PR-3 spec, findings F1): a fee head that is not
 * configured yields UNDEFINED — never a fabricated fallback amount
 * (the old defaultAmount fallback literals), never a silent ₹0.
 * Totals that depend on an unconfigured component are undefined too;
 * renderers display "Not configured"/"—" for them. The demo tenant sees
 * configured numbers (demoFeeSettings corpus); a real tenant that has
 * not configured fees sees the honest three-state everywhere.
 */
import { getSchoolSettings } from '@/lib/school-settings'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { ACTIVITY_KIT_ITEMS, HOSTEL_COST, SCHOLARSHIP_PERCENT, TRANSPORT_COST } from './constants'
import type { FeeDataState } from './types'

export interface FeeSnapshot {
  /** UNDEFINED = head not configured (render "Not configured"). */
  registrationFee: number | undefined
  admissionFee: number | undefined
  tuitionFee: number | undefined
  otherHeadsTotal: number
  examTotal: number | undefined
  booksTotal: number
  uniformTotal: number
  activityKitTotal: number
  transportTotal: number
  hostelTotal: number
  /** UNDEFINED while any required component is unconfigured. */
  grossFee: number | undefined
  discountName?: string
  discountAmount: number | undefined
  netTotal: number | undefined
}

export function computeFeeSnapshot(
  className: string,
  feeState: FeeDataState,
  flags?: { enableTransport?: boolean; enableHostel?: boolean }
): FeeSnapshot {
  const settings = getSchoolSettings()
  const uniforms = useSchoolSettingsStore.getState().uniforms
  const examConfig = settings.examFeeConfig

  // THREE-STATE: exam fees are undefined while unconfigured — a selected
  // exam group with no configured fee is a missing amount, not ₹0.
  const examTotal = !examConfig
    ? undefined
    : (feeState.examGroups.unitTest || feeState.examGroups.termExam || feeState.examGroups.customGroups)
      ? (feeState.examGroups.unitTest ? examConfig.unitTestFee : 0) +
        (feeState.examGroups.termExam ? examConfig.termExamFee : 0) +
        (feeState.examGroups.customGroups ? examConfig.customGroupsFee : 0)
      : 0

  // Class-aware book list — Books Master ONLY. The old auto-generated
  // 6-book fallback (fabricated NCERT/Oxford titles at invented prices)
  // is retired: an unconfigured class shows an honest empty list.
  const booksMaster = settings.booksMaster
  const existing = booksMaster.filter((b) => {
    const bCls = b.className.toLowerCase().trim()
    const targetCls = (className || '').toLowerCase().trim()
    return bCls === targetCls || targetCls.includes(bCls) || bCls.includes(targetCls)
  })
  const classBooks = existing.map((b) => ({ id: b.id, price: b.price }))
  const booksTotal = classBooks.reduce(
    (sum, b) => sum + (feeState.bookSelections[b.id] || 0) * b.price,
    0
  )
  const uniformTotal = uniforms.reduce(
    (sum, u) => sum + (feeState.uniformSelections[u.id] || 0) * u.price,
    0
  )
  const activityKitTotal = ACTIVITY_KIT_ITEMS.reduce(
    (sum, a) => sum + (feeState.activityKitSelections[a.id] || 0) * a.price,
    0
  )
  const transportTotal =
    feeState.transportSelected && flags?.enableTransport ? TRANSPORT_COST : 0
  const hostelTotal =
    feeState.hostelSelected && flags?.enableHostel ? HOSTEL_COST : 0

  const heads = settings.feeHeads
  // THREE-STATE (F1): the missing head is UNDEFINED — the removed fallbacks
  // (`|| 1500 / || 15000 / || 60000`) fabricated amounts that rendered on
  // official documents as if the school had configured them.
  const registrationFee = heads.find((f) => f.category === 'Registration')?.defaultAmount
  const admissionFee = heads.find((f) => f.category === 'Admission')?.defaultAmount
  const tuitionFee = heads.find((f) => f.category === 'Tuition')?.defaultAmount
  const otherHeadsTotal = heads
    .filter((f) => !['Registration', 'Admission', 'Tuition'].includes(f.category))
    .reduce((a, b) => a + b.defaultAmount, 0)

  const optionalTotal =
    booksTotal + uniformTotal + activityKitTotal + transportTotal + hostelTotal
  // A gross total that omits an unconfigured required component would
  // masquerade as the real total — it stays undefined instead.
  const grossFee =
    registrationFee !== undefined && admissionFee !== undefined && tuitionFee !== undefined && examTotal !== undefined
      ? registrationFee + admissionFee + tuitionFee + otherHeadsTotal + examTotal + optionalTotal
      : undefined

  const selectedDiscount = settings.discountRules.find(
    (d) => d.code === feeState.discountCode
  )
  let discountAmount: number | undefined = 0
  let discountName: string | undefined
  if (selectedDiscount) {
    discountAmount =
      selectedDiscount.type === 'percentage'
        ? grossFee !== undefined
          ? Math.round((grossFee * selectedDiscount.value) / 100)
          : undefined
        : selectedDiscount.value
    discountName = selectedDiscount.name || selectedDiscount.code
  } else if (feeState.discountCode === 'CUSTOM') {
    discountAmount = Number(feeState.customDiscountValue) || 0
    discountName = feeState.customDiscountReason || 'Custom Concession'
  }
  const scholarshipAmount =
    feeState.discountCode === 'SCHOLAR'
      ? grossFee !== undefined
        ? Math.round((grossFee * SCHOLARSHIP_PERCENT) / 100)
        : undefined
      : 0
  const totalDiscount =
    discountAmount !== undefined && scholarshipAmount !== undefined
      ? discountAmount + scholarshipAmount
      : undefined
  const netTotal =
    grossFee !== undefined && totalDiscount !== undefined
      ? Math.max(0, grossFee - totalDiscount)
      : undefined

  return {
    registrationFee,
    admissionFee,
    tuitionFee,
    otherHeadsTotal,
    examTotal,
    booksTotal,
    uniformTotal,
    activityKitTotal,
    transportTotal,
    hostelTotal,
    grossFee,
    discountName,
    discountAmount: totalDiscount,
    netTotal,
  }
}
