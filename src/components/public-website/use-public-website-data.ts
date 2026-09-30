'use client'

import { useState, useEffect, useRef } from 'react'
import type { PublicSchoolData } from './types'

/**
 * PHASE 7.5 — tenant-resolved public data.
 *
 * No slug is sent: the server resolves the school (Host domain → ?slug →
 * single-school → demo fallback) for every anonymous visitor, so this
 * client renders whichever school actually owns the domain being browsed.
 */
export function usePublicSchoolData() {
  const [schoolData, setSchoolData] = useState<PublicSchoolData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPublicData() {
      try {
        // Production: domains carry no slug — the Host header resolves the
        // tenant server-side. But when the URL DOES carry ?slug= (sandbox
        // per-tenant links, explicit school deep-links), it MUST be
        // forwarded — otherwise School B's URL would render School A's
        // content (a UI-layer cross-tenant content bug).
        const slug = new URLSearchParams(window.location.search).get('slug')
        const url = slug
          ? `/api/schools/public?slug=${encodeURIComponent(slug)}`
          : '/api/schools/public'
        const res = await fetch(url)
        const isJson = res.headers.get('content-type')?.includes('application/json')
        if (res.ok && isJson) {
          const json = await res.json().catch(() => ({}))
          if (json.success && json.data) {
            setSchoolData(json.data)
          }
        }
      } catch (e) {
        console.error('Failed to load public school data:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchPublicData()
  }, [])

  return { schoolData, loading }
}

export interface AdmissionFormState {
  studentName: string
  parentName: string
  email: string
  phone: string
  grade: string
  notes: string
}

const initialAdmissionForm: AdmissionFormState = {
  studentName: '',
  parentName: '',
  email: '',
  phone: '',
  // PHASE 7.5 — matches no <option> by design: the select carries a
  // "Select stage" placeholder option and `required`, so an unselected
  // grade is blocked by native validation instead of silently posting
  // a "Grade 1" value the form never offered.
  grade: '',
  notes: '',
}

/**
 * @param schoolSlug the RESOLVED school's slug (from /api/schools/public) —
 * inquiries are attributed to the school the visitor is actually browsing,
 * not a hardcoded demo constant.
 */
export function useAdmissionForm(schoolSlug?: string) {
  const [admForm, setAdmForm] = useState<AdmissionFormState>(initialAdmissionForm)
  const [admSubmitting, setAdmSubmitting] = useState(false)
  const [admSuccess, setAdmSuccess] = useState(false)
  const [admError, setAdmError] = useState('')

  // Keep the latest resolved slug without re-creating the submit handler
  // (the closure would otherwise capture the pre-fetch undefined slug).
  const slugRef = useRef<string | undefined>(schoolSlug)
  slugRef.current = schoolSlug

  const handleAdmissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdmSubmitting(true)
    setAdmError('')
    try {
      const res = await fetch('/api/admissions/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...admForm, schoolSlug: slugRef.current ?? '' }),
      })
      const isJson = res.headers.get('content-type')?.includes('application/json')
      const json = isJson ? await res.json().catch(() => ({})) : {}
      if (res.ok && json.success) {
        setAdmSuccess(true)
        setAdmForm(initialAdmissionForm)
      } else {
        setAdmError(json.error || 'Submission failed. Please try again.')
      }
    } catch (err: any) {
      setAdmError(err.message || 'Error submitting application.')
    } finally {
      setAdmSubmitting(false)
    }
  }

  return {
    admForm,
    setAdmForm,
    admSubmitting,
    admSuccess,
    setAdmSuccess,
    admError,
    handleAdmissionSubmit,
  }
}
