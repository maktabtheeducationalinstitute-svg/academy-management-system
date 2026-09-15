import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ChangePasswordCard, SettingsCard } from '@/components/ChangePasswordCard'
import { friendlyError } from '@/lib/errors'
import { MAX_UPLOAD_BYTES, deleteSignature, prepareSignature, signSignatureUrl, uploadSignature } from '@/lib/instituteAssets'
import type { AttendanceSettings, InstituteSettings } from '@/types/database'

// The attendance rules an admin can tune without a code change. Each one is a
// policy decision the academy owns, so the wording is about what happens at the
// door rather than what the column is called.
const TIMING_FIELDS = [
  {
    key: 'grace_minutes' as const,
    label: 'Grace period (minutes)',
    help: 'Arriving within this many minutes of the class start still counts as on time.',
  },
  {
    key: 'very_late_minutes' as const,
    label: 'Very late after (minutes)',
    help: 'Past this, the arrival is flagged for the office as well as marked late.',
  },
]

/**
 * Shared by every signed-in role. Everyone gets their own password; only an
 * admin gets the academy-wide attendance rules.
 */
export function SettingsPage() {
  const { profile } = useAuth()
  const { show } = useToast()
  const isAdmin = profile?.role === 'admin'

  const [timing, setTiming] = useState<Record<string, string>>({})
  const [loadingTiming, setLoadingTiming] = useState(true)
  const [savingTiming, setSavingTiming] = useState(false)

  const [signaturePath, setSignaturePath] = useState<string | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [loadingSignature, setLoadingSignature] = useState(true)
  const [savingSignature, setSavingSignature] = useState(false)
  const [signatureError, setSignatureError] = useState<string | null>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isAdmin) return
    async function loadSettings() {
      const { data, error } = await supabase.from('attendance_settings').select('*').eq('id', 1).single()
      if (error) {
        show(friendlyError(error.message), 'error')
      } else if (data) {
        const row = data as AttendanceSettings
        setTiming(Object.fromEntries(TIMING_FIELDS.map((f) => [f.key, String(row[f.key])])))
      }
      setLoadingTiming(false)
    }
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    async function loadSignature() {
      setLoadingSignature(true)
      const { data, error } = await supabase.from('institute_settings').select('*').eq('id', 1).single()
      if (error) {
        show(friendlyError(error.message), 'error')
        setLoadingSignature(false)
        return
      }
      const row = data as InstituteSettings
      setSignaturePath(row.principal_signature_path)
      if (row.principal_signature_path) {
        setSignatureUrl(await signSignatureUrl(row.principal_signature_path))
      }
      setLoadingSignature(false)
    }
    loadSignature()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function handleSignatureFile(file: File) {
    setSignatureError(null)
    if (!file.type.startsWith('image/')) {
      setSignatureError('Choose an image file — a JPG or PNG.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setSignatureError('That image is over 10 MB. Choose a smaller one.')
      return
    }
    setSavingSignature(true)
    try {
      const blob = await prepareSignature(file)
      const path = await uploadSignature(blob)
      const { error } = await supabase.from('institute_settings').update({ principal_signature_path: path }).eq('id', 1)
      if (error) throw new Error(error.message)
      setSignaturePath(path)
      setSignatureUrl(await signSignatureUrl(path))
      show('Principal signature saved. It will appear on every printed student card.')
    } catch (e) {
      setSignatureError(e instanceof Error ? e.message : 'Could not save that image.')
    } finally {
      setSavingSignature(false)
    }
  }

  async function handleSignatureRemove() {
    if (!signaturePath) return
    setSavingSignature(true)
    try {
      await deleteSignature(signaturePath)
      const { error } = await supabase.from('institute_settings').update({ principal_signature_path: null }).eq('id', 1)
      if (error) throw new Error(error.message)
      setSignaturePath(null)
      setSignatureUrl(null)
      show('Principal signature removed.')
    } catch (e) {
      setSignatureError(e instanceof Error ? e.message : 'Could not remove that image.')
    } finally {
      setSavingSignature(false)
    }
  }

  async function handleTimingSave() {
    const payload: Record<string, number> = {}
    for (const field of TIMING_FIELDS) {
      const value = Number(timing[field.key])
      if (!Number.isInteger(value) || value < 0) {
        show(`${field.label} must be a whole number of 0 or more.`, 'error')
        return
      }
      payload[field.key] = value
    }
    if (payload.grace_minutes > payload.very_late_minutes) {
      show('The grace period cannot be longer than the very-late threshold.', 'error')
      return
    }

    setSavingTiming(true)
    const { error } = await supabase.from('attendance_settings').update(payload).eq('id', 1)
    setSavingTiming(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show('Attendance rules updated.')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-cream-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {isAdmin
            ? 'Your own password, and the rules the attendance desk follows.'
            : 'Your account.'}
        </p>
      </div>

      <ChangePasswordCard />

      {isAdmin && (
        <SettingsCard
          title="Attendance rules"
          description="How the desk reads a scan. These take effect on the next card, with no redeploy."
        >
          {loadingTiming ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {TIMING_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Field label={field.label}>
                      <Input
                        type="number"
                        min={0}
                        value={timing[field.key] ?? ''}
                        onChange={(e) => setTiming({ ...timing, [field.key]: e.target.value })}
                      />
                    </Field>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{field.help}</p>
                  </div>
                ))}
              </div>
              <Button onClick={handleTimingSave} disabled={savingTiming}>
                {savingTiming ? 'Saving...' : 'Save rules'}
              </Button>
            </div>
          )}
        </SettingsCard>
      )}

      {isAdmin && (
        <SettingsCard
          title="Principal signature"
          description="Uploaded once here, printed on every student's ID card — no need to sign each one by hand."
        >
          {loadingSignature ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900">
                {signatureUrl ? (
                  <img src={signatureUrl} alt="Principal signature" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500">None uploaded</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <input
                  ref={signatureInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleSignatureFile(f)
                    e.target.value = ''
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => signatureInputRef.current?.click()}
                    disabled={savingSignature}
                  >
                    {savingSignature ? 'Saving...' : signatureUrl ? 'Change signature' : 'Upload signature'}
                  </Button>
                  {signatureUrl && (
                    <Button type="button" variant="ghost" onClick={handleSignatureRemove} disabled={savingSignature}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                  A photo or scan of the signature on a plain background works best. Cropped to fit and shrunk
                  before saving.
                </p>
                {signatureError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{signatureError}</p>}
              </div>
            </div>
          )}
        </SettingsCard>
      )}
    </div>
  )
}
