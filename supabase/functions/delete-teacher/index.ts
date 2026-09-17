// Deletes a teacher's Supabase Auth account (their `profiles` and `teachers`
// rows cascade-delete via FK). Needs the service role key, so this must run
// server-side, same reasoning as create-teacher.
//
// Deploy: supabase functions deploy delete-teacher

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
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
    return jsonResponse({ error: 'Only admins can delete teacher accounts' }, 403)
  }

  const body = await req.json().catch(() => null)
  const teacherId = body?.teacherId
  if (!teacherId) {
    return jsonResponse({ error: 'teacherId is required' }, 400)
  }

  // salaries and teacher_attendance are `on delete restrict` on purpose, so a
  // teacher with payroll or attendance history cannot be removed by accident.
  // That is right for somebody still on the roll, but it also meant a teacher
  // who had genuinely left could never be cleared out — the delete simply
  // failed and told the admin to mark them 'left', which they already had.
  //
  // So the history is only ever destroyed for a teacher already marked 'left',
  // and only then. The caller is told how many records that is before it
  // happens (see countTeacherRecords below, used by the confirm dialog), so
  // "delete this teacher" never quietly means "delete a year of payroll".
  const { data: teacher } = await adminClient
    .from('teachers')
    .select('status')
    .eq('id', teacherId)
    .single()

  if (!teacher) {
    return jsonResponse({ error: 'No such teacher.' }, 404)
  }

  if (teacher.status !== 'left') {
    return jsonResponse(
      {
        error:
          'Only a teacher marked "left" can be deleted, because deleting one destroys their salary and attendance history. ' +
          'Set their status to "left" first — that alone removes them from the active roll and keeps the record.',
      },
      400
    )
  }

  // Order matters: the dependants block the parent delete, so they go first.
  const { error: salaryError } = await adminClient.from('salaries').delete().eq('teacher_id', teacherId)
  if (salaryError) {
    return jsonResponse({ error: `Could not remove salary records: ${salaryError.message}` }, 400)
  }

  const { error: attendanceError } = await adminClient
    .from('teacher_attendance')
    .delete()
    .eq('teacher_id', teacherId)
  if (attendanceError) {
    return jsonResponse({ error: `Could not remove attendance records: ${attendanceError.message}` }, 400)
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(teacherId)
  if (deleteError) {
    // Anything left blocking the delete is something this function does not
    // know about, so report it rather than guessing at the cause.
    const message = deleteError.message.includes('foreign key constraint')
      ? 'This teacher still has records attached that must be dealt with first: ' + deleteError.message
      : deleteError.message
    return jsonResponse({ error: message }, 400)
  }

  return jsonResponse({ success: true })
})
