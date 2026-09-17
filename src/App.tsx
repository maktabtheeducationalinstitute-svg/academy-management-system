import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Login } from '@/pages/auth/Login'
import { ResetPassword } from '@/pages/auth/ResetPassword'
import { AdminLayout } from '@/components/Layout/AdminLayout'
import { TeacherLayout } from '@/components/Layout/TeacherLayout'
import { ScannerLayout } from '@/components/Layout/ScannerLayout'
import { AdminDashboard } from '@/pages/admin/AdminDashboard'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import { StudentsPage } from '@/pages/admin/StudentsPage'
import { TeachersPage } from '@/pages/admin/TeachersPage'
import { ClassesSubjectsPage } from '@/pages/admin/ClassesSubjectsPage'
import { AdminTimetablePage } from '@/pages/admin/AdminTimetablePage'
import { FeesPage } from '@/pages/admin/FeesPage'
import { TeacherTimetablePage } from '@/pages/teacher/TeacherTimetablePage'
import { TeacherStudentsPage } from '@/pages/teacher/TeacherStudentsPage'
import { TeacherStudentDetailPage } from '@/pages/teacher/TeacherStudentDetailPage'
import { AttendancePage } from '@/pages/shared/AttendancePage'
import { QuestionBankPage } from '@/pages/shared/QuestionBankPage'
import { ExamsPage } from '@/pages/shared/ExamsPage'
import { ExamDetailPage } from '@/pages/shared/ExamDetailPage'
import { FeeChallanPage } from '@/pages/admin/FeeChallanPage'
import { SalariesPage } from '@/pages/admin/SalariesPage'
import { CourseBreakdownOverviewPage } from '@/pages/admin/CourseBreakdownOverviewPage'
import { TeacherCourseBreakdownPage } from '@/pages/teacher/TeacherCourseBreakdownPage'
import { StudentCardsPage } from '@/pages/admin/StudentCardsPage'
import { ScannerPage } from '@/pages/attendance/ScannerPage'
import { MonthlyReportsPage } from '@/pages/admin/MonthlyReportsPage'
import { SettingsPage } from '@/pages/shared/SettingsPage'
import { ReportsIndexPage } from '@/pages/admin/reports/ReportsIndexPage'
import { StudentAttendanceReportPage } from '@/pages/admin/reports/StudentAttendanceReportPage'
import { StudentAttendanceDetailPage } from '@/pages/admin/reports/StudentAttendanceDetailPage'
import { StudentExamReportPage, StudentExamDetailPage } from '@/pages/admin/reports/StudentExamReportPage'
import { TeacherAttendanceReportPage, TeacherAttendanceDetailPage } from '@/pages/admin/reports/TeacherAttendanceReportPage'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route element={<ProtectedRoute allowedRole="admin" />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="students" element={<StudentsPage />} />
                <Route path="student-cards" element={<StudentCardsPage />} />
                <Route path="teachers" element={<TeachersPage />} />
                <Route path="classes" element={<ClassesSubjectsPage />} />
                <Route path="timetable" element={<AdminTimetablePage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="scanner" element={<ScannerPage />} />
                <Route path="fees" element={<FeesPage />} />
                <Route path="fee-challans" element={<FeeChallanPage />} />
                <Route path="salaries" element={<SalariesPage />} />
                <Route path="monthly-reports" element={<MonthlyReportsPage />} />
                <Route path="reports" element={<ReportsIndexPage />} />
                <Route path="reports/student-attendance" element={<StudentAttendanceReportPage />} />
                <Route path="reports/student-attendance/:studentId" element={<StudentAttendanceDetailPage />} />
                <Route path="reports/student-exams" element={<StudentExamReportPage />} />
                <Route path="reports/student-exams/:studentId" element={<StudentExamDetailPage />} />
                <Route path="reports/teacher-attendance" element={<TeacherAttendanceReportPage />} />
                <Route path="reports/teacher-attendance/:teacherId" element={<TeacherAttendanceDetailPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="course-breakdown" element={<CourseBreakdownOverviewPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute allowedRole="teacher" />}>
              <Route path="/teacher" element={<TeacherLayout />}>
                <Route index element={<TeacherDashboard />} />
                <Route path="students" element={<TeacherStudentsPage />} />
                <Route path="students/:studentId" element={<TeacherStudentDetailPage />} />
                <Route path="timetable" element={<TeacherTimetablePage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="questions" element={<QuestionBankPage />} />
                <Route path="exams" element={<ExamsPage />} />
                <Route path="exams/:examId" element={<ExamDetailPage basePath="/teacher/exams" />} />
                <Route path="course-breakdown" element={<TeacherCourseBreakdownPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute allowedRole="attendance" />}>
              <Route path="/scan" element={<ScannerLayout />}>
                <Route index element={<ScannerPage />} />
                <Route
                  path="settings"
                  element={
                    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
                      <SettingsPage />
                    </div>
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
