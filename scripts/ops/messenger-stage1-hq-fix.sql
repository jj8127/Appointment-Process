-- Messenger stage 1 fix: managers whose affiliation is only on the referral shadow profile.
-- Run once in Dashboard -> SQL Editor on ubeginyxaotcamuqpmud. Re-running is safe.

begin;

-- Messenger stage 1 fix: managers whose affiliation lives only on their
-- referral shadow profile (7 of 9 active managers on 2026-10-16) were left out
-- of their headquarters. A profile now counts for a manager when an active
-- manager account has its phone, shadow or not; plain FCs keep the regular
-- signup rule. The "headquarters unknown" check uses the same rule.

create or replace function public.messenger_sync_headquarters_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_approved integer;
  v_revoked integer;
  v_unknown integer;
begin
  if v_garam is null then
    return jsonb_build_object('skipped', 'garam_missing');
  end if;

  -- One row per (person, headquarters).
  create temp table if not exists messenger_hq_desired (
    actor_id uuid not null, hq integer not null, role text not null
  ) on commit drop;
  truncate messenger_hq_desired;
  insert into messenger_hq_desired (actor_id, hq, role)
  select distinct coalesce(public.messenger_actor_for('manager', ma.id::text), public.messenger_actor_for('fc', f.id::text)),
         n, case when ma.id is not null then 'manager' else 'fc' end
    from public.fc_profiles f
    left join public.manager_accounts ma on ma.phone = f.phone and ma.active
    cross join lateral unnest(public.messenger_headquarters_numbers(f.affiliation)) as n
   where f.account_closed_at is null
     and (ma.id is not null
          or (coalesce(f.signup_completed, false) and not coalesce(f.is_manager_referral_shadow, false)))
     and coalesce(public.messenger_actor_for('manager', ma.id::text), public.messenger_actor_for('fc', f.id::text)) is not null;

  insert into public.messenger_orgs (kind, parent_id, slug, name)
  select distinct 'garam', v_garam, 'garam-hq-' || hq, hq || '본부' from messenger_hq_desired
  on conflict (slug) do nothing;

  with up as (
    insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
    select o.id, d.actor_id, d.role, 'approved', now()
      from messenger_hq_desired d join public.messenger_orgs o on o.slug = 'garam-hq-' || d.hq
    on conflict (org_id, actor_id, role) do update
       set status = 'approved', approved_at = now(), revoked_at = null, updated_at = now()
     where public.messenger_org_members.status <> 'approved'
    returning 1
  )
  select count(*) into v_approved from up;

  with gone as (
    update public.messenger_org_members m
       set status = 'revoked', revoked_at = now(), updated_at = now()
      from public.messenger_orgs o
     where o.id = m.org_id and o.parent_id = v_garam and o.slug like 'garam-hq-%'
       and m.status = 'approved'
       and not exists (select 1 from messenger_hq_desired d
                        where d.actor_id = m.actor_id and d.role = m.role and o.slug = 'garam-hq-' || d.hq)
    returning 1
  )
  select count(*) into v_revoked from gone;

  -- Active managers that received no headquarters stay in 가람 only.
  select count(*) into v_unknown
    from public.manager_accounts ma
   where ma.active
     and not exists (select 1 from messenger_hq_desired d
                      where d.role = 'manager' and d.actor_id = public.messenger_actor_for('manager', ma.id::text));
  perform public.messenger_record_issue_once('manager_accounts', ma.id::text, 'headquarters_unknown')
     from public.manager_accounts ma
    where ma.active
      and not exists (select 1 from messenger_hq_desired d
                       where d.role = 'manager' and d.actor_id = public.messenger_actor_for('manager', ma.id::text));

  return jsonb_build_object('approved', v_approved, 'revoked', v_revoked, 'managersWithoutHeadquarters', v_unknown);
end;
$$;

revoke all on function public.messenger_sync_headquarters_v1() from public, anon, authenticated;
grant execute on function public.messenger_sync_headquarters_v1() to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261016120000', 'messenger_headquarters_manager_shadow')
on conflict (version) do nothing;

commit;

-- Apply it now instead of waiting for 03:30; expected: approved 7 or more, managersWithoutHeadquarters 0.
select public.messenger_sync_headquarters_v1();
