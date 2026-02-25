-- Add commission completion flags for dual-track onboarding state.
alter table public.fc_profiles
  add column if not exists life_commission_completed boolean not null default false;

alter table public.fc_profiles
  add column if not exists nonlife_commission_completed boolean not null default false;

-- Backfill from already approved appointment dates.
update public.fc_profiles
set life_commission_completed = true
where appointment_date_life is not null
  and life_commission_completed = false;

update public.fc_profiles
set nonlife_commission_completed = true
where appointment_date_nonlife is not null
  and nonlife_commission_completed = false;

-- Normalize status by completion level so step grouping remains consistent.
update public.fc_profiles
set status = 'final-link-sent'
where life_commission_completed = true
  and nonlife_commission_completed = true
  and status <> 'final-link-sent';

update public.fc_profiles
set status = 'appointment-completed'
where (
       (life_commission_completed = true and nonlife_commission_completed = false)
    or (life_commission_completed = false and nonlife_commission_completed = true)
      )
  and status not in ('appointment-completed', 'final-link-sent');
