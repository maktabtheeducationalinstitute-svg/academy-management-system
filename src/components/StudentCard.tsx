import { Barcode } from '@/components/Barcode'
import logoUrl from '@/assets/maktab_logo_transparent.png'
import qrUrl from '@/assets/academy_location_qr.jpeg'
import { SCHOOL_ADDRESS } from '@/lib/examPaper'
import { initialsOf } from '@/lib/studentPhotos'
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
export function StudentCard({
  student,
  cls,
  photoUrl,
  signatureUrl,
}: {
  student: Student
  cls?: Class
  /** Signed link to the student's photo. Undefined prints initials instead. */
  photoUrl?: string
  /** Signed link to the shared principal-signature image (Settings, institute-wide). Undefined omits it. */
  signatureUrl?: string
}) {
  return (
    <div
      className="student-card flex flex-col overflow-hidden rounded-lg border border-[#c3ccec] bg-white text-black shadow-sm"
      style={{ width: '90mm', height: '55mm' }}
    >
      <div className="flex items-center gap-2 border-b-2 border-[#f2c14e] bg-[#1e2a6b] px-3 py-1.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white p-0.5">
          <img src={logoUrl} alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[12px] font-extrabold tracking-wide text-white">Maktab</p>
          <p className="truncate text-[6.5px] font-semibold uppercase tracking-[0.15em] text-[#f2c14e]">
            The Educational Institute
          </p>
        </div>
        <p className="ml-auto shrink-0 text-[7px] font-semibold uppercase tracking-widest text-[#f2c14e]">
          Student Card
        </p>
      </div>

      <div className="flex flex-1 gap-2.5 px-3 py-1.5">
        {/* Fixed-width column whether or not there is a photo/signature, so a
            card missing either still prints at exactly the same size. */}
        <div className="mt-0.5 flex w-[19.2mm] shrink-0 flex-col gap-1">
          <div
            className={`flex w-full items-center justify-center overflow-hidden rounded border border-[#c3ccec] bg-[#eef1fa] ${signatureUrl ? 'h-[15mm]' : 'h-full'}`}
          >
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[13px] font-bold tracking-wide text-[#8b97c7]">
                {initialsOf(student.full_name)}
              </span>
            )}
          </div>
          {signatureUrl && (
            <div className="flex h-[7mm] w-full items-center justify-center overflow-hidden rounded border border-[#c3ccec] bg-white">
              <img src={signatureUrl} alt="Principal's signature" className="h-full w-full object-contain p-0.5" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="leading-tight">
            <p className="truncate text-[13px] font-bold text-[#1e2a6b]">{student.full_name}</p>
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[8px] text-slate-700">
              <span className="font-bold uppercase tracking-wide text-[#3a4a9c]">Class:</span>
              <span className="truncate">{cls?.name ?? 'Unassigned'}</span>
              <span className="font-bold uppercase tracking-wide text-[#3a4a9c]">Guardian:</span>
              <span className="truncate">{student.guardian_name || '—'}</span>
              <span className="font-bold uppercase tracking-wide text-[#3a4a9c]">Contact:</span>
              <span className="truncate">{student.guardian_phone || student.contact_phone || '—'}</span>
              <span className="font-bold uppercase tracking-wide text-[#3a4a9c]">Roll No:</span>
              <span className="truncate">{student.barcode}</span>
              <span className="font-bold uppercase tracking-wide text-[#3a4a9c]">Session:</span>
              <span className="truncate">{student.session || '—'}</span>
            </div>
          </div>

          <Barcode value={student.barcode} height={20} showText={false} />
        </div>
      </div>

      <div className="border-t border-[#c3ccec] px-3 py-1 text-center">
        <p className="text-[6.5px] font-semibold text-[#3a4a9c]">
          This card is valid upto {student.session || '—'}
        </p>
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
// not an invented one), the property/return notice, the location QR code,
// and the signature line — is the same standard back-of-ID content for
// every student.
//
// The QR code is one fixed image (encoding the academy's physical address),
// not a per-student generated code — every card back prints the identical
// image, the same way every card back already carries the same address text.
export function StudentCardBack({ student }: { student: Student }) {
  return (
    <div
      className="student-card relative flex flex-col items-center overflow-hidden rounded-lg border border-[#c3ccec] bg-white px-3 py-2 text-center text-black shadow-sm"
      style={{ width: '90mm', height: '55mm' }}
    >
      {/* Faint logo watermark behind the back's own content — scoped to this
          card (not the app's generic full-page print watermark, which the
          cards opt out of via .no-watermark since it's sized for A4 sheets,
          not a 90x55mm card, and which wouldn't show up in the on-screen
          preview at all since it's a print-only rule). */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.06]">
        <img src={logoUrl} alt="" className="h-[42mm] w-[42mm] object-contain" />
      </div>

      <div className="relative z-[1] flex w-full flex-1 flex-col items-center">
        <img src={logoUrl} alt="" className="h-10 w-auto shrink-0" />
        <p className="mt-1 truncate text-[10px] font-bold text-[#1e2a6b]">{student.full_name}</p>
        <p className="text-[7px] font-semibold text-[#3a4a9c]">Maktab - The Educational Institute</p>

        <div className="mt-1 flex w-full flex-1 items-center gap-2 text-left">
          <div className="min-w-0 flex-1">
            <p className="text-[5.5px] leading-snug text-slate-500">{SCHOOL_ADDRESS}</p>
            <p className="mt-1 text-[6px] leading-snug text-slate-600">
              This card is the property of Maktab - The Educational Institute and must be presented for attendance
              and identification on campus. If found, please return it to the school office.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center">
            <img
              src={qrUrl}
              alt="QR code for the academy's location"
              className="h-[14mm] w-[14mm] rounded border border-[#c3ccec] bg-white object-contain p-0.5"
            />
            <p className="mt-0.5 text-[5px] font-semibold uppercase tracking-wide text-[#3a4a9c]">
              Scan for location
            </p>
          </div>
        </div>

        <div className="w-full border-t border-[#c3ccec] pt-1">
          <p className="text-[6px] font-semibold uppercase tracking-widest text-[#3a4a9c]">Authorized Signatory</p>
        </div>
      </div>
    </div>
  )
}
