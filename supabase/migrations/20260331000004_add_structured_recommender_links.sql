alter table public.fc_profiles
  add column if not exists recommender_fc_id uuid references public.fc_profiles (id) on delete set null;

create index if not exists idx_fc_profiles_recommender_fc_id
  on public.fc_profiles (recommender_fc_id);

with latest_confirmed as (
  select distinct on (ra.invitee_fc_id)
    ra.invitee_fc_id,
    ra.inviter_fc_id,
    nullif(trim(coalesce(ra.inviter_name, '')), '') as inviter_name
  from public.referral_attributions ra
  where ra.status = 'confirmed'
    and ra.invitee_fc_id is not null
    and ra.inviter_fc_id is not null
  order by ra.invitee_fc_id, coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc
)
update public.fc_profiles fp
set
  recommender_fc_id = lc.inviter_fc_id,
  recommender = coalesce(nullif(trim(fp.recommender), ''), lc.inviter_name)
from latest_confirmed lc
where fp.id = lc.invitee_fc_id
  and fp.recommender_fc_id is null;

with active_code_holders as (
  select
    fp.id as inviter_fc_id,
    nullif(trim(fp.name), '') as inviter_name
  from public.referral_codes rc
  join public.fc_profiles fp
    on fp.id = rc.fc_id
  where rc.is_active = true
    and nullif(trim(fp.name), '') is not null
),
unique_active_names as (
  select inviter_name, min(inviter_fc_id::text)::uuid as inviter_fc_id
  from active_code_holders
  group by inviter_name
  having count(*) = 1
)
update public.fc_profiles fp
set recommender_fc_id = uan.inviter_fc_id
from unique_active_names uan
where fp.recommender_fc_id is null
  and fp.id <> uan.inviter_fc_id
  and nullif(trim(fp.recommender), '') = uan.inviter_name;

create or replace function public.get_invitee_referral_code(p_fc_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with target_fc as (
    select fp.id, fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = p_fc_id
  ),
  linked_recommender_code as (
    select rc.code
    from target_fc tf
    join public.referral_codes rc
      on rc.fc_id = tf.recommender_fc_id
     and rc.is_active = true
    order by rc.created_at desc
    limit 1
  ),
  latest_confirmed_attribution as (
    select
      ra.referral_code,
      ra.referral_code_id,
      ra.inviter_fc_id
    from public.referral_attributions ra
    where ra.invitee_fc_id = p_fc_id
      and ra.status = 'confirmed'
    order by coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc
    limit 1
  )
  select coalesce(
    (
      select code
      from linked_recommender_code
    ),
    (
      select rc.code
      from latest_confirmed_attribution lca
      join public.referral_codes rc
        on rc.id = lca.referral_code_id
      limit 1
    ),
    (
      select rc.code
      from latest_confirmed_attribution lca
      join public.referral_codes rc
        on rc.fc_id = lca.inviter_fc_id
       and rc.is_active = true
      order by rc.created_at desc
      limit 1
    ),
    (
      select referral_code
      from latest_confirmed_attribution
      limit 1
    )
  );
$$;

revoke all on function public.get_invitee_referral_code(uuid) from public;
grant execute on function public.get_invitee_referral_code(uuid) to anon, authenticated, service_role;
