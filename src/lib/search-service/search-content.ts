// Content-domain search — RETIRED MOCK CORPUS (search leak fix).
//
// History: this module matched the query against the fabricated
// `libraryBooks` (BK001-008) and `notifications` (N01-N010) corpora from
// `@/lib/mock/operations`. The palette's FINAL-GATE already dropped the
// 'notice'-type local results (server /api/search is the entity truth),
// but 'book' was NOT in the gate — fabricated library books rendered in
// the PRODUCTION command palette mixed with real DB rows, deep-linking
// into the mock Library module.
//
// Now: the mock corpora are gone entirely. Entity results for the
// content domain come from the server (/api/search — students, teachers,
// fees, notices, messages, …; /api/library for the Library module once
// its UI is server-wired). This function stays exported for its single
// call site (search-entities.ts) and honestly returns no local matches.

import type { SearchResultItem } from './types'

type Role = 'principal' | 'teacher' | 'student' | 'superadmin' | 'parent'

/**
 * Local content-domain search — retired (honest empty).
 * See the module header: fabricated books/notices must never render in
 * the palette; the debounced server search is the only entity source.
 */
export function searchContent(_q: string, _role: Role = 'principal'): SearchResultItem[] {
  return []
}
