'use client'

// PHASE 6 console page — thin route wrapper; the module component owns
// the surface. (Built in Task 6-a/6-b.) Suspense wraps the module
// because it reads ?tab= via useSearchParams (deep-linking — §3B).
import { Suspense } from 'react'
import { SchoolDetailModule } from '@/components/platform/modules/school-detail'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SchoolDetailModule />
    </Suspense>
  )
}
