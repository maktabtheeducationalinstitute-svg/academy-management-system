import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { LabelText } from '@/components/ui/Input'
import { MAX_UPLOAD_BYTES, initialsOf, preparePhoto } from '@/lib/studentPhotos'

/**
 * Picks a photo for the ID card and hands back a prepared JPEG.
 *
 * The image is resized and centre-cropped in the browser before it goes
 * anywhere, so a 6 MB phone photo becomes a few tens of kilobytes and the card
 * layout can rely on a fixed 4:5 frame. Nothing is uploaded here — the caller
 * saves it alongside the rest of the form, so cancelling a half-filled form
 * leaves no stray file behind.
 */
export function StudentPhotoField({
  studentName,
  existingUrl,
  onPick,
  onRemove,
}: {
  studentName: string
  /** Signed link to the photo already on file, if any. */
  existingUrl?: string
  /** Called with the prepared JPEG, or null when the pick is cleared. */
  onPick: (blob: Blob | null) => void
  /** Called when an existing photo should be deleted on save. */
  onRemove: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // A blob: URL stays allocated until it is revoked, so the preview is cleaned
  // up when it is replaced or the form closes.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const shown = removed ? null : (preview ?? existingUrl ?? null)

  async function handleFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file — a JPG or PNG.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is over 10 MB. Choose a smaller one.')
      return
    }
    setBusy(true)
    try {
      const blob = await preparePhoto(file)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(blob))
      setRemoved(false)
      onPick(blob)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.')
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    onPick(null)
    if (existingUrl) {
      setRemoved(true)
      onRemove()
    }
  }

  return (
    <div>
      <LabelText>Photo</LabelText>
      <div className="mt-1 flex items-start gap-3">
        <div className="flex h-24 w-[76.8px] shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-900">
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-semibold text-slate-400 dark:text-slate-500">
              {initialsOf(studentName || '?')}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? 'Preparing...' : shown ? 'Change photo' : 'Choose photo'}
            </Button>
            {shown && (
              <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
            Printed about 20&times;25&nbsp;mm on the card. Any photo works &mdash; it is cropped to a
            portrait shape and shrunk before saving.
          </p>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}
