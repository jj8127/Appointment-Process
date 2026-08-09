-- Request Board mirrors may share a phone with an FC shadow profile while the
-- signed GaramIn viewer is an active administrator/developer or manager
-- account. Rebind only unambiguous legacy Request Board rows to that immutable
-- staff actor; ordinary FC rows and ambiguous staff collisions remain intact.
with staff_candidates as (
  select
    regexp_replace(account.phone, '[^0-9]', '', 'g') as phone_digits,
    account.id as actor_id
  from public.admin_accounts account
  where account.active = true

  union all

  select
    regexp_replace(account.phone, '[^0-9]', '', 'g') as phone_digits,
    account.id as actor_id
  from public.manager_accounts account
  where account.active = true
),
unique_staff as (
  select
    candidate.phone_digits,
    (array_agg(candidate.actor_id order by candidate.actor_id))[1] as actor_id
  from staff_candidates candidate
  where length(candidate.phone_digits) = 11
  group by candidate.phone_digits
  having count(distinct candidate.actor_id) = 1
)
update public.notifications notification
   set recipient_role = 'admin',
       recipient_actor_id = staff.actor_id
  from unique_staff staff
 where notification.category like 'request_board\_%' escape '\'
   and notification.recipient_role = 'fc'
   and regexp_replace(coalesce(notification.resident_id, ''), '[^0-9]', '', 'g') = staff.phone_digits
   and exists (
     select 1
       from public.fc_profiles profile
      where profile.id = notification.recipient_actor_id
        and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') = staff.phone_digits
   );

notify pgrst, 'reload schema';

