'use client'

/**
 * print-isolate — window.print() that prints ONLY the given element.
 *
 * The established #print-root + body-class isolation pattern (salary
 * payslip, applications tour form), extracted so every in-app document
 * that prints via window.print() can use it: the target is cloned into a
 * dedicated #print-root at document.body level, and while the print
 * dialog is open every other top-level element (app shell, dialogs,
 * portals, toasts) is display:none via the `document-printing` body
 * class. Restored on afterprint. This avoids the classic "the sidebar
 * prints with the document" bug for documents without their own
 * standalone print window.
 *
 * Print sizing stays the caller's concern (its own @page rules / print:
 * classes carry over with the clone).
 */

const BODY_CLASS = 'document-printing'

export function printIsolated(el: HTMLElement | null): void {
  if (typeof window === 'undefined') return
  if (!el) {
    window.print()
    return
  }

  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.appendChild(root)
  }
  root.replaceChildren(el.cloneNode(true))
  document.body.classList.add(BODY_CLASS)

  const cleanup = () => {
    document.body.classList.remove(BODY_CLASS)
    root?.replaceChildren()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  // Safety net: browsers that never fire afterprint (or cancel paths).
  setTimeout(cleanup, 60_000)

  window.print()
}
