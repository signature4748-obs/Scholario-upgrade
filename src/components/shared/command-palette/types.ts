import type { NavGroup } from '@/components/shell/app-shell'
import type { SearchResultItem } from '@/lib/search-service'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  groups?: NavGroup[]
  onNavigate: (key: string) => void
  role?: 'principal' | 'teacher' | 'student'
}

export type { SearchResultItem }
