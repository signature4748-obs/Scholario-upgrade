'use client'

/**
 * blank-form-download — the client-side entry point behind the
 * "Download Blank Form" action.
 *
 * Resolves the REAL tenant configuration (school identity cascade,
 * academic session, admission document policy) → builds the versioned
 * blank-form model → renders the genuine A4 PDF → saves it locally.
 * Only the selected school's data is ever used.
 */

import { getSchoolProfile } from '@/lib/school-profile'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { buildBlankFormModel } from './blank-form-model'
import {
  blankFormFileName,
  renderBlankAdmissionFormPdf,
} from './blank-form-pdf'

/** Allowed MIME types for the jsPDF embed of the tenant logo. */
const LOGO_OK = new Set(['image/png', 'image/jpeg'])

/**
 * Fetch the tenant logo (school-scope media route) and convert it to a
 * data URL jsPDF can embed. Returns null for anything unembeddable —
 * the PDF then prints an honest empty "School Logo" box.
 */
async function loadLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl, { credentials: 'same-origin' })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    if (!LOGO_OK.has(type.split(';')[0].trim())) return null
    const blob = await res.blob()
    if (blob.size > 1_500_000) return null
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export interface BlankFormDownloadResult {
  fileName: string
}

/**
 * Build + download the official blank admission form PDF for the
 * currently signed-in school. Never throws for missing configuration —
 * unconfigured identity prints as labelled blanks.
 */
export async function downloadBlankAdmissionFormPdf(): Promise<BlankFormDownloadResult> {
  const profile = getSchoolProfile()
  const settings = useSchoolSettingsStore.getState()
  const session = profile.academicYear || settings.academics?.currentSession || '—'
  const documentPolicy = settings.admissionSettings?.documentPolicy ?? null

  const model = buildBlankFormModel({
    school: {
      name: profile.name,
      shortName: profile.shortName,
      affiliation: profile.affiliation || '',
      address: profile.address,
      city: profile.city,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      principal: profile.principal,
      logoUrl: profile.logoUrl,
      primaryColor: profile.primaryColor,
    },
    session,
    documentPolicy,
  })

  const logoDataUrl = await loadLogoDataUrl(profile.logoUrl)
  const doc = renderBlankAdmissionFormPdf(model, { logoDataUrl })
  const fileName = blankFormFileName(profile.shortName || profile.name, session)
  doc.save(fileName)
  return { fileName }
}
