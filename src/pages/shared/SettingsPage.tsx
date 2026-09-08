import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ChangePasswordCard, SettingsCard } from '@/components/ChangePasswordCard'
import { friendlyError } from '@/lib/errors'
import type { AttendanceSettings } from '@/types/database'

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
    </div>
  )
}
