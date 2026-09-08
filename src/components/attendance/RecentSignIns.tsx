import { StudentAvatar } from './StudentAvatar'
import { ClockIcon } from './icons'
import type { ScanAction } from './ScanResultCard'

export interface SignInEntry {
  key: string
  name: string
  className: string | null
  time: string
  action: ScanAction
  overdue: boolean
  /** The scan tripped a review flag — shown so the desk can mention it in person. */
  flagged: boolean
}

function Badge({ tone, children }: { tone: 'danger' | 'in' | 'muted'; children: string }) {
  const classes = {
    danger: 'bg-red-100 text-red-700 ring-red-600/15 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-400/20',
    in: 'bg-green-100 text-green-700 ring-green-600/15 dark:bg-green-900/40 dark:text-green-300 dark:ring-green-400/20',
    muted: 'bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-700 dark:text-slate-300 dark:ring-white/10',
  }[tone]

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${classes}`}
    >
      {children}
    </span>
  )
}

// The running register for the current shift. Rows stay short and scannable —
// the receptionist reads this out of the corner of their eye between cards.
export function RecentSignIns({ entries }: { entries: SignInEntry[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/60">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recent sign-ins</h2>
        {entries.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            {entries.length}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
            <ClockIcon size={20} />
          </span>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No sign-ins yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Scanned students will appear here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className={`flex items-center gap-3 px-4 py-2 transition-colors ${
                entry.overdue
                  ? 'bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30 dark:hover:bg-red-950/50'
                  : 'bg-green-50/40 hover:bg-green-50 dark:bg-green-950/15 dark:hover:bg-green-950/30'
              }`}
            >
              <StudentAvatar name={entry.name} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{entry.name}</p>
                <p className="truncate text-xs text-slate-400 dark:text-slate-500">{entry.className ?? 'Unassigned'}</p>
              </div>
              {entry.overdue && <Badge tone="danger">Fee overdue</Badge>}
              {entry.flagged && <Badge tone="danger">Review</Badge>}
              {entry.action === 'duplicate' ? <Badge tone="muted">Repeat</Badge> : <Badge tone="in">In</Badge>}
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{entry.time}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
