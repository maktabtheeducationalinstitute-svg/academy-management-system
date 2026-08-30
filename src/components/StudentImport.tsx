import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { isValidEmail, isValidPhone } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class } from '@/types/database'

// Admitting a whole intake one form at a time is the slowest thing an office
// does at the start of a term, and the data almost always already exists in a
// spreadsheet. This takes that spreadsheet directly.

/** Header aliases, so a file exported from Excel or Sheets works unedited. */
const COLUMNS: { key: string; aliases: string[]; label: string }[] = [
  { key: 'full_name', aliases: ['full_name', 'name', 'student', 'student name'], label: 'Name' },
  { key: 'class', aliases: ['class', 'class_name', 'grade', 'section'], label: 'Class' },
  { key: 'contact_phone', aliases: ['contact_phone', 'phone', 'student phone', 'mobile'], label: 'Phone' },
  { key: 'guardian_name', aliases: ['guardian_name', 'guardian', 'parent', 'parent name', 'father name'], label: 'Guardian' },
  { key: 'guardian_phone', aliases: ['guardian_phone', 'parent phone', 'guardian mobile'], label: 'Guardian phone' },
  { key: 'guardian_email', aliases: ['guardian_email', 'email', 'parent email'], label: 'Guardian email' },
  { key: 'fee_override', aliases: ['fee_override', 'monthly_fee', 'fee', 'monthly fee'], label: 'Monthly fee' },
  { key: 'admission_fee_amount', aliases: ['admission_fee_amount', 'admission_fee', 'admission fee'], label: 'Admission fee' },
  { key: 'security_fee_amount', aliases: ['security_fee_amount', 'security_fee', 'security fee'], label: 'Security fee' },
]

const TEMPLATE_HEADER = 'full_name,class,contact_phone,guardian_name,guardian_phone,guardian_email,monthly_fee,admission_fee,security_fee'
const TEMPLATE_ROW = 'Ali Raza,9-Biology,03001234567,Imran Raza,03007654321,imran@example.com,1200,5000,2000'

/**
 * Minimal RFC-4180 reader: handles quoted fields, commas and newlines inside
 * quotes, doubled quotes as an escape, and both CRLF and LF. A dependency for
 * this would be more code than the parser.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      // Swallow the LF of a CRLF pair rather than emitting a blank row.
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Trailing newlines produce a row of one empty field; drop those.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

interface ParsedRow {
  line: number
  values: Record<string, string>
  classId: string | null
  errors: string[]
}

export function StudentImport({ classes, onDone }: { classes: Class[]; onDone: () => void }) {
  const { show } = useToast()
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [unmapped, setUnmapped] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? []
  const badRows = rows?.filter((r) => r.errors.length > 0) ?? []

  function downloadTemplate() {
    const blob = new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_ROW}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'student-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    const text = await file.text()
    const table = parseCsv(text)
    if (table.length < 2) {
      setRows([])
      setUnmapped([])
      show('That file has a header but no rows.', 'error')
      return
    }

    // Match headers case- and space-insensitively so "Full Name" works.
    const header = table[0].map((h) => h.trim().toLowerCase())
    const index: Record<string, number> = {}
    const seen = new Set<number>()
    for (const col of COLUMNS) {
      const i = header.findIndex((h) => col.aliases.includes(h))
      if (i !== -1) {
        index[col.key] = i
        seen.add(i)
      }
    }
    setUnmapped(header.filter((h, i) => h !== '' && !seen.has(i)))

    const byClassName = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c.id]))

    const parsed: ParsedRow[] = table.slice(1).map((cells, n) => {
      const get = (key: string) => (index[key] === undefined ? '' : (cells[index[key]] ?? '').trim())
      const errors: string[] = []

      const fullName = get('full_name')
      if (!fullName) errors.push('Name is required')

      const className = get('class')
      let classId: string | null = null
      if (className) {
        classId = byClassName.get(className.toLowerCase()) ?? null
        if (!classId) errors.push(`No class named "${className}"`)
      }

      const email = get('guardian_email')
      if (email && !isValidEmail(email)) errors.push('Guardian email looks wrong')
      for (const [key, label] of [
        ['contact_phone', 'Phone'],
        ['guardian_phone', 'Guardian phone'],
      ] as const) {
        const v = get(key)
        if (v && !isValidPhone(v)) errors.push(`${label} looks wrong`)
      }
      for (const [key, label] of [
        ['fee_override', 'Monthly fee'],
        ['admission_fee_amount', 'Admission fee'],
        ['security_fee_amount', 'Security fee'],
      ] as const) {
        const v = get(key)
        if (v && (Number.isNaN(Number(v)) || Number(v) < 0)) errors.push(`${label} must be a number`)
      }

      return {
        line: n + 2, // +1 for the header, +1 because spreadsheets count from 1
        values: Object.fromEntries(COLUMNS.map((c) => [c.key, get(c.key)])),
        classId,
        errors,
      }
    })

    setRows(parsed)
  }

  async function runImport() {
    if (validRows.length === 0) return
    setImporting(true)

    const payload = validRows.map((r) => ({
      full_name: r.values.full_name,
      class_id: r.classId,
      contact_phone: r.values.contact_phone || null,
      guardian_name: r.values.guardian_name || null,
      guardian_phone: r.values.guardian_phone || null,
      guardian_email: r.values.guardian_email || null,
      enrollment_status: 'enrolled' as const,
      fee_override: r.values.fee_override ? Number(r.values.fee_override) : null,
      admission_fee_amount: r.values.admission_fee_amount ? Number(r.values.admission_fee_amount) : 0,
      admission_fee_paid: false,
      security_fee_amount: r.values.security_fee_amount ? Number(r.values.security_fee_amount) : 0,
      security_fee_paid: false,
    }))

    const { error } = await supabase.from('students').insert(payload)
    setImporting(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    // Card numbers are assigned by a database trigger, so every student
    // imported here already has a printable card waiting on Student Cards.
    show(`${payload.length} student${payload.length === 1 ? '' : 's'} imported.`)
    onDone()
  }

  return (
    <div className="space-y-4">
      {!rows && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Upload a CSV with one student per row. Only <strong>full_name</strong> is required; every other
            column is optional, and unknown columns are ignored.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">Also accepted as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {COLUMNS.map((c) => (
                  <tr key={c.key}>
                    <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200">{c.key}</td>
                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">
                      {c.aliases.filter((a) => a !== c.key).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <strong>Class</strong> must match an existing class name exactly (case does not matter). Add the
            classes first, or leave the column blank and assign students later.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
            <Button onClick={() => inputRef.current?.click()}>Choose CSV file</Button>
            <Button variant="secondary" onClick={downloadTemplate}>
              Download template
            </Button>
          </div>
        </>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{fileName}</span>
            <span className="text-green-700 dark:text-green-400">{validRows.length} ready</span>
            {badRows.length > 0 && (
              <span className="text-red-600 dark:text-red-400">{badRows.length} with problems</span>
            )}
          </div>

          {unmapped.length > 0 && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
              Ignored columns: {unmapped.join(', ')}
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Guardian</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'bg-red-50/60 dark:bg-red-950/20' : undefined}>
                    <td className="px-3 py-1.5 tabular-nums text-slate-400">{r.line}</td>
                    <td className="px-3 py-1.5 text-slate-800 dark:text-slate-100">{r.values.full_name || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{r.values.class || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{r.values.guardian_name || '—'}</td>
                    <td className="px-3 py-1.5">
                      {r.errors.length ? (
                        <span className="text-red-600 dark:text-red-400">{r.errors.join('; ')}</span>
                      ) : (
                        <span className="text-green-700 dark:text-green-400">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {badRows.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Rows with problems are skipped. Fix them in the file and import it again — the ones already
              brought in would be duplicated, so remove those lines first.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={runImport} disabled={importing || validRows.length === 0}>
              {importing ? 'Importing...' : `Import ${validRows.length} student${validRows.length === 1 ? '' : 's'}`}
            </Button>
            <Button variant="secondary" onClick={() => setRows(null)} disabled={importing}>
              Choose a different file
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
