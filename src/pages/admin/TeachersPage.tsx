import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Input'
import { generateTempPassword, formatCurrency, isValidEmail, isValidPhone } from '@/lib/utils'
import { edgeFunctionError, friendlyError } from '@/lib/errors'
import type { Class, Profile, Subject, Teacher, TeacherStatus } from '@/types/database'

type TeacherRow = Teacher & Pick<Profile, 'full_name' | 'email' | 'phone'>

export function TeachersPage() {
  const { show } = useToast()
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherStatus>('all')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', phone: '', monthlySalary: '0' })
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{ email: string; tempPassword: string } | null>(null)

  const [editing, setEditing] = useState<TeacherRow | null>(null)
  const [editForm, setEditForm] = useState({ fullName: '', phone: '', monthlySalary: '0', status: 'active' as TeacherStatus })
  const [editError, setEditError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null)
  /** Null while still counting — the dialog says so rather than claiming zero. */
  const [deleteCounts, setDeleteCounts] = useState<{ salaries: number; attendance: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    const [profilesRes, subjectsRes, classesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name'),
      supabase.from('subjects').select('*').eq('status', 'active'),
      supabase.from('classes').select('*'),
    ])
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (classesRes.data) setClasses(classesRes.data as Class[])

    if (profilesRes.error) {
      show(profilesRes.error.message, 'error')
      setLoading(false)
      return
    }
    const teacherProfiles = profilesRes.data as Profile[]
    const ids = teacherProfiles.map((p) => p.id)
    const teachersRes = ids.length
      ? await supabase.from('teachers').select('*').in('id', ids)
      : { data: [], error: null }
    if (teachersRes.error) {
      show(teachersRes.error.message, 'error')
      setLoading(false)
      return
    }
    const teacherById = new Map((teachersRes.data as Teacher[]).map((t) => [t.id, t]))
    const merged: TeacherRow[] = teacherProfiles.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      phone: p.phone,
      monthly_salary: teacherById.get(p.id)?.monthly_salary ?? 0,
      status: teacherById.get(p.id)?.status ?? 'active',
      created_at: teacherById.get(p.id)?.created_at ?? p.created_at,
    }))
    setTeachers(merged)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeTeacherCount = useMemo(() => teachers.filter((t) => t.status !== 'left').length, [teachers])
  const filteredTeachers = useMemo(() => {
    if (statusFilter === 'all') return teachers.filter((t) => t.status !== 'left')
    return teachers.filter((t) => t.status === statusFilter)
  }, [teachers, statusFilter])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const subjectsByTeacher = useMemo(() => {
    const map = new Map<string, Subject[]>()
    for (const s of subjects) {
      if (!s.teacher_id) continue
      const list = map.get(s.teacher_id) ?? []
      list.push(s)
      map.set(s.teacher_id, list)
    }
    return map
  }, [subjects])

  async function handleCreate() {
    if (!createForm.fullName.trim() || !createForm.email.trim()) {
      setCreateError('Name and email are required.')
      return
    }
    if (!isValidEmail(createForm.email.trim())) {
      setCreateError('Enter a valid email address.')
      return
    }
    if (createForm.phone.trim() && !isValidPhone(createForm.phone.trim())) {
      setCreateError('Phone must be a valid phone number (7-15 digits).')
      return
    }
    setCreating(true)
    setCreateError(null)
    const tempPassword = generateTempPassword()
    const { data, error } = await supabase.functions.invoke('create-teacher', {
      body: {
        email: createForm.email.trim(),
        fullName: createForm.fullName.trim(),
        phone: createForm.phone.trim() || null,
        monthlySalary: Number(createForm.monthlySalary) || 0,
        tempPassword,
      },
    })
    setCreating(false)
    if (error) {
      setCreateError(await edgeFunctionError(error, 'Failed to create teacher account.'))
      return
    }
    if ((data as { error?: string })?.error) {
      setCreateError((data as { error?: string }).error!)
      return
    }
    setCreatedCreds({ email: createForm.email.trim(), tempPassword })
    setShowCreate(false)
    setCreateForm({ fullName: '', email: '', phone: '', monthlySalary: '0' })
    show('Teacher account created.')
    load()
  }

  async function handleEditSave() {
    if (!editing) return
    if (!editForm.fullName.trim()) {
      setEditError('Name is required.')
      return
    }
    if (editForm.phone.trim() && !isValidPhone(editForm.phone.trim())) {
      setEditError('Phone must be a valid phone number (7-15 digits).')
      return
    }
    const salary = Number(editForm.monthlySalary)
    if (Number.isNaN(salary) || salary < 0) {
      setEditError('Salary must be a non-negative number.')
      return
    }
    const [profileRes, teacherRes] = await Promise.all([
      supabase
        .from('profiles')
        .update({ full_name: editForm.fullName.trim(), phone: editForm.phone.trim() || null })
        .eq('id', editing.id),
      supabase.from('teachers').update({ monthly_salary: salary, status: editForm.status }).eq('id', editing.id),
    ])
    if (profileRes.error || teacherRes.error) {
      setEditError(friendlyError(profileRes.error?.message ?? teacherRes.error?.message ?? 'Failed to save.'))
      return
    }
    show('Teacher updated.')
    setEditing(null)
    load()
  }

  // Counted before the dialog opens, so the confirm names what is actually
  // about to be destroyed rather than describing it in the abstract. An admin
  // deleting a teacher with two years of payroll should see "24 salary
  // records" before they click, not afterwards.
  async function openDelete(teacher: TeacherRow) {
    setDeleteTarget(teacher)
    setDeleteCounts(null)
    const [salaryRes, attendanceRes] = await Promise.all([
      supabase.from('salaries').select('id', { count: 'exact', head: true }).eq('teacher_id', teacher.id),
      supabase.from('teacher_attendance').select('id', { count: 'exact', head: true }).eq('teacher_id', teacher.id),
    ])
    setDeleteCounts({ salaries: salaryRes.count ?? 0, attendance: attendanceRes.count ?? 0 })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.functions.invoke('delete-teacher', {
      body: { teacherId: deleteTarget.id },
    })
    setDeleting(false)
    if (error) {
      show(await edgeFunctionError(error, 'Failed to delete teacher account.'), 'error')
      return
    }
    show('Teacher account deleted.')
    setDeleteTarget(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Teachers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{activeTeacherCount} active ({teachers.length} total)</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Add Teacher</Button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | TeacherStatus)}
          className="max-w-[200px]"
        >
          <option value="all">All statuses (excl. left)</option>
          <option value="active">Active</option>
          <option value="left">Left</option>
        </Select>
        <span className="ml-auto self-center text-sm text-slate-500 dark:text-slate-400">
          {filteredTeachers.length} of {teachers.length} teachers
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Subjects / Classes</th>
              <th className="px-4 py-3">Monthly Salary</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : filteredTeachers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No teachers found.
                </td>
              </tr>
            ) : (
              filteredTeachers.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{t.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{t.email}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {(subjectsByTeacher.get(t.id) ?? []).length === 0
                      ? '—'
                      : (subjectsByTeacher.get(t.id) ?? [])
                          .map((s) => `${s.name} (${classById.get(s.class_id)?.name ?? '?'})`)
                          .join(', ')}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatCurrency(t.monthly_salary)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.status === 'active'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setEditing(t)
                        setEditForm({
                          fullName: t.full_name,
                          phone: t.phone ?? '',
                          monthlySalary: String(t.monthly_salary),
                          status: t.status,
                        })
                        setEditError(null)
                      }}
                      className="mr-3 text-sm text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    {/* Deleting destroys payroll and attendance history, so it
                        is offered only once a teacher has actually left. For
                        anyone still on the roll, changing the status is the
                        action that removes them from it. */}
                    {t.status === 'left' ? (
                      <button
                        onClick={() => openDelete(t)}
                        className="text-sm text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
                    ) : (
                      <span
                        className="text-sm text-slate-300 dark:text-slate-600"
                        title="Set this teacher's status to 'left' before deleting — deleting removes their salary and attendance history."
                      >
                        Delete
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Teacher" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <Field label="Full name">
              <Input
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                autoFocus
              />
            </Field>
            <Field label="Email (used as login)">
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
            </Field>
            <Field label="Monthly salary">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={createForm.monthlySalary}
                onChange={(e) => setCreateForm({ ...createForm, monthlySalary: e.target.value })}
              />
            </Field>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A random temporary password will be generated. The teacher must change it on first login.
            </p>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {createdCreds && (
        <Modal title="Teacher account created" onClose={() => setCreatedCreds(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-slate-600 dark:text-slate-300">Share these credentials with the teacher. They'll be asked to set a new password on first login.</p>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 font-mono text-sm">
              <div>Email: {createdCreds.email}</div>
              <div>Temporary password: {createdCreds.tempPassword}</div>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setCreatedCreds(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="Edit Teacher" onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field label="Full name">
              <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </Field>
            <Field label="Monthly salary">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editForm.monthlySalary}
                onChange={(e) => setEditForm({ ...editForm, monthlySalary: e.target.value })}
              />
            </Field>
            <Field label="Status">
              <Select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as TeacherStatus })}
              >
                <option value="active">Active</option>
                <option value="left">Left</option>
              </Select>
            </Field>
            {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={handleEditSave}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete teacher"
          message={
            deleteCounts === null
              ? `Checking what ${deleteTarget.full_name} has on file...`
              : `Permanently delete ${deleteTarget.full_name}? This removes their login, subject assignments and timetable slots — and destroys ` +
                `${deleteCounts.salaries} salary record${deleteCounts.salaries === 1 ? '' : 's'} and ` +
                `${deleteCounts.attendance} attendance day${deleteCounts.attendance === 1 ? '' : 's'}. ` +
                `That history cannot be recovered. To remove them from the roll without losing it, leave them marked 'left' instead.`
          }
          confirmLabel={deleting ? 'Deleting...' : 'Delete permanently'}
          danger
          onCancel={() => {
            setDeleteTarget(null)
            setDeleteCounts(null)
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
