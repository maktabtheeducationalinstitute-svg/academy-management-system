import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Select } from '@/components/ui/Input'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import { printElement } from '@/lib/printElement'
import { currentMonthValue, effectiveFee, formatCurrency, formatDate, formatMonth, monthValueToDate, netInvoiceAmount, shiftMonthValue, todayLocalDate } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class, Invoice, Student } from '@/types/database'

// A university-style fee voucher prints two identical copies on one A4 sheet
// — a "Bank Copy" the payer hands over at the counter and a "Student Copy"
// they keep for their own record — rather than a single slip, matching how
// banks actually process these vouchers. Both copies show the same amounts,
// so there's one source of truth for what's due; only the label differs.
function ChallanSlipContent({
  copyLabel,
  student,
  cls,
  monthLabel,
  invoice,
}: {
  copyLabel: string
  student: Student
  cls?: Class
  monthLabel: string
  invoice: Invoice
}) {
  const totalDue =
    (invoice.status === 'paid' ? 0 : netInvoiceAmount(invoice)) +
    (!student.admission_fee_paid ? student.admission_fee_amount : 0) +
    (!student.security_fee_paid ? student.security_fee_amount : 0)

  return (
    <div className="relative rounded-lg border border-slate-300 p-4 dark:border-slate-600">
      <span className="absolute right-4 top-4 rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:text-slate-400">
        {copyLabel}
      </span>
      <DocumentLetterhead subtitle="Fee Challan" />
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Student</span>
          <span>{student.full_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Class</span>
          <span>{cls?.name ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Month</span>
          <span>{monthLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Due Date</span>
          <span>{formatDate(invoice.due_date)}</span>
        </div>
        <div className="my-2 border-t border-slate-200 dark:border-slate-700" />
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Monthly Tuition Fee</span>
          <span className="font-semibold">{formatCurrency(invoice.amount)}</span>
        </div>
        {!student.admission_fee_paid && student.admission_fee_amount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Admission Fee (unpaid)</span>
            <span className="font-semibold">{formatCurrency(student.admission_fee_amount)}</span>
          </div>
        )}
        {!student.security_fee_paid && student.security_fee_amount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Security Fee (unpaid)</span>
            <span className="font-semibold">{formatCurrency(student.security_fee_amount)}</span>
          </div>
        )}
        {invoice.discount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Discount</span>
            <span className="font-semibold">-{formatCurrency(invoice.discount)}</span>
          </div>
        )}
        <div className="my-2 border-t border-slate-200 dark:border-slate-700" />
        <div className="flex justify-between text-base">
          <span className="font-semibold">Total Due</span>
          <span className="font-bold">{formatCurrency(totalDue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Status</span>
          <span className="capitalize">{invoice.status}</span>
        </div>
      </div>
    </div>
  )
}

export function FeeChallanPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [classFilter, setClassFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [feeDrafts, setFeeDrafts] = useState<Record<string, string>>({})
  const [dueDateDrafts, setDueDateDrafts] = useState<Record<string, string>>({})
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({})

  const [challanFor, setChallanFor] = useState<Student | null>(null)
  const [challanMonth, setChallanMonth] = useState(currentMonthValue())
  const [challanInvoice, setChallanInvoice] = useState<Invoice | null>(null)
  const [challanLoading, setChallanLoading] = useState(false)
  const [challanError, setChallanError] = useState<string | null>(null)
  const [dueDateDraft, setDueDateDraft] = useState('')
  const printAreaRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    const [studentsRes, classesRes, invoicesRes] = await Promise.all([
      supabase.from('students').select('*').eq('enrollment_status', 'enrolled').order('full_name'),
      supabase.from('classes').select('*').order('name'),
      supabase.from('invoices').select('*'),
    ])
    if (studentsRes.error) show(studentsRes.error.message, 'error')
    else setStudents(studentsRes.data as Student[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (invoicesRes.data) setInvoices(invoicesRes.data as Invoice[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const categories = useMemo(
    () => [...new Set(classes.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [classes]
  )

  const filtered = students.filter((s) => {
    const cls = s.class_id ? classById.get(s.class_id) : undefined
    if (classFilter !== 'all' && s.class_id !== classFilter) return false
    if (categoryFilter !== 'all' && cls?.category !== categoryFilter) return false
    return true
  })

  const invoicesByStudent = useMemo(() => {
    const map = new Map<string, Invoice[]>()
    for (const inv of invoices) {
      const list = map.get(inv.student_id) ?? []
      list.push(inv)
      map.set(inv.student_id, list)
    }
    return map
  }, [invoices])

  const currentMonth = monthValueToDate(currentMonthValue())

  // "Remaining" = the full outstanding balance across every month that's ever
  // been invoiced (each invoice already netted against its own discount),
  // plus unpaid one-time fees. "Discount" shown/edited here is specifically
  // this month's invoice discount. "To Be Paid" = this month's net due amount
  // + one-time fees.
  function feeSummary(student: Student) {
    const studentInvoices = invoicesByStudent.get(student.id) ?? []
    const oneTimeFees = (student.admission_fee_paid ? 0 : student.admission_fee_amount) + (student.security_fee_paid ? 0 : student.security_fee_amount)
    const thisMonthInvoice = studentInvoices.find((i) => i.month === currentMonth)
    const discount = thisMonthInvoice?.discount ?? 0
    const toBePaid =
      (thisMonthInvoice && thisMonthInvoice.status !== 'paid' ? netInvoiceAmount(thisMonthInvoice) : 0) + oneTimeFees
    const remaining =
      studentInvoices.filter((i) => i.status !== 'paid').reduce((sum, i) => sum + netInvoiceAmount(i), 0) + oneTimeFees
    return { discount, toBePaid, remaining }
  }

  async function saveFeeOverride(student: Student) {
    const draft = feeDrafts[student.id]
    if (draft === undefined) return
    const value = Number(draft)
    if (Number.isNaN(value) || value < 0) {
      show('Fee must be a non-negative number.', 'error')
      return
    }
    const { error } = await supabase.from('students').update({ fee_override: value }).eq('id', student.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Updated ${student.full_name}'s fee.`)
    setFeeDrafts((prev) => {
      const next = { ...prev }
      delete next[student.id]
      return next
    })
    load()
  }

  // Extends/edits this month's due date directly from the list, without
  // opening the full challan modal — the invoice must already exist (i.e.
  // a challan was generated for this month at least once).
  async function saveInlineDueDate(student: Student, invoice: Invoice) {
    const draft = dueDateDrafts[invoice.id]
    if (draft === undefined) return
    const { error } = await supabase.from('invoices').update({ due_date: draft || null }).eq('id', invoice.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Updated ${student.full_name}'s due date.`)
    setDueDateDrafts((prev) => {
      const next = { ...prev }
      delete next[invoice.id]
      return next
    })
    load()
  }

  // Discount applies to this month's invoice — the amount actually due right
  // now — rather than retroactively rewriting past unpaid months.
  async function saveInlineDiscount(student: Student, invoice: Invoice) {
    const draft = discountDrafts[invoice.id]
    if (draft === undefined) return
    const value = Number(draft)
    if (Number.isNaN(value) || value < 0) {
      show('Discount must be a non-negative number.', 'error')
      return
    }
    if (value > invoice.amount) {
      show('Discount cannot exceed the monthly fee amount.', 'error')
      return
    }
    const { error } = await supabase.from('invoices').update({ discount: value }).eq('id', invoice.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Updated ${student.full_name}'s discount.`)
    setDiscountDrafts((prev) => {
      const next = { ...prev }
      delete next[invoice.id]
      return next
    })
    load()
  }

  async function toggleAdmissionFee(student: Student) {
    const { error } = await supabase
      .from('students')
      .update({ admission_fee_paid: !student.admission_fee_paid })
      .eq('id', student.id)
    if (error) show(friendlyError(error.message), 'error')
    else load()
  }

  async function toggleSecurityFee(student: Student) {
    const { error } = await supabase
      .from('students')
      .update({ security_fee_paid: !student.security_fee_paid })
      .eq('id', student.id)
    if (error) show(friendlyError(error.message), 'error')
    else load()
  }

  // Each month gets its own tracked invoice — a challan is that month's
  // invoice, created on first view and reused (never duplicated) on repeat
  // visits, so "generate challan" is a recurring monthly obligation rather
  // than a one-off print.
  async function loadOrCreateChallan(student: Student, monthValue: string) {
    setChallanError(null)
    if (!student.class_id) {
      setChallanError('Assign this student to a class before generating a challan.')
      return
    }
    setChallanLoading(true)
    const month = monthValueToDate(monthValue)
    const existing = await supabase
      .from('invoices')
      .select('*')
      .eq('student_id', student.id)
      .eq('month', month)
      .maybeSingle()

    if (existing.error) {
      setChallanLoading(false)
      setChallanError(friendlyError(existing.error.message))
      return
    }

    if (existing.data) {
      const inv = existing.data as Invoice
      setChallanInvoice(inv)
      setDueDateDraft(inv.due_date ?? defaultDueDate(monthValue))
      setChallanLoading(false)
      return
    }

    const defaultDue = defaultDueDate(monthValue)
    const created = await supabase
      .from('invoices')
      .insert({
        student_id: student.id,
        class_id: student.class_id,
        month,
        amount: effectiveFee(student, classById),
        status: 'unpaid',
        due_date: defaultDue,
      })
      .select()
      .single()

    setChallanLoading(false)
    if (created.error) {
      setChallanError(friendlyError(created.error.message))
      return
    }
    setChallanInvoice(created.data as Invoice)
    setDueDateDraft(defaultDue)
  }

  function defaultDueDate(monthValue: string): string {
    return `${monthValue}-10`
  }

  function openChallan(student: Student) {
    const month = currentMonthValue()
    setChallanMonth(month)
    setChallanFor(student)
    setChallanInvoice(null)
    setChallanError(null)
    loadOrCreateChallan(student, month)
  }

  function changeChallanMonth(monthValue: string) {
    setChallanMonth(monthValue)
    if (challanFor) loadOrCreateChallan(challanFor, monthValue)
  }

  async function saveDueDate() {
    if (!challanInvoice) return
    const { error } = await supabase.from('invoices').update({ due_date: dueDateDraft || null }).eq('id', challanInvoice.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    setChallanInvoice({ ...challanInvoice, due_date: dueDateDraft || null })
    show('Due date saved.')
  }

  // Clicking Print previously left an edited-but-unsaved due date behind —
  // save it first so what's on the printed challan always matches what's saved.
  async function handlePrint() {
    if (challanInvoice && dueDateDraft !== (challanInvoice.due_date ?? '')) {
      await saveDueDate()
    }
    printElement(printAreaRef.current)
  }

  async function markChallanPaid() {
    if (!challanInvoice) return
    const { error } = await supabase
      .from('invoices')
      .update({ status: 'paid', payment_date: todayLocalDate() })
      .eq('id', challanInvoice.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    setChallanInvoice({ ...challanInvoice, status: 'paid', payment_date: todayLocalDate() })
    show('Marked as paid.')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Fee Challans</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Set each student's fee (defaults from their class) and generate a printable challan for any month, with its own due date.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Total To Be Paid Now</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700 dark:text-amber-400">
            {formatCurrency(filtered.reduce((sum, s) => sum + feeSummary(s).toBePaid, 0))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Total Remaining (all time)</p>
          <p className="mt-2 text-2xl font-semibold text-red-600 dark:text-red-400">
            {formatCurrency(filtered.reduce((sum, s) => sum + feeSummary(s).remaining, 0))}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
        <Field label="Class">
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category / stream">
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Admission Fee</th>
              <th className="px-4 py-3">Security Fee</th>
              <th className="px-4 py-3">Monthly Fee</th>
              <th className="px-4 py-3">Due Date (this month)</th>
              <th className="px-4 py-3">Total Remaining</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">To Be Paid</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No students match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleAdmissionFee(s)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.admission_fee_paid
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}
                    >
                      {formatCurrency(s.admission_fee_amount)} · {s.admission_fee_paid ? 'Paid' : 'Unpaid'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleSecurityFee(s)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.security_fee_paid
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}
                    >
                      {formatCurrency(s.security_fee_amount)} · {s.security_fee_paid ? 'Paid' : 'Unpaid'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={feeDrafts[s.id] ?? String(effectiveFee(s, classById))}
                        onChange={(e) => setFeeDrafts({ ...feeDrafts, [s.id]: e.target.value })}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                      />
                      {feeDrafts[s.id] !== undefined && feeDrafts[s.id] !== String(effectiveFee(s, classById)) && (
                        <button onClick={() => saveFeeOverride(s)} className="text-xs text-brand-600 hover:underline dark:text-gold-400">
                          Save
                        </button>
                      )}
                    </div>
                  </td>
                  {(() => {
                    const { discount, toBePaid, remaining } = feeSummary(s)
                    const thisMonthInvoice = (invoicesByStudent.get(s.id) ?? []).find((i) => i.month === currentMonth)
                    return (
                      <>
                        <td className="px-4 py-3">
                          {thisMonthInvoice ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="date"
                                value={dueDateDrafts[thisMonthInvoice.id] ?? thisMonthInvoice.due_date ?? ''}
                                onChange={(e) => setDueDateDrafts({ ...dueDateDrafts, [thisMonthInvoice.id]: e.target.value })}
                                className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                              />
                              {dueDateDrafts[thisMonthInvoice.id] !== undefined &&
                                dueDateDrafts[thisMonthInvoice.id] !== (thisMonthInvoice.due_date ?? '') && (
                                  <button
                                    onClick={() => saveInlineDueDate(s, thisMonthInvoice)}
                                    className="text-xs text-brand-600 hover:underline dark:text-gold-400"
                                  >
                                    Save
                                  </button>
                                )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">No challan yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-red-600 dark:text-red-400">{formatCurrency(remaining)}</td>
                        <td className="px-4 py-3">
                          {thisMonthInvoice ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={discountDrafts[thisMonthInvoice.id] ?? String(discount)}
                                onChange={(e) => setDiscountDrafts({ ...discountDrafts, [thisMonthInvoice.id]: e.target.value })}
                                className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                              />
                              {discountDrafts[thisMonthInvoice.id] !== undefined &&
                                discountDrafts[thisMonthInvoice.id] !== String(discount) && (
                                  <button
                                    onClick={() => saveInlineDiscount(s, thisMonthInvoice)}
                                    className="text-xs text-brand-600 hover:underline dark:text-gold-400"
                                  >
                                    Save
                                  </button>
                                )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-amber-700 dark:text-amber-400">{formatCurrency(toBePaid)}</td>
                      </>
                    )
                  })()}
                  <td className="px-4 py-3 text-right">
                    {s.class_id ? (
                      <button onClick={() => openChallan(s)} className="text-sm text-brand-600 hover:underline dark:text-gold-400">
                        Generate Challan
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500" title="Assign a class first">
                        No class
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {challanFor && (
        <Modal title="Fee Challan" onClose={() => setChallanFor(null)}>
          {challanError ? (
            <div className="space-y-4">
              <p className="text-sm text-red-600 dark:text-red-400">{challanError}</p>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setChallanFor(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <>
          <div className="no-print mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Month</label>
              <div className="flex gap-1">
                <Button variant="secondary" onClick={() => changeChallanMonth(shiftMonthValue(challanMonth, -1))} aria-label="Previous month">
                  ‹
                </Button>
                <input
                  type="month"
                  value={challanMonth}
                  onChange={(e) => changeChallanMonth(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <Button variant="secondary" onClick={() => changeChallanMonth(shiftMonthValue(challanMonth, 1))} aria-label="Next month">
                  ›
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Due date</label>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={dueDateDraft}
                  onChange={(e) => setDueDateDraft(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <Button variant="secondary" onClick={saveDueDate} disabled={!challanInvoice}>
                  Save
                </Button>
              </div>
            </div>
          </div>

          {challanLoading || !challanInvoice ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Loading challan...</p>
          ) : (
            <>
              <div ref={printAreaRef} className="print-area space-y-3">
                <ChallanSlipContent
                  copyLabel="Bank Copy"
                  student={challanFor}
                  cls={challanFor.class_id ? classById.get(challanFor.class_id) : undefined}
                  monthLabel={formatMonth(monthValueToDate(challanMonth))}
                  invoice={challanInvoice}
                />
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                  <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
                  <span className="text-[10px] uppercase tracking-widest">✂ Cut here</span>
                  <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
                </div>
                <ChallanSlipContent
                  copyLabel="Student Copy"
                  student={challanFor}
                  cls={challanFor.class_id ? classById.get(challanFor.class_id) : undefined}
                  monthLabel={formatMonth(monthValueToDate(challanMonth))}
                  invoice={challanInvoice}
                />
              </div>
              <div className="no-print mt-6 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setChallanFor(null)}>
                  Close
                </Button>
                {challanInvoice.status !== 'paid' && <Button onClick={markChallanPaid}>Mark Paid</Button>}
                <Button variant="secondary" onClick={handlePrint}>
                  Print
                </Button>
              </div>
            </>
          )}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
