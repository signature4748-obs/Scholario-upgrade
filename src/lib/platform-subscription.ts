/**
 * platform-subscription — RETIRED (PHASE 7.5).
 *
 * The fabricated per-student "platform licensing" engine (hardcoded ₹600
 * annual fee, UPI id, in-memory records lost on every reload, fake UTR
 * numbers, the student paywall screen) was removed with the Phase 7.5
 * subscription-access-model work:
 *
 *   · School-role access is a TENANT-level decision — see
 *     src/lib/access-policy.ts (evaluateSchoolAccess) and
 *     docs/SCHOOL_SUBSCRIPTION_ACCESS_MODEL.md.
 *   · Plan semantics (FREE/STANDARD/PRO/ENTERPRISE) live in the same
 *     domain layer (planAllows) — no billing provider is connected in
 *     this phase, per the phase constraints.
 *
 * This module is kept as a tombstone so stale imports fail loudly at
 * compile time instead of silently importing dead fabrication.
 */
export const RETIRED = true as const
