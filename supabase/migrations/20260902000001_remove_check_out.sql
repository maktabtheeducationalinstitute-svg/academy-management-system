-- Remove check-out. The desk signs students in, and nothing else.
--
-- Check-in/check-out was built so the office could see how long a student was
-- actually in the building. In practice the academy only wants arrivals: a
-- second scan meaning "going home" turned out to be more to explain at the desk
-- than it was worth, so the whole departure half is going.
--
-- What stays, because it answers a different question and was never about
-- leaving: the arrival time, how late it was against the class timetable, and
-- the flag for an arrival late enough that the office should look at it.
--
-- What goes: departures, time-present, the append-only event log, the
-- inference that a very late first scan meant somebody leaving, and the three
-- settings that only existed to support those.

-- 1) The event log existed to record two kinds of event. With one kind left,
--    the daily attendance row carries everything, so the log is redundant.
drop table if exists attendance_events cascade;

drop function if exists public.refresh_attendance_day(uuid, uuid, date);

-- 2) Departure columns.
alter table attendance
  drop column if exists check_out_at,
  drop column if exists minutes_present;

-- 3) Two of the three review reasons described departures. 'no_check_in' meant
--    a student who only ever scanned on the way out; 'short_stay' meant they
--    left too soon. Neither can occur now, so existing rows carrying them are
--    cleared rather than left showing a reason the app no longer explains.
update attendance
  set review_reason = null
  where review_reason in ('no_check_in', 'short_stay');

alter table attendance drop constraint if exists attendance_review_reason_check;
alter table attendance
  add constraint attendance_review_reason_check
  check (review_reason is null or review_reason = 'very_late');

comment on column attendance.review_reason is
  'Set to ''very_late'' when an arrival was late enough that the office should look at it. Null otherwise.';

-- 4) Settings that only supported departures.
alter table attendance_settings
  drop column if exists arrival_cutoff_minutes,
  drop column if exists min_stay_minutes,
  drop column if exists rescan_window_seconds;

-- 5) The scan RPC: a card either signs a student in, or tells the desk they are
--    already in. Signature unchanged so the grant and the kiosk's call site
--    keep working; p_status is still ignored, as the status is derived from the
--    clock rather than typed at the desk.
create or replace function public.scan_student_attendance(
  p_barcode text,
  p_local_date date default null,
  p_status text default 'present'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_code text;
  v_student students%rowtype;
  v_class_name text;
  v_date date;
  v_existing attendance%rowtype;
  -- Held explicitly rather than read from FOUND: every SELECT below resets
  -- FOUND, including the timetable lookup, so testing it later silently asked
  -- the wrong question and skipped the insert entirely.
  v_had_row boolean;
  v_action text;
  v_status text;
  v_review text;
  v_check_in timestamptz;
  v_late int;
  v_tz text;
  v_default_start time;
  v_grace int;
  v_very_late int;
  v_sched_start time;
  v_sched_end time;
  v_start time;
  v_overdue_total numeric := 0;
  v_overdue_months text[] := '{}';
  v_due_now numeric := 0;
  v_admission_due numeric := 0;
  v_security_due numeric := 0;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'attendance') then
    raise exception 'Not authorized to record barcode attendance';
  end if;

  v_code := upper(btrim(coalesce(p_barcode, '')));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'empty',
      'message', 'Scan a student card, or type its number.');
  end if;

  select * into v_student from students where barcode = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'barcode', v_code,
      'message', 'No student is registered to card ' || v_code || '.');
  end if;

  if v_student.enrollment_status <> 'enrolled' then
    return jsonb_build_object('ok', false, 'error', 'not_enrolled', 'barcode', v_code,
      'student_name', v_student.full_name,
      'message', v_student.full_name || ' is marked "' || v_student.enrollment_status ||
                 '" and is not on the active roll.');
  end if;

  if v_student.class_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_class', 'barcode', v_code,
      'student_name', v_student.full_name,
      'message', v_student.full_name || ' is not assigned to a class, so attendance cannot be recorded.');
  end if;

  select name into v_class_name from classes where id = v_student.class_id;

  select timezone, default_start_time, grace_minutes, very_late_minutes
    into v_tz, v_default_start, v_grace, v_very_late
  from attendance_settings where id = 1;

  -- The terminal's own calendar date is used (the server clock runs in UTC and
  -- would roll the day over mid-evening local time), but only when it is within
  -- a day of the server's, so a wrong terminal clock cannot backdate a register.
  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  select * into v_existing from attendance
  where student_id = v_student.id and date = v_date;
  v_had_row := found;

  if v_had_row and v_existing.check_in_at is not null then
    -- Already signed in today. Nothing to change: a second card read is either
    -- the scanner bouncing or a student presenting twice, and neither is an
    -- event worth recording now that departures are gone.
    v_action := 'duplicate';
    v_status := v_existing.status;
    v_check_in := v_existing.check_in_at;
    v_late := v_existing.late_minutes;
    v_review := v_existing.review_reason;
  else
    select starts_at, ends_at into v_sched_start, v_sched_end
    from class_day_window(v_student.class_id, v_date);
    v_start := coalesce(v_sched_start, v_default_start);

    -- Lateness is a wall-clock question, so it is asked in academy time.
    v_late := greatest(
      floor(extract(epoch from ((now() at time zone v_tz)::time - v_start)) / 60)::int, 0);
    v_status := case when v_late > v_grace then 'late' else 'present' end;
    v_review := case when v_late > v_very_late then 'very_late' else null end;
    v_check_in := now();
    v_action := 'check_in';

    if v_had_row then
      -- A teacher had already marked the register by hand. The student is
      -- standing at the desk, so the scan is the better evidence and wins.
      update attendance
        set status = v_status,
            check_in_at = v_check_in,
            late_minutes = v_late,
            review_reason = v_review
        where id = v_existing.id;
    else
      insert into attendance (student_id, class_id, date, status, marked_by,
                              check_in_at, late_minutes, review_reason)
      values (v_student.id, v_student.class_id, v_date, v_status, auth.uid(),
              v_check_in, v_late, v_review)
      on conflict (student_id, date) do nothing;

      -- FOUND here belongs to the INSERT: false means the conflict clause
      -- swallowed it because a concurrent scanner won the race.
      if not found then
        -- Lost the race against a second scanner: report the row that won
        -- rather than overwriting a colleague's insert.
        select * into v_existing from attendance
          where student_id = v_student.id and date = v_date;
        if v_existing.id is not null then
          v_action := 'duplicate';
          v_status := v_existing.status;
          v_check_in := v_existing.check_in_at;
          v_late := v_existing.late_minutes;
          v_review := v_existing.review_reason;
        end if;
      end if;
    end if;
  end if;

  select ends_at into v_sched_end from class_day_window(v_student.class_id, v_date);

  -- Overdue = an unpaid invoice whose due date has passed, or (when no due date
  -- was set) one for a month that has already ended.
  select
    coalesce(sum(greatest(amount - discount, 0)), 0),
    coalesce(array_agg(to_char(month, 'Mon YYYY') order by month), '{}'::text[])
  into v_overdue_total, v_overdue_months
  from invoices
  where student_id = v_student.id
    and status <> 'paid'
    and (
      (due_date is not null and due_date < v_date)
      or (due_date is null and month < date_trunc('month', v_date)::date)
    );

  select coalesce(sum(greatest(amount - discount, 0)), 0)
  into v_due_now
  from invoices
  where student_id = v_student.id
    and status <> 'paid'
    and not (
      (due_date is not null and due_date < v_date)
      or (due_date is null and month < date_trunc('month', v_date)::date)
    );

  if not v_student.admission_fee_paid then
    v_admission_due := v_student.admission_fee_amount;
  end if;
  if not v_student.security_fee_paid then
    v_security_due := v_student.security_fee_amount;
  end if;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'full_name', v_student.full_name,
      'barcode', v_student.barcode,
      'class_name', v_class_name,
      'guardian_name', v_student.guardian_name,
      'guardian_phone', v_student.guardian_phone
    ),
    'attendance', jsonb_build_object(
      'date', v_date,
      'action', v_action,
      'status', v_status,
      'check_in_at', v_check_in,
      'late_minutes', v_late,
      'review_reason', v_review,
      'scheduled_end', v_sched_end,
      -- Kept so a desk running an older bundle still renders a card.
      'signed_in_at', v_check_in,
      'already_marked', v_action = 'duplicate'
    ),
    'fee', jsonb_build_object(
      'overdue', v_overdue_total > 0,
      'overdue_amount', v_overdue_total,
      'overdue_months', to_jsonb(v_overdue_months),
      'due_now_amount', v_due_now,
      'admission_fee_due', v_admission_due,
      'security_fee_due', v_security_due
    )
  );
end;
$$;

-- 6) The desk's running list, now read from the register rather than the event
--    log it used to come from. Still a database read, so restarting the kiosk
--    or signing in again keeps the day's sign-ins on screen.
create or replace function public.recent_attendance_scans(
  p_local_date date default null,
  p_limit int default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_date date;
  v_rows jsonb;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'attendance') then
    raise exception 'Not authorized to read attendance scans';
  end if;

  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.scanned_at desc), '[]'::jsonb) into v_rows
  from (
    select a.check_in_at as scanned_at,
           s.full_name,
           c.name as class_name,
           a.review_reason
    from attendance a
    join students s on s.id = a.student_id
    left join classes c on c.id = a.class_id
    where a.date = v_date and a.check_in_at is not null
    order by a.check_in_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 200)
  ) r;

  return v_rows;
end;
$$;

revoke all on function public.scan_student_attendance(text, date, text) from public;
grant execute on function public.scan_student_attendance(text, date, text) to authenticated;
revoke all on function public.recent_attendance_scans(date, int) from public;
grant execute on function public.recent_attendance_scans(date, int) to authenticated;
