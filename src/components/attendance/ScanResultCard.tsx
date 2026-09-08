import type { ReactNode } from 'react'
import type { AttendanceReviewReason, AttendanceStatus } from '@/types/database'
import { formatClockTime, formatMinutes } from '@/lib/utils'
import { StudentAvatar } from './StudentAvatar'
import { ClockIcon, FlagIcon, IdCardIcon, LogInIcon, RotateCcwIcon, UserIcon } from './icons'

/** What a card read did. There is no departure — a repeat is just a repeat. */
export type ScanAction = 'check_in' | 'duplicate'

export interface ScanResultCardProps {
  name: string
  className: string | null
  barcode: string
  action: ScanAction
  status: AttendanceStatus
  checkInAt: string | null
  /** Minutes past the scheduled start. Null when there was no check-in to be late for. */
  lateMinutes: number | null
  reviewReason: AttendanceReviewReason | null
  /**
   * Whether the account is behind on fees. Recolours the whole card rather
   * than adding another badge: the desk reads this across a queue, and a
   * colour is seen before any word on the card is.
   */
  feeOverdue: boolean
}

const tone = {
  check_in: {
    shell: 'border-green-500/60 bg-green-50 dark:border-green-600/50 dark:bg-green-950/30',
    badge: 'bg-green-600 ring-green-50 dark:bg-green-600 dark:ring-green-950',
    status: 'text-green-700 dark:text-green-300',
    label: 'Signed in',
    icon: <LogInIcon size={14} strokeWidth={2.5} />,
  },
  duplicate: {
    shell: 'border-amber-400/70 bg-amber-50 dark:border-amber-600/50 dark:bg-amber-950/30',
    badge: 'bg-amber-500 ring-amber-50 dark:bg-amber-600 dark:ring-amber-950',
    status: 'text-amber-700 dark:text-amber-300',
    label: 'Just scanned',
    icon: <RotateCcwIcon size={13} strokeWidth={2.5} />,
  },
} as const

// An overdue account overrides the direction colour entirely. The desk is
// looking at the card to decide whether to wave the student through or send
// them to the office, and that decision is the fee one.
const overdueTone = {
  shell: 'border-red-500/70 bg-red-50 dark:border-red-600/50 dark:bg-red-950/30',
  badge: 'bg-red-600 ring-red-50 dark:bg-red-600 dark:ring-red-950',
  status: 'text-red-700 dark:text-red-300',
} as const

// Plain-language rendering of the review flags the RPC sets. The receptionist
// is not the person who resolves these, so each one says what the office will
// need to sort out rather than naming the rule that fired.
const reviewNote: Record<AttendanceReviewReason, string> = {
  very_late: 'Arrived well after the class started. Flagged for the office.',
}

function MetaItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-slate-300">
      <span className="shrink-0 text-slate-400 dark:text-slate-500">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  )
}

// The confirmation the receptionist is looking for on every scan — deliberately
// the loudest thing on the page once a card goes through.
export function ScanResultCard({
  name,
  className,
  barcode,
  action,
  status,
  checkInAt,
  lateMinutes,
  reviewReason,
  feeOverdue,
}: ScanResultCardProps) {
  const base = tone[action]
  const t = feeOverdue ? { ...base, ...overdueTone } : base
  const label = t.label
  const stamp = checkInAt

  // One line of context under the headline time. Lateness is only called out
  // once the register actually says 'late' — a student inside the grace period
  // is on time, and telling the desk "5m late" would contradict the row that
  // was just written.
  const detail = status === 'late' && lateMinutes !== null ? `${formatMinutes(lateMinutes)} late` : 'On time'

  return (
    <section
      aria-live="polite"
      className={`overflow-hidden rounded-2xl border-2 shadow-sm motion-safe:animate-scan-in ${t.shell}`}
    >
      <div className="flex flex-wrap items-center gap-4 p-4 sm:gap-5 sm:p-6">
        <div className="relative shrink-0">
          <StudentAvatar name={name} size="lg" />
          <span
            className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2 ${t.badge}`}
          >
            {t.icon}
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-52">
          <h2 className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
            {name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
            <MetaItem icon={<UserIcon size={14} />}>{className ?? 'Unassigned'}</MetaItem>
            <MetaItem icon={<IdCardIcon size={14} />}>
              <span className="font-mono tracking-wide">{barcode}</span>
            </MetaItem>
          </div>
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className={`text-lg font-bold leading-tight sm:text-2xl ${t.status}`}>{label}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <ClockIcon size={13} />
            {formatClockTime(stamp)}
          </p>
          {detail && <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{detail}</p>}
        </div>
      </div>

      {action === 'duplicate' && (
        <p className="border-t border-amber-400/40 bg-amber-100/50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 sm:px-6">
          Already signed in today at {formatClockTime(checkInAt)} — this scan changed nothing.
        </p>
      )}

      {action !== 'duplicate' && reviewReason && (
        <p className="flex items-start gap-2 border-t border-amber-400/40 bg-amber-100/50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 sm:px-6">
          <span className="mt-0.5 shrink-0">
            <FlagIcon size={13} />
          </span>
          {reviewNote[reviewReason]}
        </p>
      )}
    </section>
  )
}
