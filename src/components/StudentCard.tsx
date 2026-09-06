import { Barcode } from '@/components/Barcode'
import logoUrl from '@/assets/maktab_logo_transparent.png'
import { SCHOOL_ADDRESS } from '@/lib/examPaper'
import type { Class, Student } from '@/types/database'

// A student's printable ID card. Fixed physical dimensions (90mm x 55mm — a
// little wider than a bank card, which is what gives the barcode enough width
// to stay comfortably scannable) so what's on screen is exactly what prints.
//
// Colors are lifted from the actual crest artwork (navy shield, royal-blue
// wreaths/ribbon, gold sunburst) rather than the app's maroon brand palette —
// the card is a physical object next to the school's own logo, so it should
// read as the same mark, not a different color scheme entirely.
//
// Deliberately not theme-aware: the card is always light-on-white regardless of
// the app's dark mode, because a dark card neither prints nor scans.
export function StudentCard({ student, cls }: { student: Student; cls?: Class }) {
  return (
    <div
      className="student-card flex flex-col overflow-hidden rounded-lg border border-[#c3ccec] bg-white text-black shadow-sm"
      style={{ width: '90mm', height: '55mm' }}
    >
      <div className="flex items-center gap-2 border-b-2 border-[#f2c14e] bg-[#1e2a6b] px-3 py-1.5">
        <img src={logoUrl} alt="" className="h-7 w-auto shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="text-[7px] font-semibold uppercase tracking-[0.2em] text-[#f2c14e]">Maktab</p>
          <p className="truncate text-[10px] font-semibold text-white">The Educational Institute</p>
        </div>
        <p className="ml-auto shrink-0 text-[7px] font-semibold uppercase tracking-widest text-[#f2c14e]">
          Student Card
        </p>
      </div>

      <div className="flex flex-1 flex-col justify-between px-3 py-2">
        <div className="leading-tight">
          <p className="truncate text-[13px] font-bold text-[#1e2a6b]">{student.full_name}</p>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[8px] text-slate-700">
            <span className="font-semibold uppercase tracking-wide text-[#3a4a9c]">Class</span>
            <span className="truncate">{cls?.name ?? 'Unassigned'}</span>
            <span className="font-semibold uppercase tracking-wide text-[#3a4a9c]">Guardian</span>
            <span className="truncate">{student.guardian_name || '—'}</span>
            <span className="font-semibold uppercase tracking-wide text-[#3a4a9c]">Contact</span>
            <span className="truncate">{student.guardian_phone || student.contact_phone || '—'}</span>
          </div>
        </div>

        <Barcode value={student.barcode} height={38} />
      </div>
    </div>
  )
}

// The reverse side of the card — same physical size and branding as the
// front, so the two sit together as one printed pair (see StudentCardsPage,
// which lays out each student's front next to their back rather than two
// different students' fronts). The student's name is repeated here so the
// back alone still identifies whose card it is; everything else — the
// institute's real address (the same one already used on exam papers,
// not an invented one), the property/return notice, and the signature
// line — is the same standard back-of-ID content for every student.
export function StudentCardBack({ student }: { student: Student }) {
  return (
    <div
      className="student-card flex flex-col items-center overflow-hidden rounded-lg border border-[#c3ccec] bg-white px-4 py-3 text-center text-black shadow-sm"
      style={{ width: '90mm', height: '55mm' }}
    >
      <img src={logoUrl} alt="" className="h-8 w-auto shrink-0" />
      <p className="mt-1 truncate text-[10px] font-bold text-[#1e2a6b]">{student.full_name}</p>
      <div className="mt-0.5 leading-tight">
        <p className="text-[8px] font-semibold text-[#3a4a9c]">Maktab - The Educational Institute</p>
        <p className="mt-0.5 text-[6px] leading-snug text-slate-500">{SCHOOL_ADDRESS}</p>
      </div>
      <p className="mt-2 flex-1 text-[7px] leading-snug text-slate-600">
        This card is the property of Maktab - The Educational Institute and must be presented for attendance and
        identification on campus. If found, please return it to the school office.
      </p>
      <div className="w-full border-t border-[#c3ccec] pt-1">
        <p className="text-[6px] font-semibold uppercase tracking-widest text-[#3a4a9c]">Authorized Signatory</p>
      </div>
    </div>
  )
}
