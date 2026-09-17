import { supabase } from '@/lib/supabase'
import type { Attendance, AttendanceStatus, TeacherAttendance } from '@/types/database'

/**
 * Shared loading for the Reports section.
 *
 * Deliberately separate from the monthly report that goes to guardians. That
 * one is built and sent from MonthlyReportsPage and is not touched here — the
 * academy relies on it and asked for it left alone. These are the office's own
 * reports: read, printed, and looked at internally.
 */

export interface MonthRange {
  /** First of the month, e.g. "2026-09-01". */
  start: string
  /** Last day of the month, e.g. "2026-09-30". */
  end: string
}

export function monthRange(monthValue: string): MonthRange {
  const [year, month] = monthValue.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return {
    start: `${monthValue}-01`,
    end: `${monthValue}-${String(last).padStart(2, '0')}`,
  }
}

/** How a day's attendance came to be recorded. */
export type AttendanceSource = 'scanner' | 'teacher'

export interface AttendanceDay {
  date: string
  status: AttendanceStatus
  /**
   * A row with a check-in time came from a card at the desk; one without was
   * written by a teacher marking the register. Keeping them apart is the whole
   * point of the student attendance report — the office wants to see both,
   * not a merged figure that hides which is which.
   */
  source: AttendanceSource
  /** Scan time, when the desk recorded it. */
  checkInAt: string | null
  lateMinutes: number | null
}

export function toAttendanceDays(rows: Attendance[]): AttendanceDay[] {
  return rows
    .map((r) => ({
      date: r.date,
      status: r.status,
      source: (r.check_in_at ? 'scanner' : 'teacher') as AttendanceSource,
      checkInAt: r.check_in_at,
      lateMinutes: r.late_minutes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface AttendanceTotals {
  present: number
  absent: number
  late: number
  /** Days recorded at all — the denominator every percentage here uses. */
  marked: number
  /** Present or late, which is how every other screen in the app counts it. */
  attended: number
  percent: number
  byScanner: number
  byTeacher: number
}

export function totalsOf(days: { status: AttendanceStatus; source?: AttendanceSource }[]): AttendanceTotals {
  const present = days.filter((d) => d.status === 'present').length
  const absent = days.filter((d) => d.status === 'absent').length
  const late = days.filter((d) => d.status === 'late').length
  const attended = present + late
  const marked = days.length
  return {
    present,
    absent,
    late,
    marked,
    attended,
    percent: marked === 0 ? 0 : Math.round((attended / marked) * 1000) / 10,
    byScanner: days.filter((d) => d.source === 'scanner').length,
    byTeacher: days.filter((d) => d.source === 'teacher').length,
  }
}

export async function loadStudentAttendance(studentId: string, month: MonthRange): Promise<AttendanceDay[]> {
  const { data } = await supabase
    .from('attendance')
    .select('*')
    .eq('student_id', studentId)
    .gte('date', month.start)
    .lte('date', month.end)
  return toAttendanceDays((data as Attendance[]) ?? [])
}

export async function loadTeacherAttendance(
  teacherId: string,
  month: MonthRange
): Promise<{ date: string; status: AttendanceStatus }[]> {
  const { data } = await supabase
    .from('teacher_attendance')
    .select('*')
    .eq('teacher_id', teacherId)
    .gte('date', month.start)
    .lte('date', month.end)
  return ((data as TeacherAttendance[]) ?? [])
    .map((r) => ({ date: r.date, status: r.status }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The teachers who teach a student's class, so a student's attendance report
 * can sit next to the attendance of whoever was meant to be teaching them.
 */
export async function loadClassTeacherIds(classId: string): Promise<string[]> {
  const { data } = await supabase.from('subjects').select('teacher_id').eq('class_id', classId)
  const ids = ((data as { teacher_id: string | null }[]) ?? [])
    .map((s) => s.teacher_id)
    .filter((id): id is string => !!id)
  return [...new Set(ids)]
}
