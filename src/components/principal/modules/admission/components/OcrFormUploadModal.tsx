'use client'

/**
 * OCR Assisted Filled Form Upload Modal — REAL OCR (tesseract.js engine,
 * bundled locally from /tesseract — no CDN dependency).
 *
 * Flow: SCAN / IMPORT → capture (camera) or upload (JPG/PNG) → the engine
 * actually reads the image (real progress) → extracted fields are matched
 * onto the admission draft fields → the Principal reviews/edits low-
 * confidence values → Apply ONLY fills the wizard draft. Nothing is ever
 * auto-submitted.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  UploadCloud, X, RefreshCw, ArrowRight, Camera, FileImage,
  AlertTriangle, Plus, ScanLine, CheckCircle2, PencilLine,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import {
  extractAdmissionFields,
  flattenTesseractLines,
  type ExtractedField,
  type OcrLine,
} from '../lib/ocr-extract'
import type { FormData } from '../constants'

type Stage = 'entry' | 'processing' | 'review' | 'error'

/** Honest processing phase labels shown during the scan. */
const PHASES = [
  'Reading the form image…',
  'Recognising text (engine progress below)…',
  'Matching fields to the admission draft…',
] as const

export function OcrFormUploadModal({
  open,
  onClose,
  onApplyData,
  onManualEntry,
}: {
  open: boolean
  onClose: () => void
  onApplyData: (
    data: Partial<FormData>,
    attachment: { fileName: string; date: string; confidence: number }
  ) => void
  /** Close the modal and open the wizard for manual entry. */
  onManualEntry?: () => void
}) {
  const [stage, setStage] = useState<Stage>('entry')
  const [phase, setPhase] = useState(0)
  const [progress, setProgress] = useState(0)
  const [pages, setPages] = useState<Array<{ name: string; dataUrl: string }>>([])
  const [allLines, setAllLines] = useState<OcrLine[]>([])
  const [overallConfidence, setOverallConfidence] = useState(0)
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStage('entry')
    setPhase(0)
    setProgress(0)
    setPages([])
    setAllLines([])
    setOverallConfidence(0)
    setFields([])
    setErrorMsg('')
  }, [])

  useDismissOnEscape(() => {
    onClose()
  }, open)

  // Reset whenever the modal opens fresh
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const processImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setStage('error')
        setErrorMsg('This file type is not supported.')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setStage('error')
        setErrorMsg('File is too large. Maximum size is 5 MB.')
        return
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      setPages((prev) => [...prev, { name: file.name, dataUrl }])
      setStage('processing')
      setPhase(0)
      setProgress(0)

      try {
        setPhase(0)
        // Small delay so the first phase label is visible
        await new Promise((r) => setTimeout(r, 350))
        setPhase(1)

        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker('eng', 1, {
          // Locally bundled engine (public/tesseract) — no CDN dependency.
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/core',
          langPath: '/tesseract/lang',
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              setProgress(Math.round(m.progress * 100))
            }
          },
        })

        let result: any
        try {
          result = await worker.recognize(dataUrl, {}, { text: true, blocks: true })
        } finally {
          await worker.terminate()
        }

        const text: string = result?.data?.text ?? ''
        const overall: number = result?.data?.confidence ?? 0
        const lines = flattenTesseractLines(
          result?.data?.blocks,
          text,
          typeof overall === 'number' && overall > 0 ? overall : 60
        )

        setPhase(2)
        await new Promise((r) => setTimeout(r, 400))

        if (text.trim().length < 10 || lines.length === 0) {
          setStage('error')
          setErrorMsg(
            'Could not read this document clearly. Use a sharper, well-lit photo of the filled form, or enter the details manually.'
          )
          return
        }

        const merged = [...allLines, ...lines]
        setAllLines(merged)
        const extracted = extractAdmissionFields(
          merged,
          typeof overall === 'number' ? overall : 60
        )
        setOverallConfidence(Math.round(overall))
        setFields(extracted)

        if (extracted.length === 0) {
          setStage('error')
          setErrorMsg(
            'Text was read, but no admission fields could be matched on this page. Scan the page with the student details, or enter the details manually.'
          )
          return
        }
        setStage('review')
      } catch (err) {
        console.error('OCR failed', err)
        setStage('error')
        setErrorMsg('The scan could not be processed. Please try again.')
      }
    },
    [allLines]
  )

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processImage(file)
    e.target.value = ''
  }

  const handleFieldValueChange = (index: number, val: string) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value: val } : f)))
  }

  const handleApply = () => {
    const updated: Partial<FormData> = {}
    fields.forEach((f) => {
      ;(updated as any)[f.fieldKey] = f.value
    })
    onApplyData(updated, {
      fileName: pages.map((p) => p.name).join(', ') || 'Scanned form',
      date: new Date().toISOString(),
      confidence: overallConfidence,
    })
  }

  if (!open) return null

  const lowCount = fields.filter((f) => f.needsReview).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan or import a filled application form"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-foreground">Scan / Import Application</h3>
              <p className="text-xs text-muted-foreground">
                Photo or upload a filled paper form
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close scan dialog" title="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={handleCameraChange}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleCameraChange}
        />

        {/* ============ ENTRY ============ */}
        {stage === 'entry' && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="rounded-2xl border-2 border-dashed border-border hover:border-emerald-500 bg-card/40 hover:bg-emerald-500/5 p-6 text-center transition-all group space-y-2"
              >
                <Camera className="h-8 w-8 mx-auto text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                <p className="text-sm font-semibold">Take Photo</p>
                <p className="text-[11px] text-muted-foreground">Use the device camera on the filled form</p>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-2xl border-2 border-dashed border-border hover:border-emerald-500 bg-card/40 hover:bg-emerald-500/5 p-6 text-center transition-all group space-y-2"
              >
                <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                <p className="text-sm font-semibold">Upload File</p>
                <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP scan of the form</p>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              The form is read on this device. Extracted values populate the draft for your review —
              nothing is submitted automatically.
            </p>
          </div>
        )}

        {/* ============ PROCESSING ============ */}
        {stage === 'processing' && (
          <div className="space-y-4">
            {/* Last page preview with scan animation */}
            {pages.length > 0 && (
              <div className="relative rounded-xl overflow-hidden border border-border max-h-56 mx-auto w-fit">
                <img
                  src={pages[pages.length - 1].dataUrl}
                  alt="Scanned form page"
                  className="max-h-56 object-contain"
                />
                <motion.div
                  className="absolute left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_12px_2px_rgba(16,185,129,0.7)]"
                  animate={{ top: ['4%', '94%', '4%'] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            )}
            <div className="py-4 flex flex-col items-center justify-center text-center space-y-3">
              <RefreshCw className="h-8 w-8 text-emerald-600 animate-spin" />
              <p className="font-semibold text-sm">{PHASES[phase]}</p>
              {phase === 1 && (
                <div className="w-64 max-w-full">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{progress}%</p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {pages.length > 1 ? `Page ${pages.length} of the scanned form` : 'Reading the document…'}
              </p>
            </div>
          </div>
        )}

        {/* ============ REVIEW ============ */}
        {stage === 'review' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <PencilLine className="h-3.5 w-3.5" />
                Extracted fields — review before applying
              </p>
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                Engine confidence: {overallConfidence}%
              </Badge>
            </div>

            {lowCount > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground">
                  <span className="font-semibold">{lowCount} field{lowCount > 1 ? 's' : ''} marked ⚠ Review</span>{' '}
                  <span className="text-muted-foreground">— the engine was less certain about these values. Please check them against the form.</span>
                </p>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto border border-border rounded-xl divide-y divide-border/50 text-xs">
              {fields.map((f, i) => (
                <div key={f.fieldKey} className="p-2.5 flex items-center justify-between gap-3 hover:bg-muted/30">
                  <span className="w-32 font-semibold text-muted-foreground shrink-0">{f.label}</span>
                  <input
                    type="text"
                    value={f.value}
                    onChange={(e) => handleFieldValueChange(i, e.target.value)}
                    className={cn(
                      'flex-1 min-w-0 rounded-lg border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary',
                      f.needsReview ? 'border-amber-500/50' : 'border-border'
                    )}
                  />
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[9px] shrink-0',
                      f.confidence >= 85
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {f.needsReview ? `⚠ ${f.confidence}%` : `${f.confidence}%`}
                  </Badge>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Applying fills the admission wizard draft — you verify and submit from the Review step.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setStage('entry') }} className="text-xs gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Scan Another Page
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} className="text-xs">
                  Start Over
                </Button>
              </div>
              <Button onClick={handleApply} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs gap-1.5">
                Apply to Admission Draft <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ============ ERROR ============ */}
        {stage === 'error' && (
          <div className="space-y-4">
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <p className="font-semibold text-sm">Could not read this document clearly</p>
              <p className="text-xs text-muted-foreground max-w-md">{errorMsg}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setStage('entry')} className="text-xs">
                Try Again
              </Button>
              <Button variant="outline" size="sm" onClick={() => { reset(); setTimeout(() => fileInputRef.current?.click(), 50) }} className="text-xs">
                Upload Different File
              </Button>
              {onManualEntry && (
                <Button size="sm" onClick={onManualEntry} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                  <FileImage className="h-3.5 w-3.5" />
                  Enter Manually
                </Button>
              )}
            </div>
            {/* Keep pages already scanned — partial data is never lost. */}
            {pages.length > 0 && (
              <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {pages.length} scanned page{pages.length > 1 ? 's' : ''} kept — scanning another page adds to them.
              </p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
