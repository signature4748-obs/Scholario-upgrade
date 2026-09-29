// Fees & Finance domain search: surfaces overdue/pending student fee records.
// Fee records are a Principal/Superadmin surface only — teachers, students
// and parents never get fee-search hits (no dead nav keys, no data leaks).

import { students } from '@/lib/mock/students'
import type { SearchResultItem } from './types'

type Role = 'principal' | 'teacher' | 'student' | 'superadmin' | 'parent'

export function searchFees(q: string, role: Role = 'principal'): SearchResultItem[] {
  if (role !== 'principal' && role !== 'superadmin') return []
  const matches = (text: string, kw: string = ''): boolean => {
    if (!text) return false
    const lower = text.toLowerCase()
    return lower.includes(q) || (kw ? kw.toLowerCase().includes(q) : false)
  }

  const results: SearchResultItem[] = []

  // 8. FEES & FINANCE SEARCH
  // Overdue and pending student fee records
  students.filter((s) => s.feeStatus !== 'Paid').forEach((s) => {
    const pendingAmount = s.feeTotal - s.feePaid
    const subtitle = `${s.className}-${s.section} · Due: ₹${pendingAmount.toLocaleString('en-IN')} (Paid ₹${s.feePaid.toLocaleString('en-IN')})`
    if (matches(s.name) || matches('fee') || matches('dues') || matches('pending')) {
      results.push({
        id: `fee-${s.id}`,
        title: `${s.name} (Fee ${s.feeStatus})`,
        subtitle,
        category: 'Fees & Finance',
        type: 'fee',
        moduleKey: 'fees',
        iconName: 'IndianRupee',
        badge: `₹${pendingAmount.toLocaleString('en-IN')} Due`,
        badgeVariant: 'destructive',
        keywords: `${s.name} fee pending dues payment invoice scholarship`,
      })
    }
  })

  return results
}
