import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { currentMonthValue, formatDate, formatDateTime, formatMonth, monthValueToDate, shiftMonthValue } from '@/lib/utils'
import { edgeFunctionError } from '@/lib/errors'
import { buildMonthlyReportPdfBase64 } from '@/lib/pdf'
import type { Attendance, Class, Exam, ExamResult, MonthlyReport, Student, Subject } from '@/types/database'

type AttendanceRow = { date: string; status: string }
type ExamRow = { examName: string; subjectName: string; obtained: number; total: number }

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
  const [sendingAll, setSendingAll] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const [previewFor, setPreviewFor] = useState<Student | null>(null)
  const [previewAttendance, setPreviewAttendance] = useState<(AttendanceRow & { included: boolean })[]>([])
  const [previewExams, setPreviewExams] = useState<(ExamRow & { included: boolean })[]>([])
  const [remarksDraft, setRemarksDraft] = useState('')
  const [previewSending, setPreviewSending] = useState(false)

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

  function studentAttendanceRows(student: Student): AttendanceRow[] {
    return attendance.filter((a) => a.student_id === student.id).map((a) => ({ date: a.date, status: a.status }))
  }

  function studentExamRows(student: Student): ExamRow[] {
    return exams
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
  }

  // Builds and sends one student's report from whatever attendance/exam rows
  // and remarks are passed in — not read fresh from state — so the preview
  // modal can send exactly what the admin reviewed (with rows unchecked and
  // a note added) while "Send to All" can still send the plain, un-edited
  // report without going through the modal for every student.
  async function sendBuiltReport(
    student: Student,
    attendanceRows: AttendanceRow[],
    examRows: ExamRow[],
    remarks: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!student.guardian_email) {
      return { ok: false, error: 'No guardian email on file for this student.' }
    }
    try {
      const className = student.class_id ? classById.get(student.class_id)?.name ?? '' : ''
      const pdfBase64 = await buildMonthlyReportPdfBase64({
        studentName: student.full_name,
        className,
        monthLabel: formatMonth(monthStart),
        attendance: attendanceRows,
        exams: examRows,
        remarks: remarks.trim() || undefined,
      })

      const { data, error } = await supabase.functions.invoke('send-monthly-report', {
        body: { studentId: student.id, month: monthStart, pdfBase64, remarks: remarks.trim() || null },
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

  // Opens the review step instead of sending straight away — the client
  // asked for a chance to see exactly what's going out (and drop a day/exam
  // row, or add a note) before a guardian's inbox gets it.
  function openPreview(student: Student) {
    setPreviewFor(student)
    setPreviewAttendance(studentAttendanceRows(student).map((row) => ({ ...row, included: true })))
    setPreviewExams(studentExamRows(student).map((row) => ({ ...row, included: true })))
    setRemarksDraft(reportByStudent.get(student.id)?.remarks ?? '')
  }

  async function sendPreview() {
    if (!previewFor) return
    setPreviewSending(true)
    const result = await sendBuiltReport(
      previewFor,
      previewAttendance.filter((a) => a.included).map(({ date, status }) => ({ date, status })),
      previewExams.filter((e) => e.included).map(({ examName, subjectName, obtained, total }) => ({ examName, subjectName, obtained, total })),
      remarksDraft
    )
    setPreviewSending(false)
    if (!result.ok) {
      show(result.error ?? 'Failed to send report.', 'error')
      return
    }
    show(`Report emailed to ${previewFor.guardian_email}, with PDF attached.`)
    setPreviewFor(null)
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
      const result = await sendBuiltReport(student, studentAttendanceRows(student), studentExamRows(student), '')
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
          <Button onClick={sendAllReports} disabled={sendingAll || previewFor !== null || eligible.length === 0}>
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
                          onClick={() => openPreview(s)}
                          disabled={sendingAll}
                          className="text-sm text-brand-600 hover:underline disabled:opacity-50 dark:text-gold-400"
                        >
                          Preview & Send
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

      {previewFor && (
        <Modal title={`Preview Report — ${previewFor.full_name}`} onClose={() => setPreviewFor(null)} wide>
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {formatMonth(monthStart)} ·{' '}
              {previewFor.class_id ? classById.get(previewFor.class_id)?.name ?? '—' : '—'} — uncheck anything that
              shouldn't go in this report, add a note if you'd like, then send.
            </p>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Attendance ({previewAttendance.filter((a) => a.included).length} of {previewAttendance.length} days
                included)
              </p>
              {previewAttendance.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No attendance was recorded this month.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {previewAttendance.map((row, i) => (
                        <tr
                          key={row.date}
                          className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                        >
                          <td className="px-3 py-1.5">
                            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={row.included}
                                onChange={(e) =>
                                  setPreviewAttendance((prev) =>
                                    prev.map((r, idx) => (idx === i ? { ...r, included: e.target.checked } : r))
                                  )
                                }
                              />
                              {formatDate(row.date)}
                            </label>
                          </td>
                          <td className="px-3 py-1.5 capitalize text-slate-600 dark:text-slate-300">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Exams ({previewExams.filter((e) => e.included).length} of {previewExams.length} included)
              </p>
              {previewExams.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No exam results this month.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {previewExams.map((row, i) => (
                        <tr
                          key={`${row.examName}-${row.subjectName}-${i}`}
                          className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                        >
                          <td className="px-3 py-1.5">
                            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={row.included}
                                onChange={(e) =>
                                  setPreviewExams((prev) =>
                                    prev.map((r, idx) => (idx === i ? { ...r, included: e.target.checked } : r))
                                  )
                                }
                              />
                              {row.examName} — {row.subjectName}
                            </label>
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
                            {row.obtained} / {row.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Field label="Remarks (optional — shown in the email and printed on the PDF)">
              <textarea
                rows={3}
                value={remarksDraft}
                onChange={(e) => setRemarksDraft(e.target.value)}
                placeholder="e.g. Needs to improve attendance in the last week of the month."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreviewFor(null)}>
                Cancel
              </Button>
              <Button onClick={sendPreview} disabled={previewSending}>
                {previewSending ? 'Sending...' : 'Send Report'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
