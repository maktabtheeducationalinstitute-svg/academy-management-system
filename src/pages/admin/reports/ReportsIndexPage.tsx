import { Link } from 'react-router-dom'

// Everything the office reads about students and staff, in one place. The
// monthly report that goes to guardians is listed here too, but it still lives
// on its own page and is untouched — it is the one report with an outside
// audience, and the academy relies on it exactly as it is.
const REPORTS = [
  {
    to: '/admin/reports/student-attendance',
    group: 'Students',
    title: 'Student attendance',
    blurb:
      'Day by day for a month, showing which days came from a card at the desk and which a teacher marked by hand.',
  },
  {
    to: '/admin/reports/student-exams',
    group: 'Students',
    title: 'Student exam results',
    blurb: 'Every exam a student has sat, with marks, percentage and an overall figure.',
  },
  {
    to: '/admin/reports/teacher-attendance',
    group: 'Teachers',
    title: 'Teacher attendance',
    blurb: 'Monthly attendance for each teacher, alongside the classes and subjects they teach.',
  },
  {
    to: '/admin/monthly-reports',
    group: 'Sent to guardians',
    title: 'Monthly report to parents',
    blurb: 'Attendance and exam summary emailed to a guardian. Review it, drop rows, add remarks, then send.',
    external: true,
  },
]

const GROUPS = ['Students', 'Teachers', 'Sent to guardians'] as const

export function ReportsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pick a report, then a student or teacher to open their details.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {group}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {REPORTS.filter((r) => r.group === group).map((r) => (
              <Link
                key={r.to}
                to={r.to}
                className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-brand-500 dark:hover:bg-slate-700/40"
              >
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {r.title}
                  {r.external && (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                      sends email
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{r.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
