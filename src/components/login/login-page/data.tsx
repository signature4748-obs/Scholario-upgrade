import { User, BookOpen, ShieldCheck } from 'lucide-react'
import type { Role } from '@/lib/store/auth-store'

export interface CredentialCard {
  role: Role
  title: string
  name: string
  email: string
  password: string
  icon: React.ReactNode
  gradient: string
  accent: string
  description: string
}

/**
 * Phase 1 — demo quick-access credentials (baseline B-11/E-6 remediation).
 *
 * `process.env.NODE_ENV` is inlined at BUILD time, so production bundles
 * compile this to `[]` — the plaintext demo passwords and the one-click
 * role chips can never ship in a production build. Development/preview
 * keeps them for the demo flow. `NEXT_PUBLIC_DISABLE_DEMO_LOGIN=1`
 * additionally turns them off in dev.
 *
 * SCHOOL-ROLES ONLY (Phase 5-b): the school login surface communicates
 * exclusively the school platform experience — the super-admin console
 * is reachable ONLY via the separate `#platform` route (PlatformLanding)
 * and must never be advertised here.
 */
const DEMO_LOGIN_ENABLED =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_DEMO_LOGIN !== '1'

export const credentials: CredentialCard[] = DEMO_LOGIN_ENABLED
  ? [
  {
    role: 'principal',
    title: 'Principal',
    name: 'Dr. Ananya Iyer',
    email: 'principal@greenwood.edu.in',
    password: 'principal123',
    icon: <ShieldCheck className="h-5 w-5" />,
    gradient: 'from-emerald-500 to-teal-600',
    accent: 'emerald',
    description: 'Full administrative control',
  },
  {
    role: 'teacher',
    title: 'Teacher',
    name: 'Rohan Mehta',
    email: 'rohan.mehta@greenwood.edu.in',
    password: 'teacher123',
    icon: <BookOpen className="h-5 w-5" />,
    gradient: 'from-amber-500 to-orange-600',
    accent: 'amber',
    description: 'Classroom & academics',
  },
  {
    role: 'student',
    title: 'Student',
    name: 'Aarav Sharma',
    // REAL seeded account (prisma/seed.ts greenwood section) — the
    // canonical Aarav Sharma user tied to the Grade 9-A roll-01 student
    // record. (The retired student1@demoschool.edu no longer exists in
    // the DB — the quick-access chip must point at the account that
    // actually authorises the student's server-verified rails.)
    email: 'aarav.sharma@greenwood.edu.in',
    password: 'student123',
    icon: <User className="h-5 w-5" />,
    gradient: 'from-violet-500 to-purple-600',
    accent: 'violet',
    description: 'Learning & performance',
  },
      ]
  : []
