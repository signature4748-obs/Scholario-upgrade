'use client'

/**
 * SignatureUpload — teacher signature slot (Wave 2.3 §5).
 *
 * Same upload architecture as the admission documents: client
 * pre-validation (JPG/PNG/WebP · ≤1 MB · legible dimensions), then a real
 * server upload (magic-byte + dimension re-validation), stored under
 * db/uploads/teachers. No camera, no crop — the ORIGINAL file is stored
 * as uploaded so transparency and stroke contrast are never destroyed by
 * re-encoding. Preview renders on white so transparent PNGs look right.
 */

import { useRef, useState } from 'react'
import { FileSignature, Upload, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { TeacherMediaRecord } from '@/lib/store/teachers-store'
import {
  validateTeacherMedia,
  uploadTeacherMedia,
  deleteTeacherMediaFile,
  toMediaRecord,
  SIGNATURE_RULES,
} from './teacher-media'
import { SecureTeacherImg } from './secure-teacher-media'

interface Props {
  value: TeacherMediaRecord | null
  onChange: (media: TeacherMediaRecord | null) => void
}

export function SignatureUpload({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (e.target) e.target.value = ''

    const validationError = await validateTeacherMedia(file, 'signature')
    if (validationError) {
      toast.error(validationError)
      return
    }

    setUploading(true)
    try {
      const uploaded = await uploadTeacherMedia(file, 'signature')
      // Replacing an existing signature — remove the previous stored file.
      if (value) deleteTeacherMediaFile(value.fileId)
      onChange(toMediaRecord(uploaded))
      toast.success('Signature saved', {
        description: `${uploaded.fileName} · stored on the staff record.`,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    if (value) deleteTeacherMediaFile(value.fileId)
    onChange(null)
    toast.info('Signature removed')
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={SIGNATURE_RULES.accept}
        className="hidden"
        onChange={handleFile}
      />

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Preview — white background so transparent PNGs read correctly */}
        {value ? (
          <div className="shrink-0 rounded-xl border border-border bg-white p-2 shadow-xs">
            <SecureTeacherImg
              record={value}
              alt="Teacher signature"
              className="h-16 w-40 object-contain"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 h-20 w-40 rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary/50 hover:bg-primary/[0.03] transition-colors flex flex-col items-center justify-center gap-1.5 group disabled:opacity-60"
            aria-label="Upload signature"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            ) : (
              <>
                <FileSignature className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary/70 transition-colors" />
                <span className="text-[10px] font-medium text-muted-foreground">
                  PNG / JPG / WebP · ≤ 1 MB
                </span>
              </>
            )}
          </button>
        )}

        {/* Actions */}
        <div className="flex flex-row sm:flex-col gap-2 flex-wrap">
          {value ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="text-xs h-8 gap-1.5 w-fit"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                className="text-xs h-8 gap-1.5 w-fit text-rose-600 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </>
          ) : (
            !uploading && (
              <p className="text-[11px] text-muted-foreground sm:max-w-[220px]">
                A clear scan or photo of the employee&rsquo;s signature — used on official
                documents and records.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
