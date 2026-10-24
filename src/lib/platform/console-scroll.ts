// ============================================================
// console-scroll.ts — the control-plane scroll contract
// ------------------------------------------------------------
// ISSUE 1 (super-admin scroll trap, 2026-10 audit): the console used
// to run on the DOCUMENT scroll model (min-h-screen wrapper, fixed
// sidebar, mobile-only sticky header) — tab switches scrollIntoView'd
// the tabs bar with a scroll-mt-20 pin, so every school-detail tab
// landed BELOW the page top with the breadcrumb/stats pushed out of
// view, and the blanket `* { scroll-behavior: smooth }` animated
// every programmatic scroll (janky, interruptible on iPadOS WebKit).
//
// The rewritten ConsoleShell is the school AppShell's proven model:
// a fixed-viewport shell (100dvh + 100vh fallback, overflow-hidden) +
// ONE inner content scroller carrying [data-console-scroll]. Every
// "back to top" in the console scrolls THAT scroller — never the
// document (which does not scroll) — and always INSTANTLY: the audit
// explicitly forbids re-introducing animated programmatic scrolls
// here (the iPadOS animation-fight was half the defect).
// ============================================================

/** Attribute identifying the console's single inner content scroller. */
export const CONSOLE_SCROLL_ATTR = 'data-console-scroll'

/**
 * Scroll the console content to the very top — instantly.
 *
 * Order of operations:
 *   1. the ConsoleShell's inner scroller ([data-console-scroll]) —
 *      the ONLY scrollable element on a console page;
 *   2. fallback: the document (for any console-adjacent surface that
 *      is ever rendered outside the shell — none today; kept so the
 *      helper can never silently no-op).
 */
export function scrollConsoleToTop(): void {
  if (typeof document === 'undefined') return
  const scroller = document.querySelector<HTMLElement>(`[${CONSOLE_SCROLL_ATTR}]`)
  if (scroller) {
    // Instant by construction: the smooth-scroll blanket is gone, and
    // scrollTop assignment is never animated.
    scroller.scrollTop = 0
    return
  }
  if (typeof window !== 'undefined') {
    window.scrollTo(0, 0)
  }
}
