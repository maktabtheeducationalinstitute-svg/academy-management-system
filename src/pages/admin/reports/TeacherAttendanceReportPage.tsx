import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/EmptyState'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import { printElement } from '@/lib/printElement'
import { currentMonthValue, formatDate, formatMonth, monthValueToDate, shiftMonthValue } from '@/lib/utils'
import { loadTeacherAttendance, monthRange, totalsOf } from '@/lib/reports'
import type { AttendanceStatus, Class, Profile, Subject, Teacher, TeacherAttendance } from '@/types/database'
import { useRef } from 'react'

type Row = { id: string; name: string; status: Teacher['status'] }

function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="flex gap-1">
      <button
        onClick={() => setMonth(shiftMonthValue(month, -1))}
        className="rounded-lg border border-slate-300 px-2 text-sm dark:border-slate-600"
        aria-label="Previous month"
      >
        ‹
      </button>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
      />
      <button
        onClick={() => setMonth(shiftMonthValue(month, 1))}
        className="rounded-lg border border-slate-300 px-2 text-sm dark:border-slate-600"
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  )
}

// Every teacher's month at a glance. Teachers who have left are out by
// default, for the same reason they are off the salary table — nobody is
// tracking the attendance of somebody who no longer works here.
export function TeacherAttendanceReportPage() {
  const [teachers, setTeachers] = useState<Row[]>([])
  const [rows, setRows] = useState<TeacherAttendance[]>([])
  const [month, setMonth] = useState(currentMonthValue())
  const [includeLeft, setIncludeLeft] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const range = monthRange(month)
      const [profilesRes, attendanceRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
        supabase.from('teacher_attendance').select('*').gte('date', range.start).lte('date', range.end),
      ])
      const profiles = (profilesRes.data as Pick<Profile, 'id' | 'full_name'>[]) ?? []
      const ids = profiles.map((p) => p.id)
      const teachersRes = ids.length
        ? await supabase.from('teachers').select('*').in('id', ids)
        : { data: [] as Teacher[] }
      const byId = new Map(((teachersRes.data as Teacher[]) ?? []).map((t) => [t.id, t]))
      setTeachers(profiles.map((p) => ({ id: p.id, name: p.full_name, status: byId.get(p.id)?.status ?? 'active' })))
      setRows((attendanceRes.data as TeacherAttendance[]) ?? [])
      setLoading(false)
    }
    load()
  }, [month])

  const byTeacher = useMemo(() => {
    const map = new Map<string, { date: string; status: AttendanceStatus }[]>()
    for (const r of rows) {
      const list = map.get(r.teacher_id) ?? []
      list.push({ date: r.date, status: r.status })
      map.set(r.teacher_id, list)
    }
    return map
  }, [rows])

  const visible = includeLeft ? teachers : teachers.filter((t) => t.status !== 'left')
  const leftCount = teachers.filter((t) => t.status === 'left').length

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Link to="/admin/reports" className="hover:underline">
            Reports
          </Link>{' '}
          / Teacher attendance
        </p>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Teacher attendance — {formatMonth(monthValueToDate(month))}
        </h1>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Month</label>
          <MonthPicker month={month} setMonth={setMonth} />
        </div>
        {leftCount > 0 && (
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeLeft}
              onChange={(e) => setIncludeLeft(e.target.checked)}
              className="h-4 w-4"
            />
            Include teachers who have left ({leftCount})
          </label>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : visible.length === 0 ? (
        <EmptyState title="No teachers" description="No teachers to report on." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Present</th>
                <th className="px-4 py-3">Absent</th>
                <th className="px-4 py-3">Late</th>
                <th className="px-4 py-3">Days marked</th>
                <th className="px-4 py-3">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const totals = totalsOf(byTeacher.get(t.id) ?? [])
                return (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/reports/teacher-attendance/${t.id}?month=${month}`}
                        className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                      >
                        {t.name}
                      </Link>
                      {t.status === 'left' && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                          left
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{totals.present}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{totals.absent}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{totals.late}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500 dark:text-slate-400">{totals.marked}</td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-800 dark:text-slate-100">
                      {totals.marked === 0 ? '—' : `${totals.percent}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// One teacher's month, with the classes they teach beside it — the same
// side-by-side shape the student report uses.
export function TeacherAttendanceDetailPage() {
  const { teacherId } = useParams<{ teacherId: string }>()
  const [params] = useSearchParams()
  const month = params.get('month') ?? currentMonthValue()

  const [name, setName] = useState('')
  const [days, setDays] = useState<{ date: string; status: AttendanceStatus }[]>([])
  const [subjects, setSubjects] = useState<{ subject: string; className: string }[]>([])
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      if (!teacherId) return
      setLoading(true)
      const range = monthRange(month)
      const [profileRes, subjectsRes] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', teacherId).single(),
        supabase.from('subjects').select('name, class_id').eq('teacher_id', teacherId),
      ])
      setName((profileRes.data as { full_name: string } | null)?.full_name ?? 'Teacher')

      const subjectRows = (subjectsRes.data as Pick<Subject, 'name' | 'class_id'>[]) ?? []
      const classIds = [...new Set(subjectRows.map((s) => s.class_id))]
      const classesRes = classIds.length
        ? await supabase.from('classes').select('id, name').in('id', classIds)
        : { data: [] as Class[] }
      const classById = new Map(((classesRes.data as Class[]) ?? []).map((c) => [c.id, c.name]))
      setSubjects(subjectRows.map((s) => ({ subject: s.name, className: classById.get(s.class_id) ?? '—' })))

      setDays(await loadTeacherAttendance(teacherId, range))
      setLoading(false)
    }
    load()
  }, [teacherId, month])

  const totals = useMemo(() => totalsOf(days), [days])

  if (loading) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading report...</p>

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <Link to="/admin/reports" className="hover:underline">
              Reports
            </Link>{' '}
            /{' '}
            <Link to={`/admin/reports/teacher-attendance?month=${month}`} className="hover:underline">
              Teacher attendance
            </Link>{' '}
            / {name}
          </p>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {name} — {formatMonth(monthValueToDate(month))}
          </h1>
        </div>
        <Button variant="secondary" onClick={() => printElement(printRef.current)}>
          Print
        </Button>
      </div>

      <div ref={printRef} className="print-area space-y-4">
        <DocumentLetterhead subtitle={`Teacher Attendance — ${formatMonth(monthValueToDate(month))}`} />

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

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700/60 dark:text-slate-200">
              Attendance
            </h2>
            {days.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Nothing recorded this month.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                      <td className="px-4 py-2 tabular-nums text-slate-700 dark:text-slate-200">{formatDate(d.date)}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700/60 dark:text-slate-200">
              Subjects taught
            </h2>
            {subjects.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">No subjects assigned.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {subjects.map((s, i) => (
                  <li key={i} className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{s.subject}</span>
                    <span className="text-slate-500 dark:text-slate-400">{s.className}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
