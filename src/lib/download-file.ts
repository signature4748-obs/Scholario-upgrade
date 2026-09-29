'use client'

/**
 * download-file — real client-side file delivery helpers.
 *
 * One shared implementation for every "Download" action in the Principal
 * workspace (Certificates history, Downloads library, exports). Produces a
 * genuine Blob file — never a toast-only stub.
 */

/** Trigger a real browser download of an HTML document snapshot. */
export function downloadHTMLFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Trigger a real browser download of a CSV string. */
export function downloadCSVFile(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Open a printable document in a new window and invoke the browser print
 * dialog. Used by Download drawers where the module's in-app print CSS
 * cannot isolate the preview (documents render inside portals/drawers).
 */
export function openPrintWindow(html: string, _title: string): Window | null {
  const w = window.open('', '_blank', 'width=860,height=1000')
  if (!w) return null
  w.document.write(html)
  w.document.close()
  w.focus()
  // Give the new document a moment to lay out before printing.
  w.setTimeout(() => {
    try {
      w.print()
    } catch {
      // User may have closed the window already — non-fatal.
    }
  }, 400)
  return w
}

/** Sanitize a document label into a safe file name. */
export function safeFileName(label: string, ext: string): string {
  const base = label.replace(/[^A-Za-z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 80)
  return `${base || 'document'}.${ext}`
}

/**
 * Share a document reference. Uses the Web Share API when available,
 * otherwise copies the reference text to the clipboard.
 * Returns 'shared' | 'copied' | 'cancelled'.
 */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch {
      // User dismissed the share sheet — treat as cancelled, don't also copy.
      return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'cancelled'
  }
}
