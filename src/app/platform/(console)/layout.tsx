import { PlatformConsoleRoot } from '@/components/platform/console-root'

/**
 * /platform/(console) layout — every console page renders inside the
 * session provider + control-plane shell (client gate: 401 →
 * /platform/login; in production the middleware also redirects at the
 * edge). /platform/login itself lives OUTSIDE this group.
 */
export default function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  return <PlatformConsoleRoot>{children}</PlatformConsoleRoot>
}
