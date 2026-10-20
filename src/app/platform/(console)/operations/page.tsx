'use client'

// PLATFORM OPERATIONS CENTER — thin route wrapper (mirrors the console
// page convention); the OperationsModule owns the surface.
import { Suspense } from 'react'
import { OperationsModule } from '@/components/platform/modules/operations'

export default function Page() {
  return (
    <Suspense>
      <OperationsModule />
    </Suspense>
  )
}
