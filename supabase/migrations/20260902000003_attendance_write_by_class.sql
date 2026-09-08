-- A teacher may mark the register for a class they teach, whoever filled it in
-- before them.
--
-- The write policies required `marked_by = auth.uid()`, which tied permission
-- to having personally created the row rather than to teaching the class. Three
-- consequences, all of which look like the app being broken:
--
--   * Reassign a subject to a different teacher and the new teacher cannot
--     correct any register the previous one had already saved. This is how it
--     was reported: "jo new teacher hota usy attendance ki permission ni hai".
--   * A row created by the barcode desk carries the front-desk account in
--     marked_by, so the class's own teacher could never correct a day the desk
--     had scanned.
--   * Two teachers sharing a class could not fix each other's marks.
--
-- The app saves a register with an upsert, so any day that already had rows
-- became an UPDATE and failed with "new row violates row-level security
-- policy" — no partial save, no useful message, just a failure.
--
-- Permission now comes from teaching the class, which is what it always should
-- have been: teacher_class_ids() is a live query over subjects, so reassigning
-- a subject moves write access across immediately, and the outgoing teacher
-- loses it just as immediately.
--
-- marked_by stays required on INSERT. Creating a row attributed to somebody
-- else is not something a teacher should be able to do, and nothing needs it:
-- an update simply leaves whatever attribution the row already had, or replaces
-- it with the teacher now saving.

drop policy if exists attendance_insert on attendance;
create policy attendance_insert on attendance for insert
  with check (
    is_admin()
    or (class_id in (select teacher_class_ids()) and marked_by = auth.uid())
  );

drop policy if exists attendance_update on attendance;
create policy attendance_update on attendance for update
  using (
    is_admin()
    or class_id in (select teacher_class_ids())
  )
  with check (
    is_admin()
    or class_id in (select teacher_class_ids())
  );
