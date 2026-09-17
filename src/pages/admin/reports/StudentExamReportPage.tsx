import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { StudentFullReport } from '@/components/StudentFullReport'
import { printElement } from '@/lib/printElement'
import { percentage } from '@/lib/utils'
import type { Class, Exam, ExamResult, Student } from '@/types/database'

// Exam results across the roll. The per-student view reuses the existing
// report card rather than drawing a second one — there should be one answer to
// "what are this student's marks", not two that can drift apart.
export function StudentExamReportPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [results, setResults] = useState<ExamResult[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [classFilter, setClassFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [studentsRes, classesRes, resultsRes, examsRes] = await Promise.all([
        supabase.from('students').select('*').eq('enrollment_status', 'enrolled').order('full_name'),
        supabase.from('classes').select('*').order('name'),
        supabase.from('exam_results').select('*'),
        supabase.from('exams').select('*'),
      ])
      setStudents((studentsRes.data as Student[]) ?? [])
      setClasses((classesRes.data as Class[]) ?? [])
      setResults((resultsRes.data as ExamResult[]) ?? [])
      setExams((examsRes.data as Exam[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams])

  const byStudent = useMemo(() => {
    const map = new Map<string, { obtained: number; total: number; count: number }>()
    for (const r of results) {
      const exam = examById.get(r.exam_id)
      if (!exam) continue
      const entry = map.get(r.student_id) ?? { obtained: 0, total: 0, count: 0 }
      entry.obtained += r.marks_obtained
      entry.total += exam.total_marks
      entry.count += 1
      map.set(r.student_id, entry)
    }
    return map
  }, [results, examById])

  const visible = students.filter((s) => classFilter === 'all' || s.class_id === classFilter)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Link to="/admin/reports" className="hover:underline">
            Reports
          </Link>{' '}
          / Student exam results
        </p>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Student exam results</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
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
                <th className="px-4 py-3">Exams taken</th>
                <th className="px-4 py-3">Marks</th>
                <th className="px-4 py-3">Overall</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const agg = byStudent.get(s.id)
                return (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/reports/student-exams/${s.id}`}
                        className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                      >
                        {s.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-200">{agg?.count ?? 0}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                      {agg ? `${agg.obtained} / ${agg.total}` : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-800 dark:text-slate-100">
                      {agg ? `${percentage(agg.obtained, agg.total)}%` : '—'}
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

export function StudentExamDetailPage() {
  const { studentId } = useParams<{ studentId: string }>()
  const [student, setStudent] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      if (!studentId) return
      setLoading(true)
      const { data } = await supabase.from('students').select('*').eq('id', studentId).single()
      setStudent((data as Student) ?? null)
      setLoading(false)
    }
    load()
  }, [studentId])

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
            <Link to="/admin/reports/student-exams" className="hover:underline">
              Student exam results
            </Link>{' '}
            / {student.full_name}
          </p>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{student.full_name}</h1>
        </div>
        <Button variant="secondary" onClick={() => printElement(printRef.current)}>
          Print
        </Button>
      </div>

      <div ref={printRef} className="print-area">
        <StudentFullReport student={student} />
      </div>
    </div>
  )
}
