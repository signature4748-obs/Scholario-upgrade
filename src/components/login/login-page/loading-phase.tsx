'use client'

import { motion } from 'framer-motion'
import { GraduationCap, Loader2 } from 'lucide-react'
import type { Role } from '@/lib/store/auth-store'

interface LoadingPhaseProps {
  selectedRole: Role | null
}

// Loading animation shown after the user submits credentials
export function LoadingPhase({ selectedRole }: LoadingPhaseProps) {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-live="polite"
      className="relative z-10 flex flex-col items-center"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 blur-2xl opacity-50 animate-pulse" />
        <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl shadow-emerald-500/40">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <GraduationCap className="h-12 w-12 text-white" />
          </motion.div>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-8 text-center"
      >
        <h2 className="font-display text-2xl font-bold">Preparing your workspace</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {selectedRole === 'principal' && 'Loading administrative dashboard…'}
          {selectedRole === 'teacher' && 'Loading your classroom…'}
          {selectedRole === 'student' && 'Loading your learning space…'}
          {!selectedRole && 'Signing you in…'}
        </p>
      </motion.div>
      <div className="mt-6 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
