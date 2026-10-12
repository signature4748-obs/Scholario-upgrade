import { useMemo } from 'react'
import { toast } from 'sonner'
import { getSchoolSettings } from '@/lib/school-settings'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { ACTIVITY_KIT_ITEMS, HOSTEL_COST, INITIAL_INSTALLMENT_RATIO, SCHOLARSHIP_PERCENT, TRANSPORT_COST } from './constants'
import type { FeeDataState, SelectionCategory } from './types'

/**
 * Looks up class-specific books from Books Master ONLY. The previous
 * auto-generated 6-book fallback (fabricated NCERT/Oxford/Evergreen
 * titles at invented prices — finding F2-adjacent) is retired: an
 * unconfigured class yields an honest empty list the wizard labels
 * "No books configured".
 */
function resolveClassBooks(className: string, booksMaster: ReturnType<typeof getSchoolSettings>['booksMaster']) {
  return booksMaster
    .filter((b) => {
      const cls = b.className.toLowerCase().trim()
      const targetCls = className.toLowerCase().trim()
      return cls === targetCls || targetCls.includes(cls) || cls.includes(targetCls)
    })
    .map((b) => ({ ...b, isMandatory: false }))
}

export interface FeeCalculations {
  classBooks: ReturnType<typeof resolveClassBooks>
  uniforms: ReturnType<typeof useSchoolSettingsStore.getState>['uniforms']
  examConfig: ReturnType<typeof getSchoolSettings>['examFeeConfig']
  /** THREE-STATE (PR-3): UNDEFINED = not configured. */
  examTotal: number | undefined
  booksTotal: number
  booksCount: number
  uniformTotal: number
  uniformCount: number
  activityKitTotal: number
  activityKitCount: number
  transportCost: number
  hostelCost: number
  transportTotal: number
  hostelTotal: number
  registrationFee: number | undefined
  admissionFee: number | undefined
  tuitionFee: number | undefined
  otherHeadsTotal: number
  optionalTotal: number
  grossFee: number | undefined
  selectedDiscount: ReturnType<typeof getSchoolSettings>['discountRules'][number] | undefined
  discountAmount: number | undefined
  scholarshipAmount: number | undefined
  waiverAmount: number | undefined
  totalDiscount: number | undefined
  netTotal: number | undefined
  initialInstallment: number | undefined
  remainingBalance: number | undefined
}

/**
 * Encapsulates the entire fee-derivation pipeline used by {@link FeeStructureStep}.
 * Computes class-aware book lists, exam totals, discounts, scholarships, waivers,
 * and the final installment split — all reactive to `feeState` and `className`.
 */
export function useFeeCalculations(
  className: string,
  feeState: FeeDataState,
  onChangeFeeState: (next: FeeDataState) => void,
  flags?: { enableTransport?: boolean; enableHostel?: boolean },
): FeeCalculations & {
  schoolSettings: ReturnType<typeof getSchoolSettings>
  settingsStore: ReturnType<typeof useSchoolSettingsStore>
  updateSelection: (cat: SelectionCategory, itemId: string, qty: number) => void
  toggleSelection: (cat: SelectionCategory, itemId: string) => void
  handleApplyWaiver: () => void
} {
  const schoolSettings = getSchoolSettings()
  const settingsStore = useSchoolSettingsStore()
  const uniforms = settingsStore.uniforms

  const classBooks = useMemo(() => resolveClassBooks(className, schoolSettings.booksMaster), [className, schoolSettings.booksMaster])

  /* ---------- Selection helpers ---------- */
  const updateSelection = (category: SelectionCategory, itemId: string, qty: number) => {
    const current = { ...feeState[category] }
    if (qty <= 0) {
      delete current[itemId]
    } else {
      current[itemId] = qty
    }
    onChangeFeeState({ ...feeState, [category]: current })
  }

  const toggleSelection = (category: SelectionCategory, itemId: string) => {
    const current = { ...feeState[category] }
    if (current[itemId]) {
      delete current[itemId]
    } else {
      current[itemId] = 1
    }
    onChangeFeeState({ ...feeState, [category]: current })
  }

  /* ---------- Calculations (real-time) ---------- */
  // THREE-STATE: exam fees are undefined while unconfigured — a selected
  // exam group with no configured fee is a missing amount, not ₹0.
  const examConfig = schoolSettings.examFeeConfig
  const examTotal = !examConfig
    ? undefined
    : (feeState.examGroups.unitTest || feeState.examGroups.termExam || feeState.examGroups.customGroups)
      ? (feeState.examGroups.unitTest ? examConfig.unitTestFee : 0) +
        (feeState.examGroups.termExam ? examConfig.termExamFee : 0) +
        (feeState.examGroups.customGroups ? examConfig.customGroupsFee : 0)
      : 0

  const booksTotal = classBooks.reduce((sum, b) => sum + (feeState.bookSelections[b.id] || 0) * b.price, 0)
  const booksCount = Object.values(feeState.bookSelections).reduce((a, b) => a + b, 0)

  const uniformTotal = uniforms.reduce((sum, u) => sum + (feeState.uniformSelections[u.id] || 0) * u.price, 0)
  const uniformCount = Object.values(feeState.uniformSelections).reduce((a, b) => a + b, 0)

  const activityKitTotal = ACTIVITY_KIT_ITEMS.reduce((sum, a) => sum + (feeState.activityKitSelections[a.id] || 0) * a.price, 0)
  const activityKitCount = Object.values(feeState.activityKitSelections).reduce((a, b) => a + b, 0)

  const transportCost = TRANSPORT_COST
  const hostelCost = HOSTEL_COST
  const transportTotal = feeState.transportSelected && flags?.enableTransport ? transportCost : 0
  const hostelTotal = feeState.hostelSelected && flags?.enableHostel ? hostelCost : 0

  // Institutional fee heads (read-only) — THREE-STATE (F3): the removed
  // defaultAmount fallback literals fabricated amounts; a missing
  // head is UNDEFINED and renders "Not configured".
  const baseFeeHeads = schoolSettings.feeHeads
  const registrationFee = baseFeeHeads.find((f) => f.category === 'Registration')?.defaultAmount
  const admissionFee = baseFeeHeads.find((f) => f.category === 'Admission')?.defaultAmount
  const tuitionFee = baseFeeHeads.find((f) => f.category === 'Tuition')?.defaultAmount
  const otherHeadsTotal = baseFeeHeads
    .filter((f) => !['Registration', 'Admission', 'Tuition'].includes(f.category))
    .reduce((a, b) => a + b.defaultAmount, 0)

  const optionalTotal = booksTotal + uniformTotal + activityKitTotal + transportTotal + hostelTotal
  // A gross total that omits an unconfigured required component would
  // masquerade as the real total — it stays undefined instead.
  const grossFee =
    registrationFee !== undefined && admissionFee !== undefined && tuitionFee !== undefined && examTotal !== undefined
      ? registrationFee + admissionFee + tuitionFee + otherHeadsTotal + examTotal + optionalTotal
      : undefined

  // Discount calculation
  const selectedDiscount = schoolSettings.discountRules.find((d) => d.code === feeState.discountCode)
  let discountAmount: number | undefined = 0
  if (selectedDiscount) {
    discountAmount = selectedDiscount.type === 'percentage'
      ? grossFee !== undefined
        ? Math.round((grossFee * selectedDiscount.value) / 100)
        : undefined
      : selectedDiscount.value
  } else if (feeState.discountCode === 'CUSTOM') {
    discountAmount = Number(feeState.customDiscountValue) || 0
  }

  const scholarshipAmount = feeState.discountCode === 'SCHOLAR'
    ? grossFee !== undefined
      ? Math.round((grossFee * SCHOLARSHIP_PERCENT) / 100)
      : undefined
    : 0
  const waiverAmount = discountAmount
  const totalDiscount =
    discountAmount !== undefined && scholarshipAmount !== undefined
      ? discountAmount + scholarshipAmount
      : undefined
  const netTotal =
    grossFee !== undefined && totalDiscount !== undefined
      ? Math.max(0, grossFee - totalDiscount)
      : undefined
  const initialInstallment =
    netTotal !== undefined ? Math.round(netTotal * INITIAL_INSTALLMENT_RATIO) : undefined
  const remainingBalance =
    netTotal !== undefined && initialInstallment !== undefined
      ? netTotal - initialInstallment
      : undefined

  const handleApplyWaiver = () => {
    if (!feeState.waiverAppliedBy || !feeState.waiverApprovalAuthority) {
      toast.error('Fill Applied By and Approval Authority')
      return
    }
    settingsStore.addWaiverAudit({
      appliedBy: feeState.waiverAppliedBy,
      appliedByRole: 'Principal',
      approvalAuthority: feeState.waiverApprovalAuthority,
      approvalDate: new Date().toISOString().split('T')[0],
      reason: feeState.waiverReason || 'Discretionary waiver',
      amount: waiverAmount ?? 0,
    })
    toast.success('Waiver applied & logged in audit trail')
  }

  return {
    schoolSettings,
    settingsStore,
    classBooks,
    uniforms,
    examConfig,
    examTotal,
    booksTotal,
    booksCount,
    uniformTotal,
    uniformCount,
    activityKitTotal,
    activityKitCount,
    transportCost,
    hostelCost,
    transportTotal,
    hostelTotal,
    registrationFee,
    admissionFee,
    tuitionFee,
    otherHeadsTotal,
    optionalTotal,
    grossFee,
    selectedDiscount,
    discountAmount,
    scholarshipAmount,
    waiverAmount,
    totalDiscount,
    netTotal,
    initialInstallment,
    remainingBalance,
    updateSelection,
    toggleSelection,
    handleApplyWaiver,
  }
}
