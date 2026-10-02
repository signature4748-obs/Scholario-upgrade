'use client'

/**
 * salary-ui-context — shared UI actions across the Salary workspace tabs.
 *
 * Lets any tab open the employee drawer or the Record Payment dialog
 * without prop-drilling. PHASE 8B: the payroll universe is teachers (the
 * canonical Teacher rows), so targets carry a teacherId.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface RecordTarget {
  teacherId?: string
  month?: string
}

interface SalaryUIState {
  drawerTeacherId: string | null
  openEmployee: (id: string) => void
  closeEmployee: () => void
  recordOpen: boolean
  recordTarget: RecordTarget | null
  openRecordPayment: (target?: RecordTarget) => void
  closeRecordPayment: () => void
}

const SalaryUIContext = createContext<SalaryUIState | null>(null)

export function SalaryUIProvider({ children }: { children: React.ReactNode }) {
  const [drawerTeacherId, setDrawerTeacherId] = useState<string | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)

  const openEmployee = useCallback((id: string) => setDrawerTeacherId(id), [])
  const closeEmployee = useCallback(() => setDrawerTeacherId(null), [])
  const openRecordPayment = useCallback((target?: RecordTarget) => {
    setRecordTarget(target ?? null)
    setRecordOpen(true)
  }, [])
  const closeRecordPayment = useCallback(() => {
    setRecordOpen(false)
    setRecordTarget(null)
  }, [])

  const value = useMemo<SalaryUIState>(() => ({
    drawerTeacherId, openEmployee, closeEmployee,
    recordOpen, recordTarget, openRecordPayment, closeRecordPayment,
  }), [drawerTeacherId, openEmployee, closeEmployee, recordOpen, recordTarget, openRecordPayment, closeRecordPayment])

  return <SalaryUIContext.Provider value={value}>{children}</SalaryUIContext.Provider>
}

export function useSalaryUI(): SalaryUIState {
  const ctx = useContext(SalaryUIContext)
  if (!ctx) throw new Error('useSalaryUI must be used inside SalaryUIProvider')
  return ctx
}
