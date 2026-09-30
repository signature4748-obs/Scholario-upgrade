'use client'

// PHASE 6 console page — thin route wrapper; the module component owns
// the surface. (Built in Task 6-a/6-b.)
import { SessionsModule } from '@/components/platform/modules/sessions'

export default function Page() {
  return <SessionsModule />
}
