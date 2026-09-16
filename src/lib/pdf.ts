import { formatDate } from '@/lib/utils'

// jsPDF + autotable are only needed when actually exporting a PDF, and pull in
// a sizeable dependency (html2canvas et al.) — dynamic import keeps them out of
// the main bundle until this function is actually called. The logo is also
// imported dynamically alongside them so its base64 payload never lands in
// the main bundle either.
import {
  formatDuration,
  numberedQuestions,
  parseQuestionText,
  PART_LABELS,
  visibleParts,
  RULE_BLUE,
  SCHOOL_ADDRESS,
  SCHOOL_NAME,
  SCHOOL_TAGLINE,
  TAGLINE_NAVY,
  type QuestionPaper,
} from '@/lib/examPaper'
import { cropToDataUrl } from '@/lib/sourceBooks'

const LOGO_WIDTH_MM = 16
const LOGO_ASPECT = 512 / 461 // width / height of the source logo asset

export async function downloadAttendanceSheetPdf(params: {
  className: string
  date: string
  rows: { name: string; status: string }[]
}) {
  const { className, date, rows } = params
  const [{ default: jsPDF }, { default: autoTable }, { MAKTAB_LOGO_BASE64 }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/assets/maktabLogoBase64'),
  ])
  const doc = new jsPDF()

  const logoHeight = LOGO_WIDTH_MM / LOGO_ASPECT
  doc.addImage(MAKTAB_LOGO_BASE64, 'PNG', 105 - LOGO_WIDTH_MM / 2, 8, LOGO_WIDTH_MM, logoHeight)

  const textStartY = 8 + logoHeight + 6
  doc.setFontSize(14)
  doc.text('Maktab - The Educational Institute', 105, textStartY, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(100)
  doc.text('Attendance Sheet', 105, textStartY + 7, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(10)
  const detailsY = textStartY + 18
  doc.text(`Class: ${className}`, 14, detailsY)
  doc.text(`Date: ${date}`, 196, detailsY, { align: 'right' })

  autoTable(doc, {
    startY: detailsY + 6,
    head: [['#', 'Student Name', 'Status']],
    body: rows.map((r, i) => [String(i + 1), r.name, r.status || '—']),
    headStyles: { fillColor: [122, 31, 46] },
    styles: { fontSize: 10 },
  })

  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? detailsY + 6
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Present/Late: ${present} of ${rows.length}`, 14, finalY + 8)

  doc.save(`attendance-${className.replace(/\s+/g, '_')}-${date}.pdf`)
}

// Combined attendance + exam-results PDF for one student's month, used as an
// email attachment (returns raw base64, no data: prefix, ready for Resend's
// `attachments[].content`) rather than triggering a browser download.
export async function buildMonthlyReportPdfBase64(params: {
  studentName: string
  className: string
  monthLabel: string
  attendance: { date: string; status: string }[]
  exams: { examName: string; subjectName: string; obtained: number; total: number }[]
  remarks?: string
}): Promise<string> {
  const { studentName, className, monthLabel, attendance, exams, remarks } = params
  const [{ default: jsPDF }, { default: autoTable }, { MAKTAB_LOGO_BASE64 }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/assets/maktabLogoBase64'),
  ])
  const doc = new jsPDF()

  const logoHeight = LOGO_WIDTH_MM / LOGO_ASPECT
  doc.addImage(MAKTAB_LOGO_BASE64, 'PNG', 105 - LOGO_WIDTH_MM / 2, 8, LOGO_WIDTH_MM, logoHeight)

  const textStartY = 8 + logoHeight + 6
  doc.setFontSize(14)
  doc.text('Maktab - The Educational Institute', 105, textStartY, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(100)
  doc.text('Monthly Report', 105, textStartY + 7, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(10)
  const detailsY = textStartY + 18
  doc.text(`Student: ${studentName}`, 14, detailsY)
  doc.text(`Class: ${className || '—'}`, 14, detailsY + 6)
  doc.text(`Month: ${monthLabel}`, 196, detailsY, { align: 'right' })

  // Page 1: attendance, as its own full page with a day-by-day table —
  // exam results always start on page 2 so the two don't run together.
  let cursorY = detailsY + 18
  doc.setFontSize(12)
  doc.setTextColor(122, 31, 46)
  doc.text('Attendance', 14, cursorY)
  doc.setTextColor(0)
  doc.setFontSize(10)
  cursorY += 7

  if (attendance.length === 0) {
    doc.text('No attendance was recorded this month.', 14, cursorY)
  } else {
    const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
    const pct = Math.round((present / attendance.length) * 1000) / 10
    doc.text(`Present: ${present} / ${attendance.length} days recorded (${pct}%)`, 14, cursorY)
    cursorY += 8

    // Two side-by-side columns rather than one long list — a full month
    // (up to 31 rows) comfortably fits within a single page this way,
    // instead of spilling onto a second page and pushing exam results
    // further out.
    const sorted = [...attendance].sort((a, b) => a.date.localeCompare(b.date))
    const half = Math.ceil(sorted.length / 2)
    const left = sorted.slice(0, half)
    const right = sorted.slice(half)
    const rowsToBody = (rows: typeof sorted) =>
      rows.map((a) => [formatDate(a.date), a.status.charAt(0).toUpperCase() + a.status.slice(1)])

    autoTable(doc, {
      startY: cursorY,
      head: [['Date', 'Status']],
      body: rowsToBody(left),
      headStyles: { fillColor: [122, 31, 46] },
      styles: { fontSize: 9, cellPadding: 1.5 },
      margin: { left: 14 },
      tableWidth: 88,
    })
    if (right.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['Date', 'Status']],
        body: rowsToBody(right),
        headStyles: { fillColor: [122, 31, 46] },
        styles: { fontSize: 9, cellPadding: 1.5 },
        margin: { left: 108 },
        tableWidth: 88,
      })
    }
  }

  if (exams.length > 0) {
    doc.addPage()
    doc.setFontSize(12)
    doc.setTextColor(122, 31, 46)
    doc.text(`Exam Results — ${studentName}`, 14, 20)
    doc.setTextColor(100)
    doc.setFontSize(10)
    doc.text(`${className || '—'} · ${monthLabel}`, 14, 27)
    doc.setTextColor(0)
    autoTable(doc, {
      startY: 34,
      head: [['Exam', 'Subject', 'Marks', '%']],
      body: exams.map((e) => [
        e.examName,
        e.subjectName,
        `${e.obtained} / ${e.total}`,
        `${Math.round((e.obtained / e.total) * 1000) / 10}%`,
      ]),
      headStyles: { fillColor: [122, 31, 46] },
      styles: { fontSize: 10 },
    })
  }

  // A short personal note the admin wrote while reviewing this specific
  // report before sending it — not tied to any attendance/exam record, so it
  // always goes at the very end, after whatever tables came before it.
  if (remarks && remarks.trim()) {
    const lastTableY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY
    let remarksY = lastTableY + 14
    if (remarksY > 270) {
      doc.addPage()
      remarksY = 20
    }
    doc.setFontSize(11)
    doc.setTextColor(122, 31, 46)
    doc.text('Remarks', 14, remarksY)
    doc.setTextColor(0)
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(remarks.trim(), 182)
    doc.text(lines, 14, remarksY + 7)
  }

  const dataUri = doc.output('datauristring')
  return dataUri.slice(dataUri.indexOf('base64,') + 'base64,'.length)
}

// ---------------------------------------------------------------------------
// Question paper
//
// Laid out in points against A4, matching the Word letterhead the school
// already hands out: crest top-left, the rule under the tagline, the four-cell
// particulars grid and a washed-out crest behind the questions. Coordinates
// below are the measured positions from that reference paper, which is why
// they are concrete numbers rather than a margin/gap system.
// ---------------------------------------------------------------------------
const PAGE_W = 595.28
const PAGE_H = 841.89
const CENTER = PAGE_W / 2
const BODY_LEFT = 14
const BODY_RIGHT = 581.3
const BODY_BOTTOM = PAGE_H - 42

// Particulars grid: four cells per row, label / value / label / value.
const GRID_COLS = [13.9, 85.9, 267, 383.2, 581.3]
const GRID_TOP = 135.7
const GRID_ROW_H = 17.4

const QUESTION_TOP = 205
const LINE_H = 19
const BLOCK_GAP = 10
const PART_MARKER_X = 32
const PART_TEXT_X = 50

type Doc = import('jspdf').jsPDF

// A snipped question is a region of a scanned page. The page is fetched once,
// the wanted region drawn onto a canvas, and that canvas placed in the PDF —
// so an Urdu or hand-drawn question prints exactly as it appears in the book,
// with no font or text encoding involved at all. cropToDataUrl lives with the
// rest of the book-page handling, and is shared with the AI reader.

// The paper's body font. jsPDF's built-in faces are WinAnsi-encoded, so a
// maths symbol came out as mangled punctuation; this is a subsetted DejaVu
// Sans Bold registered at document level. The letterhead keeps helvetica and
// times, which is plain ASCII and needs nothing special.
const BODY_FONT = 'MaktabUnicode'

async function registerBodyFont(doc: Doc) {
  const { PDF_UNICODE_FONT_BASE64 } = await import('@/assets/pdfUnicodeFont')
  doc.addFileToVFS('MaktabUnicode-Bold.ttf', PDF_UNICODE_FONT_BASE64)
  doc.addFont('MaktabUnicode-Bold.ttf', BODY_FONT, 'bold')
}


function drawWatermark(doc: Doc, logo: string) {
  // Behind everything, so it goes down before any text on the page. The crest
  // is knocked back far enough to read through — the questions have to stay
  // legible on a photocopy.
  const w = 520
  const h = w / LOGO_ASPECT
  doc.saveGraphicsState()
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => never }).GState({ opacity: 0.1 }))
  doc.addImage(logo, 'PNG', CENTER - w / 2, 190, w, h)
  doc.restoreGraphicsState()
}

function drawLetterhead(doc: Doc, logo: string) {
  const logoH = 63
  doc.addImage(logo, 'PNG', 17.8, 42, logoH * LOGO_ASPECT, logoH)

  doc.setTextColor(0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(SCHOOL_NAME, CENTER, 68, { align: 'center' })

  // The tagline is the one serif line on the sheet; keeping it distinct from
  // the sans everywhere else is what makes the letterhead recognisable.
  doc.setFont('times', 'normal')
  doc.setFontSize(16)
  doc.setTextColor(TAGLINE_NAVY)
  doc.text(SCHOOL_TAGLINE, CENTER, 87, { align: 'center' })

  doc.setDrawColor(RULE_BLUE)
  doc.setLineWidth(1)
  doc.line(100, 94, BODY_RIGHT, 94)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(0)
  doc.text(SCHOOL_ADDRESS, CENTER, 106, { align: 'center' })
}

function drawParticulars(doc: Doc, paper: QuestionPaper) {
  const duration = formatDuration(paper.durationMinutes)

  doc.setFont(BODY_FONT, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0)
  if (duration) doc.text(`TIME ${duration}`, BODY_LEFT, 131.5)
  doc.text(paper.examName, CENTER, 131.5, { align: 'center' })
  doc.text(`TOTAL MARKS ${paper.totalMarks}`, BODY_RIGHT, 131.5, { align: 'right' })

  const rows: [string, string, string, string][] = [
    ['NAME', '', 'CLASS', paper.className],
    ['ROLL NO', '', 'DATE', ''],
    ['SUBJECT', paper.subjectName, 'SUBJECT TEACHER', ''],
  ]

  doc.setDrawColor(0)
  doc.setLineWidth(0.5)
  const gridBottom = GRID_TOP + GRID_ROW_H * rows.length
  for (let i = 0; i <= rows.length; i++) {
    const y = GRID_TOP + GRID_ROW_H * i
    doc.line(GRID_COLS[0], y, GRID_COLS[4], y)
  }
  for (const x of GRID_COLS) doc.line(x, GRID_TOP, x, gridBottom)

  rows.forEach((row, i) => {
    const y = GRID_TOP + GRID_ROW_H * i + 12.3
    row.forEach((cell, col) => {
      if (!cell) return
      // Labels sit a step smaller than the answers written beside them.
      doc.setFontSize(col % 2 === 0 ? 10 : 11.5)
      doc.text(cell, GRID_COLS[col] + 6, y)
    })
  })
}

export async function downloadQuestionPaperPdf(paper: QuestionPaper) {
  const [{ default: jsPDF }, { MAKTAB_LOGO_BASE64 }] = await Promise.all([
    import('jspdf'),
    import('@/assets/maktabLogoBase64'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  await registerBodyFont(doc)
  drawWatermark(doc, MAKTAB_LOGO_BASE64)
  drawLetterhead(doc, MAKTAB_LOGO_BASE64)
  drawParticulars(doc, paper)

  doc.setFont(BODY_FONT, 'bold')
  doc.setFontSize(12)
  doc.setTextColor(0)

  let y = QUESTION_TOP
  const stemWidth = BODY_RIGHT - BODY_LEFT
  const partWidth = BODY_RIGHT - PART_TEXT_X

  function newPageIfNeeded(needed: number) {
    if (y + needed <= BODY_BOTTOM) return
    doc.addPage()
    drawWatermark(doc, MAKTAB_LOGO_BASE64)
    doc.setFont(BODY_FONT, 'bold')
    doc.setFontSize(12)
    doc.setTextColor(0)
    y = 60
  }

  const numbers = numberedQuestions(paper.parts)

  for (const part of paper.parts) {
    // Only worth a banner when the paper has both halves, matching the sheet.
    if (paper.parts.length > 1) {
      newPageIfNeeded(LINE_H)
      doc.setFontSize(11)
      doc.text(PART_LABELS[part.part], CENTER, y, { align: 'center' })
      doc.setFontSize(12)
      y += LINE_H
    }

    for (const section of part.sections) {
      // An untitled section is the implicit one holding unassigned questions,
      // so it prints no heading — a paper built before sections existed looks
      // exactly as it did.
      if (section.title || section.instruction) {
        newPageIfNeeded(LINE_H * 2)
        doc.setFontSize(11)
        if (section.title) doc.text(section.title, BODY_LEFT, y)
        if (section.instruction) doc.text(section.instruction, BODY_RIGHT, y, { align: 'right' })
        y += 4
        doc.setLineWidth(0.5)
        doc.setDrawColor(0)
        doc.line(BODY_LEFT, y, BODY_RIGHT, y)
        y += LINE_H - 2
        doc.setFontSize(12)
      }

      for (const question of section.questions) {
        // A snip is the whole question — its label is only a filing note.
        if (question.snip?.url) {
          const { dataUrl, aspect } = await cropToDataUrl(question.snip.url, question.snip.crop)
          const width = BODY_RIGHT - PART_TEXT_X
          const height = width * aspect
          newPageIfNeeded(height + LINE_H)
          doc.text(`Qno: ${numbers.get(question) ?? 0}`, BODY_LEFT, y)
          doc.addImage(dataUrl, 'JPEG', PART_TEXT_X, y - LINE_H + 6, width, height)
          y += height + BLOCK_GAP
          continue
        }

        const { stem } = parseQuestionText(question.question_text)
        const parts = visibleParts(question)
        const stemLines = doc.splitTextToSize(
          `Qno: ${numbers.get(question) ?? 0}  ${stem}`,
          stemWidth
        ) as string[]

        newPageIfNeeded(stemLines.length * LINE_H)
        for (const line of stemLines) {
          doc.text(line, BODY_LEFT, y)
          y += LINE_H
        }

        const options = question.question_type === 'mcq' ? (question.options ?? []) : []
        if (options.length > 0) {
          // One wrapped row of choices, as they appear on a board paper.
          const line = options.map((o) => `(${o.key.toLowerCase()}) ${o.text}`).join('    ')
          const optionLines = doc.splitTextToSize(line, BODY_RIGHT - PART_TEXT_X) as string[]
          newPageIfNeeded(optionLines.length * LINE_H)
          for (const optionLine of optionLines) {
            doc.text(optionLine, PART_TEXT_X, y)
            y += LINE_H
          }
        }

        if (parts.length > 0) {
          y += BLOCK_GAP // a visible step down from the stem into its sub-parts
          for (const subPart of parts) {
            const partLines = doc.splitTextToSize(subPart.text, partWidth) as string[]
            newPageIfNeeded(partLines.length * LINE_H)
            doc.text(subPart.marker, PART_MARKER_X, y)
            partLines.forEach((line, i) => {
              doc.text(line, PART_TEXT_X, y + i * LINE_H)
            })
            y += partLines.length * LINE_H
          }
        }

        y += BLOCK_GAP
      }
    }
  }

  const safeName = `${paper.examName}-${paper.subjectName}-${paper.className}`
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  doc.save(`${safeName || 'question-paper'}.pdf`)
}
