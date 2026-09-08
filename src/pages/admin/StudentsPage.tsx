import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Input'
import { StudentFullReport } from '@/components/StudentFullReport'
import { StudentImport } from '@/components/StudentImport'
import { StudentPhotoField } from '@/components/StudentPhotoField'
import { deletePhoto, signStudentPhotos, uploadPhoto } from '@/lib/studentPhotos'
import { StudentCard } from '@/components/StudentCard'
import { printElement } from '@/lib/printElement'
import { formatCurrency, isValidEmail, isValidPhone } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class, EnrollmentStatus, Student } from '@/types/database'

type StudentForm = {
  full_name: string
  class_id: string
  contact_phone: string
  guardian_name: string
  guardian_phone: string
  guardian_email: string
  enrollment_status: EnrollmentStatus
  fee_override: string
  admission_fee_amount: string
  admission_fee_paid: boolean
  security_fee_amount: string
  security_fee_paid: boolean
}

const emptyForm: StudentForm = {
  full_name: '',
  class_id: '',
  contact_phone: '',
  guardian_name: '',
  guardian_phone: '',
  guardian_email: '',
  enrollment_status: 'enrolled',
  fee_override: '',
  admission_fee_amount: '0',
  admission_fee_paid: false,
  security_fee_amount: '0',
  security_fee_paid: false,
}

export function StudentsPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<Student | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState<StudentForm>(emptyForm)
  // The photo is held aside until the form is saved, so abandoning a
  // half-filled form never leaves an orphaned file in the bucket.
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [dropPhoto, setDropPhoto] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null)
  const [reportCardFor, setReportCardFor] = useState<Student | null>(null)
  const [newCardFor, setNewCardFor] = useState<Student | null>(null)
  const reportCardPrintRef = useRef<HTMLDivElement>(null)
  const newCardPrintRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

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
      setPhotoUrls(await signStudentPhotos(roll))
    }
    if (classesRes.error) show(classesRes.error.message, 'error')
    else setClasses(classesRes.data as Class[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeStudentCount = useMemo(() => students.filter((s) => s.enrollment_status !== 'left').length, [students])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const categories = useMemo(
    () => [...new Set(classes.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [classes]
  )

  const filtered = students.filter((s) => {
    if (search && !s.full_name.toLowerCase().includes(search.toLowerCase())) return false
    if (classFilter !== 'all' && s.class_id !== classFilter) return false
    if (categoryFilter !== 'all' && classById.get(s.class_id ?? '')?.category !== categoryFilter) return false
    // Students who left are hidden from the default/"all" view — pick the
    // "Left" filter explicitly to see them, keeping the current list clean.
    if (statusFilter === 'all' && s.enrollment_status === 'left') return false
    if (statusFilter !== 'all' && s.enrollment_status !== statusFilter) return false
    return true
  })

  function resetPhotoState() {
    setPhotoBlob(null)
    setDropPhoto(false)
  }

  function openCreate() {
    resetPhotoState()
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(s: Student) {
    resetPhotoState()
    setEditing(s)
    setForm({
      full_name: s.full_name,
      class_id: s.class_id ?? '',
      contact_phone: s.contact_phone ?? '',
      guardian_name: s.guardian_name ?? '',
      guardian_phone: s.guardian_phone ?? '',
      guardian_email: s.guardian_email ?? '',
      enrollment_status: s.enrollment_status,
      fee_override: s.fee_override !== null ? String(s.fee_override) : '',
      admission_fee_amount: String(s.admission_fee_amount),
      admission_fee_paid: s.admission_fee_paid,
      security_fee_amount: String(s.security_fee_amount),
      security_fee_paid: s.security_fee_paid,
    })
    setError(null)
    setShowForm(true)
  }

  function handleClassChange(classId: string) {
    // On a new admission, default the monthly fee to the class's fee amount
    // (still editable) — but don't clobber an existing student's own override.
    const suggested = classId ? classById.get(classId)?.fee_amount : undefined
    setForm({
      ...form,
      class_id: classId,
      fee_override: !editing && suggested !== undefined ? String(suggested) : form.fee_override,
    })
  }

  async function handleSave() {
    if (!form.full_name.trim()) {
      setError('Student name is required.')
      return
    }
    if (form.contact_phone.trim() && !isValidPhone(form.contact_phone.trim())) {
      setError('Student contact phone must be a valid phone number (7-15 digits).')
      return
    }
    if (form.guardian_phone.trim() && !isValidPhone(form.guardian_phone.trim())) {
      setError('Guardian phone must be a valid phone number (7-15 digits).')
      return
    }
    if (form.guardian_email.trim() && !isValidEmail(form.guardian_email.trim())) {
      setError('Guardian email must be a valid email address.')
      return
    }
    const feeOverride = form.fee_override.trim() === '' ? null : Number(form.fee_override)
    if (feeOverride !== null && (Number.isNaN(feeOverride) || feeOverride < 0)) {
      setError('Monthly fee must be a non-negative number.')
      return
    }
    const admissionFeeAmount = Number(form.admission_fee_amount)
    const securityFeeAmount = Number(form.security_fee_amount)
    if (Number.isNaN(admissionFeeAmount) || admissionFeeAmount < 0 || Number.isNaN(securityFeeAmount) || securityFeeAmount < 0) {
      setError('Admission and security fee amounts must be non-negative numbers.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      full_name: form.full_name.trim(),
      class_id: form.class_id || null,
      contact_phone: form.contact_phone.trim() || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      guardian_email: form.guardian_email.trim() || null,
      enrollment_status: form.enrollment_status,
      fee_override: feeOverride,
      admission_fee_amount: admissionFeeAmount,
      admission_fee_paid: form.admission_fee_paid,
      security_fee_amount: securityFeeAmount,
      security_fee_paid: form.security_fee_paid,
    }

    const result = editing
      ? await supabase.from('students').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('students').insert(payload).select().single()

    if (result.error) {
      setSaving(false)
      setError(friendlyError(result.error.message))
      return
    }

    // The photo is stored under the student's id, so it can only be uploaded
    // once the row exists. A failure here is reported but does not undo the
    // save — the student is admitted, just without a picture yet.
    const saved = result.data as Student | null
    if (saved) {
      try {
        if (photoBlob) {
          const path = await uploadPhoto(saved.id, photoBlob)
          if (path !== saved.photo_path) {
            await supabase.from('students').update({ photo_path: path }).eq('id', saved.id)
          }
        } else if (dropPhoto && saved.photo_path) {
          await deletePhoto(saved.photo_path)
          await supabase.from('students').update({ photo_path: null }).eq('id', saved.id)
        }
      } catch (e) {
        show(e instanceof Error ? e.message : 'The student was saved, but the photo could not be.', 'error')
      }
    }

    setSaving(false)
    show(editing ? 'Student updated.' : 'Student added.')
    setShowForm(false)
    // A card number is assigned by the database the moment the student row is
    // created, so a new admission's card exists immediately — show it straight
    // away so it can be printed without a detour to the Student Cards tab.
    if (!editing && result.data) setNewCardFor(result.data as Student)
    load()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const { error } = await supabase.from('students').delete().eq('id', deleteTarget.id)
    if (error) {
      show(error.message, 'error')
    } else {
      show('Student deleted.')
      load()
    }
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Students</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{activeStudentCount} active ({students.length} total)</p>
        </div>
        <Button variant="secondary" onClick={() => setShowImport(true)}>
          Import CSV
        </Button>
        <Button onClick={openCreate}>+ Add Student</Button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <Input
          placeholder="Search by name..."
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
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="max-w-[180px]">
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[180px]">
          <option value="all">All statuses (excl. left)</option>
          <option value="enrolled">Enrolled</option>
          <option value="inactive">Inactive</option>
          <option value="graduated">Graduated</option>
          <option value="left">Left</option>
        </Select>
        <span className="ml-auto self-center text-sm text-slate-500 dark:text-slate-400">
          {filtered.length} of {students.length} students
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Guardian</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Admission / Security</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No students found.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setReportCardFor(s)}
                  className="cursor-pointer border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                    {s.full_name}
                    <div className="font-mono text-xs font-normal text-slate-400 dark:text-slate-500">{s.barcode}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                    {s.class_id && classById.get(s.class_id)?.category && (
                      <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                        ({classById.get(s.class_id)?.category})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {s.guardian_name || '—'}
                    {s.guardian_phone && <div className="text-xs text-slate-400 dark:text-slate-500">{s.guardian_phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.contact_phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.enrollment_status === 'enrolled'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : s.enrollment_status === 'inactive'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : s.enrollment_status === 'left'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {s.enrollment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.admission_fee_paid
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        Admission: {s.admission_fee_paid ? 'Paid' : 'Unpaid'}
                      </span>
                      <span
                        className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.security_fee_paid
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        Security: {s.security_fee_paid ? 'Paid' : 'Unpaid'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setReportCardFor(s)}
                      className="mr-3 text-sm text-slate-600 dark:text-slate-300 hover:underline"
                    >
                      View Report
                    </button>
                    <button onClick={() => openEdit(s)} className="mr-3 text-sm text-brand-600 hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(s)}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showImport && (
        <Modal title="Import students from CSV" onClose={() => setShowImport(false)} size="xl">
          <StudentImport
            classes={classes}
            onDone={() => {
              setShowImport(false)
              load()
            }}
          />
        </Modal>
      )}

      {showForm && (
        <Modal title={editing ? 'Edit Student' : 'Add Student'} onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="Full name">
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                autoFocus
              />
            </Field>
            <Field label="Class">
              <Select value={form.class_id} onChange={(e) => handleClassChange(e.target.value)}>
                <option value="">Unassigned</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monthly fee (defaults from class, editable per student)">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={
                  form.class_id ? `Class default: ${formatCurrency(classById.get(form.class_id)?.fee_amount ?? 0)}` : '0'
                }
                value={form.fee_override}
                onChange={(e) => setForm({ ...form, fee_override: e.target.value })}
              />
            </Field>
            <Field label="Student contact phone">
              <Input
                value={form.contact_phone}
                onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Guardian name">
                <Input
                  value={form.guardian_name}
                  onChange={(e) => setForm({ ...form, guardian_name: e.target.value })}
                />
              </Field>
              <Field label="Guardian phone">
                <Input
                  value={form.guardian_phone}
                  onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
                />
              </Field>
            </div>
            <StudentPhotoField
              studentName={form.full_name}
              existingUrl={editing ? photoUrls.get(editing.id) : undefined}
              onPick={setPhotoBlob}
              onRemove={() => setDropPhoto(true)}
            />

            <Field label="Guardian email (for fee reminders)">
              <Input
                type="email"
                value={form.guardian_email}
                onChange={(e) => setForm({ ...form, guardian_email: e.target.value })}
              />
            </Field>
            <Field label="Enrollment status">
              <Select
                value={form.enrollment_status}
                onChange={(e) => setForm({ ...form, enrollment_status: e.target.value as EnrollmentStatus })}
              >
                <option value="enrolled">Enrolled</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
                <option value="left">Left</option>
              </Select>
            </Field>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Admission Charges
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Admission fee amount">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.admission_fee_amount}
                    onChange={(e) => setForm({ ...form, admission_fee_amount: e.target.value })}
                  />
                </Field>
                <Field label="Security fee amount">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.security_fee_amount}
                    onChange={(e) => setForm({ ...form, security_fee_amount: e.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-2 flex gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.admission_fee_paid}
                    onChange={(e) => setForm({ ...form, admission_fee_paid: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Admission fee paid
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.security_fee_paid}
                    onChange={(e) => setForm({ ...form, security_fee_paid: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Security fee paid
                </label>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {reportCardFor && (
        <Modal title={`Student Report — ${reportCardFor.full_name}`} onClose={() => setReportCardFor(null)} wide>
          <div ref={reportCardPrintRef} className="print-area">
            <StudentFullReport student={reportCardFor} />
          </div>
          <div className="no-print mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReportCardFor(null)}>
              Close
            </Button>
            <Button onClick={() => printElement(reportCardPrintRef.current)}>Print</Button>
          </div>
        </Modal>
      )}

      {newCardFor && (
        <Modal title="Student card created" onClose={() => setNewCardFor(null)}>
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong>{newCardFor.full_name}</strong> was admitted and issued card number{' '}
              <span className="font-mono font-semibold">{newCardFor.barcode}</span>.
            </p>
            <div ref={newCardPrintRef} className="print-area card-sheet">
              <StudentCard
                photoUrl={photoUrls.get(newCardFor.id)}
                student={newCardFor}
                cls={newCardFor.class_id ? classById.get(newCardFor.class_id) : undefined}
              />
            </div>
            <div className="no-print flex justify-end gap-2 self-stretch">
              <Button variant="secondary" onClick={() => setNewCardFor(null)}>
                Later
              </Button>
              <Button onClick={() => printElement(newCardPrintRef.current)}>Print card</Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete student"
          message={`Delete ${deleteTarget.full_name}? This also removes their attendance, invoices, and exam results.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
