-- Pending dues, fine and exam fund on the fee challan.
--
-- A voucher was only ever tuition, plus admission and security fees when those
-- were still unpaid. Real vouchers carry more: money still owed from previous
-- months, a fine, and an exam fund collected at certain points in the year.
-- Without somewhere to record them the office was writing them on the printed
-- slip by hand, which means the system's totals and the parent's slip disagree.
--
-- They live on the invoice rather than on the student, because each is a fact
-- about one month: a fine in September is not a fine in October, and a carried
-- balance changes every month. Putting them on the student would make them
-- permanent and quietly wrong from the following month onwards.

alter table invoices
  add column if not exists pending_dues numeric(10, 2) not null default 0
    check (pending_dues >= 0),
  add column if not exists fine numeric(10, 2) not null default 0
    check (fine >= 0),
  add column if not exists exam_fund numeric(10, 2) not null default 0
    check (exam_fund >= 0);

comment on column invoices.pending_dues is
  'Balance carried over from earlier months, entered by the office. Not derived from other invoices — the office decides what is genuinely still owed.';
comment on column invoices.fine is
  'A fine charged for this month only.';
comment on column invoices.exam_fund is
  'Exam fund charged for this month only.';
