/**
 * Canonical Admission Document Policy — single source of truth.
 *
 * The REGISTRY (ADMISSION_DOCUMENT_REGISTRY) defines the documents a
 * school CAN collect. The REQUIREMENT for each document is
 * SCHOOL-CONFIGURABLE (Admission Settings → Documents):
 *
 *   'required'      → applicant must provide it before submission
 *   'optional'      → submission is allowed without it
 *   'not-collected' → hidden from the digital admission workflow
 *
 * Nothing is hardcoded as universally mandatory — the defaults below
 * simply seed a fresh tenant with this school's current configuration
 * (Aadhaar required, five supporting documents optional), and the
 * Principal can change any of them at any time.
 *
 * Completion rule: requiredCompleted === requiredTotal (never
 * collected/total — optional documents must not be able to block an
 * application; a school with zero required documents is always complete).
 *
 * PHASE 7-H (admissions honesty): digital document UPLOADS are not
 * built — the admissions upload route that this module referenced
 * never existed (phantom endpoint, always 404) and the fake
 * client-side "upload" success was removed. What the checklist records
 * honestly today is what the office has PHYSICALLY COLLECTED (a
 * required document gates submission once it is marked received).
 * Server-backed document storage is future scope.
 */

import type {
  AdmissionDocRequirement,
  AdmissionDocumentPolicy,
} from '@/lib/store/school-settings-store'

export type { AdmissionDocRequirement, AdmissionDocumentPolicy }

export interface AdmissionDocumentDef {
  key: string
  name: string
  /** Resolved requirement for this document under the active policy. */
  required: boolean
  /** Raw policy value ('required' | 'optional' | 'not-collected'). */
  policy: AdmissionDocRequirement
}

/** Registry of documents a school can collect, in canonical display order. */
export const ADMISSION_DOCUMENT_REGISTRY: {
  key: string
  name: string
  defaultPolicy: AdmissionDocRequirement
}[] = [
  { key: 'aadhaar', name: 'Student Aadhaar Card', defaultPolicy: 'required' },
  { key: 'tc', name: 'Transfer Certificate (TC)', defaultPolicy: 'optional' },
  { key: 'character', name: 'Character Certificate', defaultPolicy: 'optional' },
  { key: 'birthCert', name: 'Birth Certificate', defaultPolicy: 'optional' },
  { key: 'marksheet', name: 'Previous Mark Sheet', defaultPolicy: 'optional' },
  { key: 'migration', name: 'Migration Certificate', defaultPolicy: 'optional' },
]

/** Default policy map — one entry per registry document. */
export const DEFAULT_DOCUMENT_POLICY: AdmissionDocumentPolicy =
  Object.fromEntries(
    ADMISSION_DOCUMENT_REGISTRY.map((d) => [d.key, d.defaultPolicy])
  )

/**
 * Resolve the school's document policy against the registry. Persisted
 * settings that pre-date the policy system (or are missing a key) fall
 * back to the registry default for that key — the school's existing
 * configuration is never silently changed.
 */
export function resolveDocumentPolicy(
  stored?: Partial<AdmissionDocumentPolicy> | null
): Required<AdmissionDocumentPolicy> {
  const resolved = { ...DEFAULT_DOCUMENT_POLICY }
  if (stored) {
    for (const d of ADMISSION_DOCUMENT_REGISTRY) {
      const v = stored[d.key]
      if (v === 'required' || v === 'optional' || v === 'not-collected') {
        resolved[d.key] = v
      }
    }
  }
  return resolved
}

/** Documents actually COLLECTED under the policy (required + optional). */
export function getCollectedDocuments(
  policy?: Partial<AdmissionDocumentPolicy> | null
): AdmissionDocumentDef[] {
  const resolved = resolveDocumentPolicy(policy)
  return ADMISSION_DOCUMENT_REGISTRY.filter(
    (d) => resolved[d.key] !== 'not-collected'
  ).map((d) => ({
    key: d.key,
    name: d.name,
    required: resolved[d.key] === 'required',
    policy: resolved[d.key],
  }))
}

/** Required documents only, in registry order. */
export function getRequiredDocuments(
  policy?: Partial<AdmissionDocumentPolicy> | null
): AdmissionDocumentDef[] {
  return getCollectedDocuments(policy).filter((d) => d.required)
}

/** Optional documents only, in registry order. */
export function getOptionalDocuments(
  policy?: Partial<AdmissionDocumentPolicy> | null
): AdmissionDocumentDef[] {
  return getCollectedDocuments(policy).filter((d) => !d.required)
}

export interface DocStatusLike {
  /**
   * 'received' = the office physically collected the document (PHASE
   * 7-H: no server upload exists — the legacy 'uploaded' value from
   * persisted records is treated as received too). 'pending' / 'later'
   * = not yet received.
   */
  status?: 'received' | 'uploaded' | 'pending' | 'later' | string
  fileName?: string
  verificationStatus?: string
}

export interface DocumentCompletion {
  requiredTotal: number
  requiredCompleted: number
  optionalTotal: number
  optionalReceived: number
  /** True ONLY when every required document is received (0 required → true). */
  complete: boolean
  /** e.g. "Required 1/1 complete ✓ · Optional 0/5 collected" */
  summaryLine: string
  /** Short badge label, e.g. "Documents ✓ Complete" or "Documents Incomplete". */
  badgeLabel: string
  /** Names of required documents still missing (empty when complete). */
  missingRequired: string[]
}

const isReceived = (st?: DocStatusLike): boolean =>
  !!st && (st.status === 'received' || st.status === 'uploaded')

/* ------------------------------------------------------------------ */
/*  Document receipt — OFFICE CHECKLIST (no server upload exists).     */
/*  PHASE 7-H: the client half of the former "client + server" upload  */
/*  contract (the upload + delete-file helpers targeting the never-    */
/*  built admissions upload route) was REMOVED. Digital uploads are    */
/*  coming soon; today the office marks what it has collected on       */
/*  paper, and the required-document gate keys on that.                */
/* ------------------------------------------------------------------ */

/**
 * Compute document completion for an application's docStatuses map under
 * the school's document policy. Optional documents are counted for
 * information only.
 */
export function getDocumentCompletion(
  docStatuses?: Record<string, DocStatusLike | undefined> | null,
  policy?: Partial<AdmissionDocumentPolicy> | null
): DocumentCompletion {
  const statuses = docStatuses || {}
  const required = getRequiredDocuments(policy)
  const optional = getOptionalDocuments(policy)
  const missingRequired = required
    .filter((d) => !isReceived(statuses[d.key]))
    .map((d) => d.name)
  const requiredCompleted = required.length - missingRequired.length
  const optionalReceived = optional.filter((d) =>
    isReceived(statuses[d.key])
  ).length
  const requiredTotal = required.length
  const optionalTotal = optional.length
  const complete = requiredCompleted === requiredTotal

  return {
    requiredTotal,
    requiredCompleted,
    optionalTotal,
    optionalReceived,
    complete,
    missingRequired,
    summaryLine: `Required ${requiredCompleted}/${requiredTotal} complete${
      complete ? ' ✓' : ''
    } · Optional ${optionalReceived}/${optionalTotal} collected`,
    badgeLabel: complete ? 'Documents ✓ Complete' : 'Documents Incomplete',
  }
}
