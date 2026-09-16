// Emails a guardian a combined attendance + exam report PDF for one student
// for one month. The PDF itself is built client-side (see
// src/lib/pdf.ts:buildMonthlyReportPdfBase64) and passed in as base64 — this
// function's job is just: verify the caller is an admin, look up the
// guardian's email, send a branded email with that PDF attached via Resend,
// and record that it went out.
//
// Manual/test-trigger only for now — invoked per student from the admin UI.
// No automated month-end scheduling is wired up yet; that's a deliberate
// next step once someone has reviewed how these emails look.
//
// Deploy: supabase functions deploy send-monthly-report
// Requires the RESEND_API_KEY secret (shared with send-fee-reminder):
//   supabase secrets set RESEND_API_KEY=...
//
// Sandbox note: until you verify a domain in Resend, emails can only be
// delivered to the address you signed up to Resend with — any other
// recipient will be rejected by Resend, not by this function.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// No sandbox fallback on purpose. Defaulting to onboarding@resend.dev used to
// make a misconfigured install look healthy: Resend accepted every request and
// then delivered only to the account owner, so "Reminder sent" appeared on
// screen while guardians received nothing and no error was raised anywhere.
// Requiring the address means a missing domain fails loudly at the first send.
const FROM_ADDRESS = Deno.env.get('REMINDER_FROM_ADDRESS')
// Stable, unhashed logo path (public/maktab-logo.png) — safe to reference by
// URL in an email since it won't change filename on every rebuild the way
// Vite's fingerprinted src/assets copy does.
const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://academy-management-system-rho.vercel.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!RESEND_API_KEY) {
    return jsonResponse(
      { error: 'RESEND_API_KEY is not configured. Run: supabase secrets set RESEND_API_KEY=your-key' },
      500
    )
  }

  if (!FROM_ADDRESS) {
    return jsonResponse(
      {
        error:
          'REMINDER_FROM_ADDRESS is not configured, so mail would be sent from the Resend sandbox sender and reach nobody but the Resend account owner. ' +
          'Verify a domain in Resend, then run: supabase secrets set REMINDER_FROM_ADDRESS="Your Academy <noreply@yourdomain.com>"',
      },
      500
    )
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace('Bearer ', '')
  if (!callerToken) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: callerUser, error: callerError } = await adminClient.auth.getUser(callerToken)
  if (callerError || !callerUser?.user) {
    return jsonResponse({ error: 'Invalid session' }, 401)
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.user.id)
    .single()

  if (callerProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Only admins can send monthly reports' }, 403)
  }

  const body = await req.json().catch(() => null)
  const studentId = body?.studentId
  const month = body?.month // 'YYYY-MM-01'
  const pdfBase64 = body?.pdfBase64
  const remarks = typeof body?.remarks === 'string' && body.remarks.trim() ? body.remarks.trim() : null
  if (!studentId || !month) {
    return jsonResponse({ error: 'studentId and month are required' }, 400)
  }
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return jsonResponse({ error: 'pdfBase64 is required' }, 400)
  }

  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('full_name, guardian_name, guardian_email, class_id')
    .eq('id', studentId)
    .single()
  if (studentError || !student) {
    return jsonResponse({ error: 'Student not found' }, 404)
  }
  if (!student.guardian_email) {
    return jsonResponse({ error: 'No guardian email on file for this student' }, 400)
  }

  const { data: klass } = student.class_id
    ? await adminClient.from('classes').select('name').eq('id', student.class_id).single()
    : { data: null }

  const monthLabel = new Date(month + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #241713;">
      <div style="text-align: center; padding: 24px 0 16px;">
        <img src="${SITE_URL}/maktab-logo.png" alt="Maktab - The Educational Institute" width="64" height="64" style="display: inline-block;" />
        <h1 style="font-size: 18px; color: #7a1f2e; margin: 12px 0 2px;">Maktab - The Educational Institute</h1>
        <p style="font-size: 13px; color: #666; margin: 0;">Monthly Student Report</p>
      </div>
      <div style="border-top: 2px solid #dfb65b; padding-top: 20px;">
        <p>Dear ${student.guardian_name ?? 'Parent/Guardian'},</p>
        <p>
          Please find attached <strong>${student.full_name}</strong>'s${klass?.name ? ` (${klass.name})` : ''} attendance
          and exam report for <strong>${monthLabel}</strong>.
        </p>
        ${
          remarks
            ? `<div style="margin: 16px 0; padding: 12px 14px; background: #fdfbf5; border-left: 3px solid #dfb65b;">
                 <p style="margin: 0 0 4px; font-weight: 600; color: #7a1f2e; font-size: 13px;">Remarks</p>
                 <p style="margin: 0; white-space: pre-wrap;">${remarks.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</p>
               </div>`
            : ''
        }
        <p>If you have any questions about this report, please reach out to the school office.</p>
        <p style="margin-top: 28px; margin-bottom: 0;">Thank you,</p>
        <p style="margin-top: 2px; font-weight: 600; color: #7a1f2e;">Maktab - The Educational Institute</p>
      </div>
    </div>
  `

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [student.guardian_email],
      subject: `Monthly Report — ${student.full_name} — ${monthLabel}`,
      html,
      attachments: [
        {
          filename: `Monthly Report - ${student.full_name} - ${monthLabel}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  })

  const resendBody = await resendRes.json().catch(() => ({}))

  if (!resendRes.ok) {
    return jsonResponse(
      { error: resendBody?.message ?? `Resend rejected the email (status ${resendRes.status})`, resend: resendBody },
      502
    )
  }

  await adminClient
    .from('monthly_reports')
    .upsert({ student_id: studentId, month, sent_at: new Date().toISOString(), remarks }, { onConflict: 'student_id,month' })

  return jsonResponse({ success: true, to: student.guardian_email })
})
