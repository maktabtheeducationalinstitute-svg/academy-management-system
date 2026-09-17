import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import { printElement } from '@/lib/printElement'
import { currentMonthValue, formatClockTime, formatDate, formatMinutes, formatMonth, monthValueToDate } from '@/lib/utils'
import {
  loadClassTeacherIds,
  loadStudentAttendance,
  loadTeacherAttendance,
  monthRange,
  totalsOf,
  type AttendanceDay,
} from '@/lib/reports'
import type { AttendanceStatus, Class, Profile, Student } from '@/types/database'

interface TeacherMonth {
  id: string
  name: string
  days: { date: string; status: AttendanceStatus }[]
}

function StatusPill({ status }: { status: AttendanceStatus }) {
  const cls =
    status === 'present'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : status === 'late'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
}

// One student's month. The two halves sit side by side the way the fee voucher's
// two copies do — the student's own days on the left, the attendance of whoever
// was meant to be teaching them on the right, so a run of absences can be read
// against whether the class was actually being taught those days.
export function StudentAttendanceDetailPage() {
  const { studentId } = useParams<{ studentId: string }>()
  const [params] = useSearchParams()
  const month = params.get('month') ?? currentMonthValue()

  const [student, setStudent] = useState<Student | null>(null)
  const [cls, setCls] = useState<Class | null>(null)
  const [days, setDays] = useState<AttendanceDay[]>([])
  const [teachers, setTeachers] = useState<TeacherMonth[]>([])
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      if (!studentId) return
      setLoading(true)
      const range = monthRange(month)

      const { data: studentRow } = await supabase.from('students').select('*').eq('id', studentId).single()
      const s = studentRow as Student | null
      setStudent(s)

      if (s?.class_id) {
        const { data: classRow } = await supabase.from('classes').select('*').eq('id', s.class_id).single()
        setCls((classRow as Class) ?? null)
      } else {
        setCls(null)
      }

      setDays(await loadStudentAttendance(studentId, range))

      // Whoever teaches this class, and how often they were in that month.
      if (s?.class_id) {
        const teacherIds = await loadClassTeacherIds(s.class_id)
        if (teacherIds.length > 0) {
          const { data: profileRows } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', teacherIds)
          const names = new Map(
            ((profileRows as Pick<Profile, 'id' | 'full_name'>[]) ?? []).map((p) => [p.id, p.full_name])
          )
          setTeachers(
            await Promise.all(
              teacherIds.map(async (id) => ({
                id,
                name: names.get(id) ?? 'Teacher',
                days: await loadTeacherAttendance(id, range),
              }))
            )
          )
        } else {
          setTeachers([])
        }
      } else {
        setTeachers([])
      }
      setLoading(false)
    }
    load()
  }, [studentId, month])

  const totals = useMemo(() => totalsOf(days), [days])

  if (loading) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading report...</p>
  if (!student) return <p className="text-sm text-slate-500">Student not found.</p>

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <Link to="/admin/reports" className="hover:underline">
              Reports
            </Link>{' '}
            /{' '}
            <Link to={`/admin/reports/student-attendance?month=${month}`} className="hover:underline">
              Student attendance
            </Link>{' '}
            / {student.full_name}
          </p>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {student.full_name} — {formatMonth(monthValueToDate(month))}
          </h1>
        </div>
        <Button variant="secondary" onClick={() => printElement(printRef.current)}>
          Print
        </Button>
      </div>

      <div ref={printRef} className="print-area space-y-4">
        <DocumentLetterhead subtitle={`Attendance Report — ${formatMonth(monthValueToDate(month))}`} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Present', value: totals.present },
            { label: 'Absent', value: totals.absent },
            { label: 'Late', value: totals.late },
            { label: 'Attendance', value: totals.marked === 0 ? '—' : `${totals.percent}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Side by side, like the voucher's two copies. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/60">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {student.full_name} — {cls?.name ?? 'Unassigned'}
              </h2>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {totals.byScanner} scanned · {totals.byTeacher} by teacher
              </span>
            </div>
            {days.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">
                No attendance recorded this month.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                      <td className="px-4 py-2 tabular-nums text-slate-700 dark:text-slate-200">{formatDate(d.date)}</td>
                      <td className="px-4 py-2">
                        <StatusPill status={d.status} />
                        {d.status === 'late' && d.lateMinutes !== null && (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                            {formatMinutes(d.lateMinutes)} late
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {d.source === 'scanner' ? (
                          <span className="text-sky-700 dark:text-sky-400">
                            Card scanned{d.checkInAt ? ` · ${formatClockTime(d.checkInAt)}` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">Marked by teacher</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/60">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Teachers of {cls?.name ?? 'this class'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                Same month, so a run of absences can be read against whether the class was being taught.
              </p>
            </div>
            {teachers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">
                No teacher is assigned to a subject in this class.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {teachers.map((t) => {
                  const tt = totalsOf(t.days)
                  return (
                    <li key={t.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link
                          to={`/admin/reports/teacher-attendance/${t.id}?month=${month}`}
                          className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
                        >
                          {t.name}
                        </Link>
                        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {tt.marked === 0 ? 'no record' : `${tt.present} present · ${tt.absent} absent · ${tt.percent}%`}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
