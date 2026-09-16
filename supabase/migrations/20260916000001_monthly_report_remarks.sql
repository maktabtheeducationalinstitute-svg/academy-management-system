-- The admin now previews a monthly report before sending it and can attach a
-- personal note (e.g. "Needs to improve in Math") — kept alongside the send
-- record so the office can see later what was actually written to a guardian.
alter table monthly_reports add column if not exists remarks text;

comment on column monthly_reports.remarks is
  'Optional note the admin wrote for this student''s report before sending, shown in the email and printed on the PDF.';
