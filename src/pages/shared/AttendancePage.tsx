import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { formatClockTime, formatDate, formatMinutes } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import { downloadAttendanceSheetPdf } from '@/lib/pdf'
import { TeacherAttendanceSection } from '@/components/TeacherAttendanceSection'
import type { Attendance, AttendanceReviewReason, AttendanceStatus, Class, Student } from '@/types/database'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const REVIEW_LABEL: Record<AttendanceReviewReason, string> = {
  very_late: 'Very late',
}

// What the desk scanner recorded for one student on this date. A dash means
// nobody scanned a card — the row is whatever the teacher marks by hand.
function ScanCell({ row }: { row: Attendance | undefined }) {
  if (!row || !row.check_in_at) {
    return <span className="text-slate-300 dark:text-slate-600">—</span>
  }

  return (
    <div className="leading-tight">
      <span className="tabular-nums text-slate-700 dark:text-slate-200">
        {formatClockTime(row.check_in_at)}
      </span>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {row.status === 'late' && row.late_minutes !== null && (
          <span className="text-amber-600 dark:text-amber-400">{formatMinutes(row.late_minutes)} late</span>
        )}
        {row.review_reason && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-inset ring-red-600/15 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-400/20">
            {REVIEW_LABEL[row.review_reason]}
          </span>
        )}
      </div>
    </div>
  )
}

export function AttendancePage() {
  const { profile } = useAuth()
  const { show } = useToast()
  // Admins don't mark student attendance — that's a teacher's job. Admins land
  // on the Teachers view; if they do switch to Students, they only get the
  // read-only Defaulters tab, never Mark Attendance.
  const isAdmin = profile?.role === 'admin'
  const [entity, setEntity] = useState<'students' | 'teachers'>(isAdmin ? 'teachers' : 'students')
  const [tab, setTab] = useState<'mark' | 'history'>(isAdmin ? 'history' : 'mark')
  const [classes, setClasses] = useState<Class[]>([])
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [students, setStudents] = useState<Student[]>([])
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({})
  // The scanner's side of the same rows: what the desk recorded, so a teacher
  // marking the register can see who actually walked through the door and when.
  const [scanned, setScanned] = useState<Record<string, Attendance>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [threshold, setThreshold] = useState(75)
  const [thresholdInput, setThresholdInput] = useState('75')
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [allAttendance, setAllAttendance] = useState<Attendance[]>([])
  const [allStudents, setAllStudents] = useState<Student[]>([])

  useEffect(() => {
    async function loadClasses() {
      const { data, error } = await supabase.from('classes').select('*').order('name')
      if (error) show(error.message, 'error')
      else {
        setClasses(data as Class[])
        if (data && data.length > 0) setClassId((data as Class[])[0].id)
      }
    }
    loadClasses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function loadRoster() {
      if (!classId) {
        setStudents([])
        return
      }
      setLoading(true)
      const [studentsRes, attendanceRes] = await Promise.all([
        supabase.from('students').select('*').eq('class_id', classId).eq('enrollment_status', 'enrolled').order('full_name'),
        supabase.from('attendance').select('*').eq('class_id', classId).eq('date', date),
      ])
      if (studentsRes.error) show(studentsRes.error.message, 'error')
      else setStudents(studentsRes.data as Student[])
      const initialMarks: Record<string, AttendanceStatus> = {}
      const scans: Record<string, Attendance> = {}
      if (attendanceRes.data) {
        for (const row of attendanceRes.data as Attendance[]) {
          initialMarks[row.student_id] = row.status
          scans[row.student_id] = row
        }
      }
      setMarks(initialMarks)
      setScanned(scans)
      setLoading(false)
    }
    loadRoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, date])

  useEffect(() => {
    if (tab !== 'history') return
    async function loadHistory() {
      const [settingsRes, attendanceRes, studentsRes] = await Promise.all([
        supabase.from('attendance_settings').select('*').eq('id', 1).single(),
        supabase.from('attendance').select('*'),
        supabase.from('students').select('*').eq('enrollment_status', 'enrolled'),
      ])
      if (settingsRes.data) {
        const pct = (settingsRes.data as { threshold_percent: number }).threshold_percent
        setThreshold(pct)
        setThresholdInput(String(pct))
      }
      if (attendanceRes.data) setAllAttendance(attendanceRes.data as Attendance[])
      if (studentsRes.data) setAllStudents(studentsRes.data as Student[])
    }
    loadHistory()
  }, [tab])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const defaulters = useMemo(() => {
    const byStudent = new Map<string, { present: number; total: number }>()
    for (const row of allAttendance) {
      const entry = byStudent.get(row.student_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (row.status === 'present' || row.status === 'late') entry.present += 1
      byStudent.set(row.student_id, entry)
    }
    const studentById = new Map(allStudents.map((s) => [s.id, s]))
    const rows: { student: Student; percent: number; present: number; total: number }[] = []
    for (const [studentId, stats] of byStudent) {
      const student = studentById.get(studentId)
      if (!student) continue
      const percent = stats.total > 0 ? Math.round((stats.present / stats.total) * 1000) / 10 : 0
      if (percent < threshold) {
        rows.push({ student, percent, present: stats.present, total: stats.total })
      }
    }
    return rows.sort((a, b) => a.percent - b.percent)
  }, [allAttendance, allStudents, threshold])

  async function handleSave() {
    if (!classId || students.length === 0) return
    setSaving(true)
    const rows = students
      .filter((s) => marks[s.id])
      .map((s) => ({
        student_id: s.id,
        class_id: classId,
        date,
        status: marks[s.id],
        marked_by: profile!.id,
      }))
    if (rows.length === 0) {
      setSaving(false)
      show('Mark at least one student before saving.', 'error')
      return
    }
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' })
    setSaving(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show('Attendance saved.')
  }

  function markAll(status: AttendanceStatus) {
    const next: Record<string, AttendanceStatus> = {}
    for (const s of students) next[s.id] = status
    setMarks(next)
  }

  async function handleDownloadPdf() {
    if (students.length === 0) {
      show('No students to include in the sheet.', 'error')
      return
    }
    await downloadAttendanceSheetPdf({
      className: classById.get(classId)?.name ?? 'Class',
      date,
      rows: students.map((s) => ({ name: s.full_name, status: marks[s.id] ?? '' })),
    })
  }

  async function saveThreshold() {
    const value = Number(thresholdInput)
    if (Number.isNaN(value) || value < 0 || value > 100) {
      show('Threshold must be a number between 0 and 100.', 'error')
      return
    }
    setSavingThreshold(true)
    const { error } = await supabase.from('attendance_settings').update({ threshold_percent: value }).eq('id', 1)
    setSavingThreshold(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    setThreshold(value)
    show('Attendance threshold updated.')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Attendance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {entity === 'students'
              ? isAdmin
                ? 'Review student attendance and defaulters — teachers mark daily attendance.'
                : 'Mark daily attendance and review defaulters.'
              : "Mark and review teachers' attendance."}
          </p>
        </div>
        <div className="no-print flex items-center gap-3">
          {profile?.role === 'admin' && (
            <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
              <button
                onClick={() => setEntity('students')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${entity === 'students' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Students
              </button>
              <button
                onClick={() => setEntity('teachers')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${entity === 'teachers' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Teachers
              </button>
            </div>
          )}
          {entity === 'students' && (
            <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
              {!isAdmin && (
                <button
                  onClick={() => setTab('mark')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'mark' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  Mark Attendance
                </button>
              )}
              <button
                onClick={() => setTab('history')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'history' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Defaulters
              </button>
            </div>
          )}
        </div>
      </div>

      {entity === 'teachers' ? (
        <TeacherAttendanceSection />
      ) : (
      <>

      {tab === 'mark' ? (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Class</label>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-56">
                {classes.length === 0 && <option value="">No classes assigned</option>}
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Date</label>
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => markAll('present')}>
                Mark all present
              </Button>
              <Button variant="secondary" onClick={() => markAll('absent')}>
                Mark all absent
              </Button>
            </div>
          </div>

          <div className="print-area overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="hidden border-b px-4 py-2 print:block">
              <p className="font-semibold">{classById.get(classId)?.name} — Attendance for {formatDate(date)}</p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="no-print px-4 py-3">Signed in</th>
                  <th className="px-4 py-3">Present</th>
                  <th className="px-4 py-3">Absent</th>
                  <th className="px-4 py-3">Late</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                      No enrolled students in this class.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                      <td className="no-print px-4 py-3 text-xs">
                        <ScanCell row={scanned[s.id]} />
                      </td>
                      {(['present', 'absent', 'late'] as AttendanceStatus[]).map((status) => (
                        <td key={status} className="px-4 py-3">
                          <input
                            type="radio"
                            name={`status-${s.id}`}
                            checked={marks[s.id] === status}
                            onChange={() => setMarks({ ...marks, [s.id]: status })}
                            className="no-print h-4 w-4"
                          />
                          <span className="hidden print:inline">{marks[s.id] === status ? '✓' : ''}</span>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="no-print flex justify-end gap-2">
            <Button variant="secondary" onClick={handleDownloadPdf} disabled={students.length === 0}>
              Download PDF
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Button onClick={handleSave} disabled={saving || students.length === 0}>
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="print-area space-y-4">
          <div className="no-print flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Students below <strong>{threshold}%</strong> attendance.
            </p>
            <div className="flex items-center gap-2">
              {profile?.role === 'admin' && (
                <>
                  <label className="text-sm text-slate-600 dark:text-slate-300">Threshold %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
                  />
                  <Button variant="secondary" onClick={saveThreshold} disabled={savingThreshold}>
                    {savingThreshold ? 'Saving...' : 'Save'}
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </div>
          </div>
          <div className="hidden print:block">
            <p className="font-semibold">Attendance Defaulter List (below {threshold}%)</p>
          </div>
          {defaulters.length === 0 ? (
            <EmptyState title="No defaulters" description="No students are currently below the attendance threshold." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3">Attendance %</th>
                    <th className="px-4 py-3">Present / Total</th>
                  </tr>
                </thead>
                <tbody>
                  {defaulters.map(({ student, percent, present, total }) => (
                    <tr key={student.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{student.full_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {student.class_id ? classById.get(student.class_id)?.name ?? '—' : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-red-600 dark:text-red-400">{percent}%</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {present} / {total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  )
}
