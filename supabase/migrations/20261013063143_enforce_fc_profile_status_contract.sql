-- Keep database writes aligned with the shared FC workflow status contract.
-- The production preflight for this release confirmed that all existing rows
-- already use one of these values, so validation does not rewrite profile data.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.fc_profiles
  drop constraint if exists fc_profiles_status_check;

alter table public.fc_profiles
  add constraint fc_profiles_status_check
  check (
    status in (
      'draft',
      'temp-id-issued',
      'allowance-pending',
      'allowance-consented',
      'docs-requested',
      'docs-pending',
      'docs-submitted',
      'docs-rejected',
      'docs-approved',
      'hanwha-commission-review',
      'hanwha-commission-rejected',
      'hanwha-commission-approved',
      'appointment-completed',
      'final-link-sent'
    )
  ) not valid;

alter table public.fc_profiles
  validate constraint fc_profiles_status_check;
