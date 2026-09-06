import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Input'
import { currentMonthValue, formatDateTime, formatMonth, monthValueToDate, shiftMonthValue } from '@/lib/utils'
import { edgeFunctionError } from '@/lib/errors'
import { buildMonthlyReportPdfBase64 } from '@/lib/pdf'
import type { Attendance, Class, Exam, ExamResult, MonthlyReport, Student, Subject } from '@/types/database'

export function MonthlyReportsPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [examResults, setExamResults] = useState<ExamResult[]>([])
  const [reports, setReports] = useState<MonthlyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [monthValue, setMonthValue] = useState(currentMonthValue())
  const [classFilter, setClassFilter] = useState('all')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const monthStart = monthValueToDate(monthValue)
  const monthEnd = monthValueToDate(shiftMonthValue(monthValue, 1))

  async function load() {
    setLoading(true)
    const [studentsRes, classesRes, subjectsRes, attendanceRes, examsRes, reportsRes] = await Promise.all([
      supabase.from('students').select('*').eq('enrollment_status', 'enrolled').order('full_name'),
      supabase.from('classes').select('*').order('name'),
      supabase.from('subjects').select('*'),
      supabase.from('attendance').select('*').gte('date', monthStart).lt('date', monthEnd),
      supabase.from('exams').select('*').gte('exam_date', monthStart).lt('exam_date', monthEnd),
      supabase.from('monthly_reports').select('*').eq('month', monthStart),
    ])
    if (studentsRes.error) show(studentsRes.error.message, 'error')
    else setStudents(studentsRes.data as Student[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (attendanceRes.data) setAttendance(attendanceRes.data as Attendance[])
    if (reportsRes.data) setReports(reportsRes.data as MonthlyReport[])

    const examRows = (examsRes.data as Exam[]) ?? []
    setExams(examRows)
    if (examRows.length > 0) {
      const resultsRes = await supabase
        .from('exam_results')
        .select('*')
        .in(
          'exam_id',
          examRows.map((e) => e.id)
        )
      if (resultsRes.data) setExamResults(resultsRes.data as ExamResult[])
    } else {
      setExamResults([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthValue])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>()
    for (const a of attendance) {
      const entry = map.get(a.student_id) ?? { present: 0, total: 0 }
      entry.total++
      if (a.status === 'present' || a.status === 'late') entry.present++
      map.set(a.student_id, entry)
    }
    return map
  }, [attendance])

  const examCountByClass = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of exams) map.set(e.class_id, (map.get(e.class_id) ?? 0) + 1)
    return map
  }, [exams])

  const reportByStudent = useMemo(() => new Map(reports.map((r) => [r.student_id, r])), [reports])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  // Keyed by exam+student, not just exam — a class of N students all share
  // the same exam_id, so keying on exam_id alone would collapse every
  // student's result down to whichever one happened to load last.
  const resultByExamAndStudent = useMemo(
    () => new Map(examResults.map((r) => [`${r.exam_id}|${r.student_id}`, r])),
    [examResults]
  )

  const filtered = classFilter === 'all' ? students : students.filter((s) => s.class_id === classFilter)
  const eligible = filtered.filter((s) => s.guardian_email)

  // Builds and sends one student's report, without touching any loading
  // state or reloading data — both the per-row button and "Send to All"
  // call this and handle those themselves, so the bulk path can send one
  // at a time (see below) instead of duplicating this logic.
  async function sendReportTo(student: Student): Promise<{ ok: boolean; error?: string }> {
    if (!student.guardian_email) {
      return { ok: false, error: 'No guardian email on file for this student.' }
    }
    try {
      const className = student.class_id ? classById.get(student.class_id)?.name ?? '' : ''
      const studentAttendance = attendance
        .filter((a) => a.student_id === student.id)
        .map((a) => ({ date: a.date, status: a.status }))
      const studentExams = exams
        .filter((e) => e.class_id === student.class_id)
        .map((e) => {
          const result = resultByExamAndStudent.get(`${e.id}|${student.id}`)
          if (!result) return null
          return {
            examName: e.name,
            subjectName: subjectById.get(e.subject_id)?.name ?? '—',
            obtained: result.marks_obtained,
            total: e.total_marks,
          }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)

      const pdfBase64 = await buildMonthlyReportPdfBase64({
        studentName: student.full_name,
        className,
        monthLabel: formatMonth(monthStart),
        attendance: studentAttendance,
        exams: studentExams,
      })

      const { data, error } = await supabase.functions.invoke('send-monthly-report', {
        body: { studentId: student.id, month: monthStart, pdfBase64 },
      })
      if (error) {
        return { ok: false, error: await edgeFunctionError(error, 'Failed to send report.') }
      }
      const result = data as { error?: string; success?: boolean }
      if (result?.error) {
        return { ok: false, error: result.error }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async function sendTestReport(student: Student) {
    setSendingId(student.id)
    const result = await sendReportTo(student)
    setSendingId(null)
    if (!result.ok) {
      show(result.error ?? 'Failed to send report.', 'error')
      return
    }
    show(`Report emailed to ${student.guardian_email}, with PDF attached.`)
    load()
  }

  // Sends one at a time, awaiting each before starting the next — never
  // builds every student's PDF up front, so memory use stays flat
  // regardless of how many students are in view (see sendReportTo's own
  // comment history for why that matters).
  async function sendAllReports() {
    if (eligible.length === 0) {
      show('No students in this view have a guardian email on file.', 'error')
      return
    }
    setSendingAll(true)
    let sent = 0
    const failures: string[] = []
    for (let i = 0; i < eligible.length; i++) {
      setBulkProgress({ done: i, total: eligible.length })
      const student = eligible[i]
      const result = await sendReportTo(student)
      if (result.ok) sent++
      else failures.push(`${student.full_name}: ${result.error ?? 'failed'}`)
    }
    setBulkProgress(null)
    setSendingAll(false)
    if (failures.length === 0) {
      show(`Sent ${sent} of ${eligible.length} report${eligible.length === 1 ? '' : 's'}.`)
    } else {
      show(`Sent ${sent} of ${eligible.length}. ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`, 'error')
    }
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Monthly Reports</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Send a combined attendance + exam report email to a guardian for one month. Sending is always
            triggered by hand here — nothing goes out on a schedule.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={sendAllReports} disabled={sendingAll || sendingId !== null || eligible.length === 0}>
            {sendingAll
              ? `Sending... (${bulkProgress ? bulkProgress.done + 1 : 0}/${bulkProgress?.total ?? eligible.length})`
              : `Send to All (${eligible.length})`}
          </Button>
          {filtered.length > eligible.length && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {filtered.length - eligible.length} student{filtered.length - eligible.length === 1 ? '' : 's'} in this
              view have no guardian email and will be skipped.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
        <Field label="Month">
          <div className="flex gap-1">
            <Button variant="secondary" onClick={() => setMonthValue(shiftMonthValue(monthValue, -1))} aria-label="Previous month">
              ‹
            </Button>
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
            <Button variant="secondary" onClick={() => setMonthValue(shiftMonthValue(monthValue, 1))} aria-label="Next month">
              ›
            </Button>
          </div>
        </Field>
        <Field label="Class">
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Attendance ({formatMonth(monthStart)})</th>
              <th className="px-4 py-3">Exams this month</th>
              <th className="px-4 py-3">Last Sent</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No students match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const att = attendanceByStudent.get(s.id)
                const examCount = s.class_id ? examCountByClass.get(s.class_id) ?? 0 : 0
                const report = reportByStudent.get(s.id)
                return (
                  <tr
                    key={s.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {att ? `${att.present} / ${att.total} (${Math.round((att.present / att.total) * 1000) / 10}%)` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{examCount}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {report?.sent_at ? formatDateTime(report.sent_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.guardian_email ? (
                        <button
                          onClick={() => sendTestReport(s)}
                          disabled={sendingId === s.id || sendingAll}
                          className="text-sm text-brand-600 hover:underline disabled:opacity-50 dark:text-gold-400"
                        >
                          {sendingId === s.id ? 'Sending...' : 'Send Test Report'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500" title="No guardian email on file">
                          No email
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
