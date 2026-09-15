-- Two additions for the student ID card redesign:
--   1. A free-text "session" (academic year) on each student, printed on the
--      card and used for its "valid upto" line.
--   2. Somewhere to keep the principal's signature image, uploaded once in
--      Settings rather than per student — every card shares the same one.

alter table students add column if not exists session text;

comment on column students.session is
  'Free-text academic session/year (e.g. "2025-2026"), shown on the printed ID card. Null until set.';

-- Singleton settings row, same shape as attendance_settings: one row, id = 1.
create table if not exists institute_settings (
  id int primary key default 1,
  principal_signature_path text,
  constraint institute_settings_singleton check (id = 1)
);

insert into institute_settings (id) values (1) on conflict (id) do nothing;

comment on column institute_settings.principal_signature_path is
  'Path within the institute-assets bucket, e.g. "principal-signature.png". Null until uploaded. Never a URL — links are signed on demand.';

alter table institute_settings enable row level security;

create policy institute_settings_read on institute_settings for select
  using (is_admin() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy institute_settings_admin_write on institute_settings for update
  using (is_admin())
  with check (is_admin());

-- Private bucket, same reasoning as student-photos: signed links only.
insert into storage.buckets (id, name, public)
values ('institute-assets', 'institute-assets', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'institute_assets_staff_read') then
    create policy institute_assets_staff_read on storage.objects for select
      using (
        bucket_id = 'institute-assets'
        and exists (
          select 1 from profiles p
          where p.id = auth.uid() and p.role in ('admin', 'teacher')
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'institute_assets_admin_insert') then
    create policy institute_assets_admin_insert on storage.objects for insert
      with check (
        bucket_id = 'institute-assets'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'institute_assets_admin_update') then
    create policy institute_assets_admin_update on storage.objects for update
      using (
        bucket_id = 'institute-assets'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'institute_assets_admin_delete') then
    create policy institute_assets_admin_delete on storage.objects for delete
      using (
        bucket_id = 'institute-assets'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;
end;
$$;
