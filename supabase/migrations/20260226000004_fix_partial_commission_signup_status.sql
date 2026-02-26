-- Keep partial-commission signup users in early workflow until onboarding progresses.
-- Scope: rows that were previously normalized to appointment-completed only because one track was pre-completed at signup.

-- If both tracks are completed by either legacy flags or confirmed appointment dates, keep final status.
update public.fc_profiles
set status = 'final-link-sent'
where (coalesce(life_commission_completed, false) = true or appointment_date_life is not null)
  and (coalesce(nonlife_commission_completed, false) = true or appointment_date_nonlife is not null)
  and status <> 'final-link-sent';

-- Partial completion should start from draft when there is no onboarding progress yet.
update public.fc_profiles as p
set status = 'draft'
where p.status = 'appointment-completed'
  and (
    (coalesce(p.life_commission_completed, false) = true and coalesce(p.nonlife_commission_completed, false) = false)
    or (coalesce(p.life_commission_completed, false) = false and coalesce(p.nonlife_commission_completed, false) = true)
  )
  and p.appointment_date_life is null
  and p.appointment_date_nonlife is null
  and p.allowance_date is null
  and p.docs_deadline_at is null
  and coalesce(trim(p.appointment_schedule_life), '') = ''
  and coalesce(trim(p.appointment_schedule_nonlife), '') = ''
  and not exists (
    select 1
    from public.fc_documents d
    where d.fc_id = p.id
  );
