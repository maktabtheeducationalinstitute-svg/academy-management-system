-- Student photographs, for the printed ID card.
--
-- A card with no face on it identifies a number, not a person, which defeats
-- most of the point of carrying one. The photo is stored in its own private
-- bucket and read through short-lived signed links, exactly like the book pages
-- already are — a child's photograph is the last thing that should be readable
-- by anyone who guesses a URL.
--
-- The column holds the path within the bucket rather than a URL, because a
-- signed URL expires and a stored one would rot.

alter table students add column if not exists photo_path text;

comment on column students.photo_path is
  'Path within the student-photos bucket, e.g. "<student_id>.jpg". Null when no photo has been uploaded. Never a URL — links are signed on demand.';

-- Private bucket: nothing here is world-readable.
insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do nothing;

-- Staff can see a student's photo. Only admins can put one there, change it or
-- remove it: a teacher marking a register has no business rewriting the roll's
-- photographs, and the front-desk kiosk account is deliberately excluded from
-- both — a compromised terminal at the door should not be able to read the
-- school's photographs of its children.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'student_photos_staff_read') then
    create policy student_photos_staff_read on storage.objects for select
      using (
        bucket_id = 'student-photos'
        and exists (
          select 1 from profiles p
          where p.id = auth.uid() and p.role in ('admin', 'teacher')
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'student_photos_admin_insert') then
    create policy student_photos_admin_insert on storage.objects for insert
      with check (
        bucket_id = 'student-photos'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'student_photos_admin_update') then
    create policy student_photos_admin_update on storage.objects for update
      using (
        bucket_id = 'student-photos'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'student_photos_admin_delete') then
    create policy student_photos_admin_delete on storage.objects for delete
      using (
        bucket_id = 'student-photos'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;
end;
$$;
