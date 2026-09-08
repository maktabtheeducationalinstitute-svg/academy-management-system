import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { signStudentPhotos } from '@/lib/studentPhotos'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { StudentCard, StudentCardBack } from '@/components/StudentCard'
import { printElement } from '@/lib/printElement'
import type { Class, Student } from '@/types/database'

// Each row holds one student's front + back, printed side by side so cutting
// the sheet gives you a matched pair ready to glue or laminate back-to-back,
// rather than having to hunt down that student's back card on another page.
//
// Chromium's print pagination doesn't reliably handle a `flex-wrap` container
// breaking across pages — once a page break falls inside the wrapped group,
// items after the break can end up alone on their own row instead of
// re-flowing (confirmed against a real multi-page print; a short same-page
// test didn't reproduce it, which is why this wasn't caught earlier). Each
// row being its own small, unwrapped flex container (via the `.card-row`
// print rule) sidesteps that — only the boundary *between* rows ever needs
// to break, which browsers handle correctly.

// Every student gets a card number the moment they're admitted (assigned by a
// database trigger), so this page never "generates" anything — it just renders
// and prints the card that already exists for each student on the roll.
export function StudentCardsPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map())
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('enrolled')
  const [printOne, setPrintOne] = useState<Student | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const singleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [studentsRes, classesRes] = await Promise.all([
        supabase.from('students').select('*').order('full_name'),
        supabase.from('classes').select('*').order('name'),
      ])
      if (studentsRes.error) show(studentsRes.error.message, 'error')
      else {
        const roll = studentsRes.data as Student[]
        setStudents(roll)
        // Signed in one call for the whole roll: printing a class of cards
        // needs every photo at once, and a link per card would be a request
        // per card. A photo that fails to sign just prints as initials.
        setPhotoUrls(await signStudentPhotos(roll))
      }
      if (classesRes.error) show(classesRes.error.message, 'error')
      else setClasses(classesRes.data as Class[])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const filtered = students.filter((s) => {
    const term = search.trim().toLowerCase()
    if (term && !s.full_name.toLowerCase().includes(term) && !s.barcode.toLowerCase().includes(term)) return false
    if (classFilter !== 'all' && s.class_id !== classFilter) return false
    if (statusFilter !== 'all' && s.enrollment_status !== statusFilter) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Student Cards</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every student has a barcode card, created automatically at admission. Print a sheet, cut, and hand out.
          </p>
        </div>
        <Button onClick={() => printElement(sheetRef.current)} disabled={filtered.length === 0}>
          Print {filtered.length} card{filtered.length === 1 ? '' : 's'}
        </Button>
      </div>

      <div className="no-print flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <Input
          placeholder="Search by name or card number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="max-w-[180px]">
          <option value="all">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[180px]">
          <option value="enrolled">Enrolled</option>
          <option value="inactive">Inactive</option>
          <option value="graduated">Graduated</option>
          <option value="left">Left</option>
          <option value="all">All statuses</option>
        </Select>
        <span className="ml-auto self-center text-sm text-slate-500 dark:text-slate-400">
          {filtered.length} of {students.length} students
        </span>
      </div>

      {loading ? (
        <p className="py-10 text-center text-slate-400 dark:text-slate-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No cards to show" description="No students match the current filters." />
      ) : (
        <div ref={sheetRef} className="print-area card-sheet flex flex-col gap-4">
          {filtered.map((s) => (
            <div key={s.id} className="card-row flex flex-wrap items-start justify-center gap-4">
              <StudentCard
                student={s}
                cls={s.class_id ? classById.get(s.class_id) : undefined}
                photoUrl={photoUrls.get(s.id)}
              />
              <div className="flex flex-col items-center gap-2">
                <StudentCardBack student={s} />
                <button
                  onClick={() => setPrintOne(s)}
                  className="no-print text-xs font-medium text-brand-600 hover:underline dark:text-gold-400"
                >
                  Print this card
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {printOne && (
        <Modal title={`Student Card — ${printOne.full_name}`} onClose={() => setPrintOne(null)}>
          <div className="flex flex-col items-center gap-4">
            <div ref={singleRef} className="print-area card-sheet">
              <div className="card-row flex flex-wrap items-start justify-center gap-4">
                <StudentCard
                  student={printOne}
                  cls={printOne.class_id ? classById.get(printOne.class_id) : undefined}
                  photoUrl={photoUrls.get(printOne.id)}
                />
                <StudentCardBack student={printOne} />
              </div>
            </div>
            <div className="no-print flex justify-end gap-2 self-stretch">
              <Button variant="secondary" onClick={() => setPrintOne(null)}>
                Close
              </Button>
              <Button onClick={() => printElement(singleRef.current)}>Print</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
