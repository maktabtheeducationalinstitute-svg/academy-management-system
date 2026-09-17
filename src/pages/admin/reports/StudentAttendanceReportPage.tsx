import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { currentMonthValue, formatMonth, monthValueToDate, shiftMonthValue } from '@/lib/utils'
import { monthRange, toAttendanceDays, totalsOf } from '@/lib/reports'
import type { Attendance, Class, Student } from '@/types/database'

// The roll for one month, with each student's split between cards scanned at
// the desk and days a teacher marked by hand. Clicking a row opens that
// student's own page.
export function StudentAttendanceReportPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [rows, setRows] = useState<Attendance[]>([])
  const [month, setMonth] = useState(currentMonthValue())
  const [classFilter, setClassFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const range = monthRange(month)
      const [studentsRes, classesRes, attendanceRes] = await Promise.all([
        supabase.from('students').select('*').eq('enrollment_status', 'enrolled').order('full_name'),
        supabase.from('classes').select('*').order('name'),
        supabase.from('attendance').select('*').gte('date', range.start).lte('date', range.end),
      ])
      if (studentsRes.error) show(studentsRes.error.message, 'error')
      setStudents((studentsRes.data as Student[]) ?? [])
      setClasses((classesRes.data as Class[]) ?? [])
      setRows((attendanceRes.data as Attendance[]) ?? [])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const byStudent = useMemo(() => {
    const map = new Map<string, Attendance[]>()
    for (const r of rows) {
      const list = map.get(r.student_id) ?? []
      list.push(r)
      map.set(r.student_id, list)
    }
    return map
  }, [rows])

  const visible = students.filter((s) => classFilter === 'all' || s.class_id === classFilter)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Link to="/admin/reports" className="hover:underline">
            Reports
          </Link>{' '}
          / Student attendance
        </p>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Student attendance — {formatMonth(monthValueToDate(month))}
        </h1>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Month</label>
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
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Class</label>
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="w-56">
            <option value="all">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : visible.length === 0 ? (
        <EmptyState title="No students" description="No enrolled students match this filter." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Present</th>
                <th className="px-4 py-3">Absent</th>
                <th className="px-4 py-3">Late</th>
                <th className="px-4 py-3">Scanned</th>
                <th className="px-4 py-3">By teacher</th>
                <th className="px-4 py-3">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const t = totalsOf(toAttendanceDays(byStudent.get(s.id) ?? []))
                return (
                  <tr
                    key={s.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/reports/student-attendance/${s.id}?month=${month}`}
                        className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                      >
                        {s.full_name}
                      </Link>
                      <div className="font-mono text-xs text-slate-400 dark:text-slate-500">{s.barcode}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{t.present}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{t.absent}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{t.late}</td>
                    <td className="px-4 py-3 tabular-nums text-sky-700 dark:text-sky-400">{t.byScanner}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500 dark:text-slate-400">{t.byTeacher}</td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-800 dark:text-slate-100">
                      {t.marked === 0 ? '—' : `${t.percent}%`}
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
