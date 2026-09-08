// Insert shape for a table: every column stays required except the ones
// listed in `Optional` (columns with a DB default, nullable columns, or
// auto-generated ids/timestamps) — catches insert calls missing a genuinely
// required column at compile time instead of only at the Postgres roundtrip.
type InsertOf<Row, Optional extends keyof Row> = Omit<Row, Optional> & Partial<Pick<Row, Optional>>

// 'attendance' is the front-desk kiosk account: it can record a barcode
// sign-in and nothing else (see the scan_student_attendance RPC).
export type UserRole = 'admin' | 'teacher' | 'attendance'
export type EnrollmentStatus = 'enrolled' | 'inactive' | 'graduated' | 'left'
export type TeacherStatus = 'active' | 'left'
export type SubjectStatus = 'active' | 'pending_approval'
export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue'
export type AttendanceStatus = 'present' | 'absent' | 'late'
export type SalaryStatus = 'pending' | 'paid'

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  email: string
  phone: string | null
  must_reset_password: boolean
  created_at: string
}

export interface Teacher {
  id: string
  monthly_salary: number
  status: TeacherStatus
  created_at: string
}

export interface Class {
  id: string
  name: string
  fee_amount: number
  category: string | null
  created_at: string
}

export interface Subject {
  id: string
  name: string
  class_id: string
  teacher_id: string | null
  status: SubjectStatus
  requested_by: string | null
  /**
   * Whether imported questions also get a translation. False for language
   * subjects — Urdu, English, Tarjama tul Quran — where translating the
   * question removes the thing being examined.
   */
  translate_questions: boolean
  created_at: string
}

export interface Student {
  id: string
  full_name: string
  // Card number printed as a Code 39 barcode on the student's ID card.
  // Assigned by a DB trigger at admission and never changed afterwards.
  barcode: string
  class_id: string | null
  contact_phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  /**
   * Path within the private student-photos bucket, never a URL — signed links
   * expire, so a stored one would rot. Null until a photo is uploaded.
   */
  photo_path: string | null
  enrollment_status: EnrollmentStatus
  fee_override: number | null
  admission_fee_amount: number
  admission_fee_paid: boolean
  security_fee_amount: number
  security_fee_paid: boolean
  created_at: string
}

export interface Invoice {
  id: string
  student_id: string
  class_id: string
  month: string
  amount: number
  discount: number
  status: InvoiceStatus
  payment_date: string | null
  due_date: string | null
  reminder_sent_at: string | null
  created_at: string
}

export interface Attendance {
  id: string
  student_id: string
  class_id: string
  date: string
  status: AttendanceStatus
  marked_by: string | null
  /** Null when the student never scanned in — see `review_reason`. */
  check_in_at: string | null
  /** Minutes past the class's scheduled start, clamped at 0. Null without a check-in. */
  late_minutes: number | null
  review_reason: AttendanceReviewReason | null
  created_at: string
}

/** Why a row is worth a second look. Arrivals only — there are no departures. */
export type AttendanceReviewReason = 'very_late'

export interface AttendanceSettings {
  id: number
  threshold_percent: number
  timezone: string
  default_start_time: string
  grace_minutes: number
  very_late_minutes: number
}

export type QuestionType = 'mcq' | 'short' | 'long' | 'fill_blank' | 'true_false'
/** The two languages the academy teaches in. */
export type QuestionLanguage = 'ur' | 'en'
export type QuestionDifficulty = 'easy' | 'medium' | 'hard'

/** One MCQ choice. `key` is the printed label — "A", "B", … */
export interface QuestionOption {
  key: string
  text: string
}

export interface SourceBook {
  id: string
  subject_id: string
  class_id: string
  title: string
  page_count: number
  created_by: string | null
  created_at: string
}

/** One run of text on a page, positioned as fractions of the page. */
export interface PageTextItem {
  t: string
  x: number
  y: number
  w: number
  h: number
}

export interface SourceBookPage {
  id: string
  book_id: string
  page_number: number
  /** Path within the book-pages storage bucket. */
  storage_path: string
  width: number
  height: number
  /** Null when the page is a true scan with no text layer. */
  text_items: PageTextItem[] | null
}

/** A region of a page, as fractions of its width and height. */
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export interface Question {
  id: string
  subject_id: string
  class_id: string
  chapter: string | null
  question_text: string
  marks: number
  question_type: QuestionType
  /** MCQ choices. Null for every other type. */
  options: QuestionOption[] | null
  /** Correct option key, or a model answer. Null when unknown. */
  answer: string | null
  difficulty: QuestionDifficulty | null
  /** Language of question_text as printed. Null on rows predating translation. */
  language: QuestionLanguage | null
  /** The same question in the other language. Null when there isn't one. */
  translation: string | null
  /** MCQ choices in the other language. Null unless options and a translation both exist. */
  options_translated: QuestionOption[] | null
  /** Free-text provenance: "Board 2023", or the imported file's name. */
  source: string | null
  /** Set when the question is a snip from a scanned book rather than text. */
  source_page_id: string | null
  crop: Crop | null
  created_by: string | null
  created_at: string
}

export interface Exam {
  id: string
  name: string
  subject_id: string
  class_id: string
  exam_date: string
  total_marks: number
  /** Allowed time, printed as "TIME 1 HOUR" on the paper header. */
  duration_minutes: number | null
  created_by: string | null
  created_at: string
}

export type ExamPart = 'objective' | 'subjective'

export interface ExamSection {
  id: string
  exam_id: string
  part: ExamPart
  title: string
  /** Printed under the title, e.g. "Attempt any SIX questions." */
  instruction: string | null
  /** Attempt-any-N. Null means every question must be attempted. */
  choose_count: number | null
  position: number
  created_at: string
}

export interface ExamQuestion {
  exam_id: string
  question_id: string
  section_id: string | null
  position: number
  /** Sub-parts to print, as indexes into the question's parts. Null = all. */
  part_indexes: number[] | null
}

export interface ExamResult {
  id: string
  exam_id: string
  student_id: string
  marks_obtained: number
  entered_by: string | null
  created_at: string
  /**
   * Left over from the removed result-messaging feature. The column is still
   * in the database, so the type stays honest about it; nothing reads it.
   */
  whatsapp_sent_at: string | null
}

export interface Timetable {
  id: string
  teacher_id: string
  class_id: string
  subject_id: string
  day_of_week: number
  start_time: string
  end_time: string
  created_at: string
}

export interface Salary {
  id: string
  teacher_id: string
  month: string
  amount: number
  status: SalaryStatus
  paid_date: string | null
  created_at: string
}

export interface MonthlyReport {
  id: string
  student_id: string
  month: string
  sent_at: string | null
  created_at: string
}

export interface TeacherAttendance {
  id: string
  teacher_id: string
  date: string
  status: AttendanceStatus
  marked_by: string | null
  created_at: string
}

export type PlannerType = 'weekly' | 'biweekly' | 'monthly'

export interface CourseBreakdown {
  id: string
  subject_id: string
  planner_type: PlannerType
  total_chapters: number
  start_date: string
  end_date: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CourseBreakdownSlot {
  id: string
  course_breakdown_id: string
  slot_number: number
  slot_start: string
  slot_end: string
  chapters: string | null
  is_done: boolean
}

// Minimal Supabase Database type map (hand-maintained; expand as phases add tables/queries)
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: InsertOf<Profile, 'phone' | 'must_reset_password' | 'created_at'>
        Update: Partial<Profile>
        Relationships: []
      }
      teachers: {
        Row: Teacher
        Insert: InsertOf<Teacher, 'monthly_salary' | 'status' | 'created_at'>
        Update: Partial<Teacher>
        Relationships: []
      }
      classes: {
        Row: Class
        Insert: InsertOf<Class, 'id' | 'fee_amount' | 'category' | 'created_at'>
        Update: Partial<Class>
        Relationships: []
      }
      subjects: {
        Row: Subject
        Insert: InsertOf<
          Subject,
          'id' | 'teacher_id' | 'status' | 'requested_by' | 'translate_questions' | 'created_at'
        >
        Update: Partial<Subject>
        Relationships: []
      }
      students: {
        Row: Student
        Insert: InsertOf<
          Student,
          | 'photo_path'
          | 'id'
          | 'barcode'
          | 'class_id'
          | 'contact_phone'
          | 'guardian_name'
          | 'guardian_phone'
          | 'guardian_email'
          | 'enrollment_status'
          | 'fee_override'
          | 'admission_fee_amount'
          | 'admission_fee_paid'
          | 'security_fee_amount'
          | 'security_fee_paid'
          | 'created_at'
        >
        Update: Partial<Student>
        Relationships: []
      }
      invoices: {
        Row: Invoice
        Insert: InsertOf<
          Invoice,
          'id' | 'discount' | 'status' | 'payment_date' | 'due_date' | 'reminder_sent_at' | 'created_at'
        >
        Update: Partial<Invoice>
        Relationships: []
      }
      attendance: {
        Row: Attendance
        Insert: InsertOf<
          Attendance,
          | 'id'
          | 'marked_by'
          | 'check_in_at'
          | 'late_minutes'
          | 'review_reason'
          | 'created_at'
        >
        Update: Partial<Attendance>
        Relationships: []
      }
      attendance_settings: {
        Row: AttendanceSettings
        Insert: InsertOf<
          AttendanceSettings,
          | 'id'
          | 'threshold_percent'
          | 'timezone'
          | 'default_start_time'
          | 'grace_minutes'
          | 'very_late_minutes'
        >
        Update: Partial<AttendanceSettings>
        Relationships: []
      }
      questions: {
        Row: Question
        Insert: InsertOf<
          Question,
          | 'id'
          | 'chapter'
          | 'question_type'
          | 'options'
          | 'answer'
          | 'difficulty'
          | 'language'
          | 'translation'
          | 'options_translated'
          | 'source'
          | 'source_page_id'
          | 'crop'
          | 'created_by'
          | 'created_at'
        >
        Update: Partial<Question>
        Relationships: []
      }
      exams: {
        Row: Exam
        Insert: InsertOf<Exam, 'id' | 'created_by' | 'created_at'>
        Update: Partial<Exam>
        Relationships: []
      }
      source_books: {
        Row: SourceBook
        Insert: InsertOf<SourceBook, 'id' | 'page_count' | 'created_by' | 'created_at'>
        Update: Partial<SourceBook>
        Relationships: []
      }
      source_book_pages: {
        Row: SourceBookPage
        Insert: InsertOf<SourceBookPage, 'id' | 'text_items'>
        Update: Partial<SourceBookPage>
        Relationships: []
      }
      exam_sections: {
        Row: ExamSection
        Insert: InsertOf<ExamSection, 'id' | 'part' | 'instruction' | 'choose_count' | 'position' | 'created_at'>
        Update: Partial<ExamSection>
        Relationships: []
      }
      exam_questions: {
        Row: ExamQuestion
        Insert: InsertOf<ExamQuestion, 'section_id' | 'position' | 'part_indexes'>
        Update: Partial<ExamQuestion>
        Relationships: []
      }
      exam_results: {
        Row: ExamResult
        Insert: InsertOf<ExamResult, 'id' | 'entered_by' | 'whatsapp_sent_at' | 'created_at'>
        Update: Partial<ExamResult>
        Relationships: []
      }
      timetable: {
        Row: Timetable
        Insert: InsertOf<Timetable, 'id' | 'created_at'>
        Update: Partial<Timetable>
        Relationships: []
      }
      salaries: {
        Row: Salary
        Insert: InsertOf<Salary, 'id' | 'status' | 'paid_date' | 'created_at'>
        Update: Partial<Salary>
        Relationships: []
      }
      monthly_reports: {
        Row: MonthlyReport
        Insert: InsertOf<MonthlyReport, 'id' | 'sent_at' | 'created_at'>
        Update: Partial<MonthlyReport>
        Relationships: []
      }
      teacher_attendance: {
        Row: TeacherAttendance
        Insert: InsertOf<TeacherAttendance, 'id' | 'marked_by' | 'created_at'>
        Update: Partial<TeacherAttendance>
        Relationships: []
      }
      course_breakdowns: {
        Row: CourseBreakdown
        Insert: InsertOf<CourseBreakdown, 'id' | 'created_by' | 'created_at' | 'updated_at'>
        Update: Partial<CourseBreakdown>
        Relationships: []
      }
      course_breakdown_slots: {
        Row: CourseBreakdownSlot
        Insert: InsertOf<CourseBreakdownSlot, 'id' | 'chapters' | 'is_done'>
        Update: Partial<CourseBreakdownSlot>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
