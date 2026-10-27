/**
 * Print-specific CSS injected globally to isolate the A4 application form
 * during browser print. Hidden by default; applied only inside the modal.
 *
 * ONE-PAGE CONTRACT (AF-2026.2): the complete form is a single A4 portrait
 * sheet. @page pins exact A4 geometry with zero UA margins (the sheet
 * carries its own 6–9 mm padding) and there is no page-break rule: the
 * content is sized to fit one page, so nothing can spill onto a second.
 *
 * The visibility-isolation alone is NOT enough: the form lives deep inside
 * the dashboard shell (h-screen / overflow-hidden / transformed framer-motion
 * containers). Any positioned, transformed or clipping ancestor would either
 * anchor the absolutely-positioned sheet off the page origin or clip it
 * entirely (symptom: a blank printed page). The `:has()` chain neutralises
 * EVERY ancestor of the form — overflow, height caps, transforms, filters
 * and positioning — so the sheet anchors to the printed page itself.
 * (:has is supported in every current Chrome/Edge/Safari/Firefox print
 * pipeline; browsers without it simply keep the legacy visibility behaviour.)
 */
export function ApplicationFormPrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        @page {
          size: A4 portrait;
          margin: 0;
        }
        html,
        body {
          height: auto !important;
          overflow: visible !important;
          background: white !important;
        }
        body * {
          visibility: hidden;
        }
        /* Neutralise every ancestor of the sheet: no clipping, no height
           caps, no transforms/filters, no positioning contexts. */
        body *:has(#a4-application-form) {
          overflow: visible !important;
          height: auto !important;
          max-height: none !important;
          position: static !important;
          transform: none !important;
          filter: none !important;
          backdrop-filter: none !important;
        }
        #a4-application-form,
        #a4-application-form * {
          visibility: visible !important;
        }
        #a4-application-form {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          margin: 0 !important;
          width: 210mm !important;
          background: white !important;
          color: black !important;
          box-shadow: none !important;
          border: none !important;
        }
        .no-print {
          display: none !important;
        }
      }
    `}</style>
  )
}
