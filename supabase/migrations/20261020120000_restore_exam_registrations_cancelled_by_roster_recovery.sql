-- One-time data repair (2026-10-20).
-- On 2026-10-14 16:00~18:10 KST the FC roster delete/restore ran the account
-- deletion path, so detach_exam_registration_identity_for_account_deletion()
-- cancelled every applied/confirmed registration (actor_type = 'service').
-- The roster restore re-linked fc_id/resident_id but left status as
-- cancelled_by_fc, which hides the registrations from the FC history.
--
-- This restores status to the event's from_status for rows that still match
-- that exact cancellation and nothing else happened afterwards. The proof
-- objects were removed from storage by the deletion cleanup, so proof uploads
-- stay 'discarded'; restored rows use payment_proof_policy_version = 0 with
-- payment_proof_attached = false. An FC edit still requires a new proof
-- (payment_proof_required) and switches the row back to policy version 1.
--
-- The restore event uses action 'updated', actor_type 'service',
-- from_status 'cancelled_by_fc'. FC edits never start from a cancelled status,
-- so this combination identifies the repair without a new action value.
-- Re-running is a no-op: restored rows are no longer cancelled_by_fc.

with params as (
  select
    timestamptz '2026-10-14 16:00:00+09' as window_start,
    timestamptz '2026-10-14 18:10:00+09' as window_end,
    -- Scope decision: true restores every eligible round; false keeps rounds
    -- whose exam_date (or, without a date, exam_month) is before
    -- restore_from_exam_date cancelled.
    true as include_past_rounds,
    date '2026-10-20' as restore_from_exam_date
), cancellation as (
  select distinct on (event.registration_id)
    event.registration_id,
    event.from_status,
    event.created_at
  from public.exam_registration_decision_events event
  cross join params
  where event.actor_type = 'service'
    and event.action = 'cancelled_by_fc'
    and event.created_at >= params.window_start
    and event.created_at < params.window_end
  order by event.registration_id, event.created_at desc
), eligible as (
  select
    registration.id,
    registration.fc_id,
    registration.exam_month,
    registration.exam_type,
    cancellation.from_status
  from public.exam_registrations registration
  join cancellation on cancellation.registration_id = registration.id
  join public.exam_rounds round on round.id = registration.round_id
  cross join params
  where registration.status = 'cancelled_by_fc'
    and cancellation.from_status in ('applied', 'confirmed')
    and registration.resident_id not like 'deleted-exam:%'
    and exists (
      select 1 from public.fc_profiles profile where profile.id = registration.fc_id
    )
    and not exists (
      select 1
      from public.exam_registration_decision_events later
      where later.registration_id = registration.id
        and later.created_at > cancellation.created_at
        and later.action <> 'identity_detached'
    )
    and not exists (
      select 1
      from public.exam_registrations active
      where active.fc_id = registration.fc_id
        and active.exam_month = registration.exam_month
        and active.exam_type = registration.exam_type
        and active.id <> registration.id
        and active.status in ('applied', 'confirmed', 'completed', 'no_show')
    )
    and (
      params.include_past_rounds
      or round.exam_date >= params.restore_from_exam_date
      or (
        round.exam_date is null
        and registration.exam_month >= date_trunc('month', params.restore_from_exam_date)::date
      )
    )
), target as (
  -- Two candidates for one FC monthly slot would collide on
  -- idx_exam_registrations_active_fc_exam_month_type; leave both untouched.
  select id, fc_id, from_status
  from (
    select eligible.*,
      count(*) over (partition by fc_id, exam_month, exam_type) as slot_candidates
    from eligible
  ) ranked
  where slot_candidates = 1
), restored as (
  update public.exam_registrations registration
     set status = target.from_status,
         is_confirmed = target.from_status = 'confirmed',
         payment_proof_attached = false,
         payment_proof_policy_version = 0
    from target
   where registration.id = target.id
     and registration.status = 'cancelled_by_fc'
  returning registration.id, registration.fc_id, target.from_status
)
insert into public.exam_registration_decision_events (
  registration_id,
  action,
  from_status,
  to_status,
  reason,
  actor_type,
  target_fc_id_snapshot
)
select
  restored.id,
  'updated',
  'cancelled_by_fc',
  restored.from_status,
  null,
  'service',
  restored.fc_id
from restored;
