export interface NavSubItem {
  key: string
  label: string
  icon?: React.ReactNode
}

export interface NavItem {
  key: string
  label: string
  icon: React.ReactNode
  badge?: number
  children?: NavSubItem[]
  /** ARCHITECTURE RESET — permission-aware navigation: when set, the item
   *  renders ONLY if the authenticated role holds this server-matrix
   *  capability (src/lib/security/permissions.ts). UI visibility is a
   *  courtesy — the API layer remains the authorization authority. */
  permission?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
  /** Optional permission gate on the whole group. */
  permission?: string
}

export interface ShellProps {
  groups: NavGroup[]
  activeKey: string
  onNavigate: (key: string) => void
  role: 'principal' | 'teacher' | 'student'
  roleLabel: string
  children: React.ReactNode
  quickAction?: { label: string; icon?: React.ReactNode; onClick: () => void }
}

export const roleStyles = {
  // ARCHITECTURE RESET — restrained role accents: a single solid tone per
  // role (no gradients, no glow shadows). Used only for small identity
  // chips, never for large surfaces.
  principal: { accent: 'bg-teal-600', chip: 'bg-teal-50 text-teal-700 border-teal-200' },
  teacher: { accent: 'bg-amber-600', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  student: { accent: 'bg-violet-600', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
}
