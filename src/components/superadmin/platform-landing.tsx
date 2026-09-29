'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ShieldCheck, Cloud, Database, Lock, Building2,
  Cpu, ArrowRight, ArrowLeft, 
} from 'lucide-react'
import { useAuth } from '@/lib/store/auth-store'

interface PlatformLandingProps {
  onBackToSchool?: () => void
}

export function PlatformLanding({ onBackToSchool }: PlatformLandingProps) {
  const { login, startAuth } = useAuth()
  const [authenticating, setAuthenticating] = useState(false)

  const handleSuperAdminSignIn = () => {
    setAuthenticating(true)
    startAuth()
    setTimeout(() => {
      login('superadmin')
    }, 1200)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/20 selection:text-indigo-300 relative overflow-hidden flex flex-col justify-between">
      
      {/* Background Mesh Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute top-1/2 -right-40 h-[40rem] w-[40rem] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-20" />
      </div>

      {/* Header */}
      <header className="relative z-10 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display font-extrabold text-xl tracking-tight text-white">
                SCHOLARIO<span className="text-indigo-400">-PLATFORM</span>
              </span>
              <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                Enterprise Multi-Tenant OS
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {onBackToSchool && (
              <button
                onClick={onBackToSchool}
                className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 transition-all"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Public School
              </button>
            )}
            <button
              onClick={handleSuperAdminSignIn}
              disabled={authenticating}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/25 transition-all"
            >
              <Lock className="h-3.5 w-3.5" />
              {authenticating ? 'Authenticating Console...' : 'Secure Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero Console Section */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 py-16 sm:py-24 text-center space-y-10 my-auto">
        
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Restricted Platform Operations Console</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="space-y-4"
        >
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-tight">
            Central Command for Multi-Tenant School Infrastructure
          </h1>
          <p className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Manage tenant provisioning, isolated database schemas, billing plans, platform system metrics, and cross-school analytics from a single unified enterprise console.
          </p>
        </motion.div>

        {/* Action Button */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <button
            onClick={handleSuperAdminSignIn}
            disabled={authenticating}
            className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition-all active:scale-98"
          >
            <Lock className="h-4 w-4 text-indigo-200" />
            <span>{authenticating ? 'Opening Super Admin Console...' : 'Access Super Admin Console'}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </motion.div>

        {/* Security & System Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="grid sm:grid-cols-3 gap-6 pt-12 text-left"
        >
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <Building2 className="h-6 w-6 text-indigo-400" />
            <h3 className="font-display font-bold text-base text-zinc-100">Multi-Tenant Isolation</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Strict database row-level security and tenant context verification for every query.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <Database className="h-6 w-6 text-violet-400" />
            <h3 className="font-display font-bold text-base text-zinc-100">Supabase Engine</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Production-ready PostgreSQL cluster with connection pooling and automated backups.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <Cpu className="h-6 w-6 text-emerald-400" />
            <h3 className="font-display font-bold text-base text-zinc-100">Audit & Governance</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Comprehensive activity log tracking every administrative action and configuration mutation.
            </p>
          </div>
        </motion.div>

      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-500">
        <p>© {new Date().getFullYear()} Scholario Platform. Enterprise School Operating System. Restricted Access.</p>
      </footer>

    </div>
  )
}
