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
}

export interface NavGroup {
  label: string
  items: NavItem[]
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
  principal: { accent: 'from-emerald-500 to-teal-600', glow: 'shadow-emerald-500/20' },
  teacher: { accent: 'from-amber-500 to-orange-600', glow: 'shadow-amber-500/20' },
  student: { accent: 'from-violet-500 to-purple-600', glow: 'shadow-violet-500/20' },
}
