-- Add Hanwha commission workflow fields between docs approval and insurance commission.
-- Legacy rows already past this gate keep their existing later-stage status.

alter table public.fc_profiles
  add column if not exists hanwha_commission_date_sub date;

alter table public.fc_profiles
  add column if not exists hanwha_commission_date date;

alter table public.fc_profiles
  add column if not exists hanwha_commission_reject_reason text;

alter table public.fc_profiles
  add column if not exists hanwha_commission_pdf_path text;

alter table public.fc_profiles
  add column if not exists hanwha_commission_pdf_name text;

comment on column public.fc_profiles.status is
  'FC onboarding workflow: draft -> temp-id-issued -> allowance-pending -> allowance-consented -> docs-requested -> docs-pending -> docs-submitted -> docs-rejected -> docs-approved -> hanwha-commission-review -> hanwha-commission-rejected -> hanwha-commission-approved -> appointment-completed -> final-link-sent';

comment on column public.fc_profiles.hanwha_commission_date_sub is
  'Date the FC submitted Hanwha commission review materials.';

comment on column public.fc_profiles.hanwha_commission_date is
  'Date Hanwha commission review was approved.';

comment on column public.fc_profiles.hanwha_commission_reject_reason is
  'Latest rejection reason for Hanwha commission review.';

comment on column public.fc_profiles.hanwha_commission_pdf_path is
  'Storage path for the Hanwha commission PDF used to gate review/approval.';

comment on column public.fc_profiles.hanwha_commission_pdf_name is
  'Original file name for the Hanwha commission PDF used to gate review/approval.';

-- Backfill only when Hanwha-specific fields already provide explicit evidence.
update public.fc_profiles
set status = 'hanwha-commission-approved'
where hanwha_commission_date is not null
  and status in ('docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected');

update public.fc_profiles
set status = 'hanwha-commission-rejected'
where hanwha_commission_date is null
  and coalesce(trim(hanwha_commission_reject_reason), '') <> ''
  and status in ('docs-approved', 'hanwha-commission-review');

update public.fc_profiles
set status = 'hanwha-commission-review'
where hanwha_commission_date is null
  and coalesce(trim(hanwha_commission_reject_reason), '') = ''
  and (
    hanwha_commission_date_sub is not null
    or coalesce(trim(hanwha_commission_pdf_path), '') <> ''
    or coalesce(trim(hanwha_commission_pdf_name), '') <> ''
  )
  and status = 'docs-approved';
