alter table public.fc_profiles
  add column if not exists recommender_code_id uuid references public.referral_codes (id) on delete set null,
  add column if not exists recommender_code text,
  add column if not exists recommender_linked_at timestamptz,
  add column if not exists recommender_link_source text;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_recommender_link_source_check;

alter table public.fc_profiles
  add constraint fc_profiles_recommender_link_source_check
  check (
    recommender_link_source is null
    or recommender_link_source in ('signup', 'self_service', 'admin_override', 'legacy_migration')
  );

create index if not exists idx_fc_profiles_recommender_code_id
  on public.fc_profiles (recommender_code_id);

alter table public.referral_events
  drop constraint if exists referral_events_event_type_check;

alter table public.referral_events
  add constraint referral_events_event_type_check
  check (
    event_type in (
      'link_clicked',
      'link_landing_opened',
      'app_opened_from_link',
      'code_auto_prefilled',
      'code_edited_before_signup',
      'pending_attribution_saved',
      'code_entered',
      'code_validated',
      'signup_completed',
      'referral_confirmed',
      'referral_rejected',
      'code_generated',
      'code_rotated',
      'code_disabled',
      'admin_override_applied',
      'referral_linked',
      'referral_changed',
      'referral_cleared'
    )
  );

alter table public.referral_events
  drop constraint if exists referral_events_source_check;

alter table public.referral_events
  add constraint referral_events_source_check
  check (
    source is null
    or source in (
      'auto_prefill',
      'manual_entry',
      'admin_override',
      'signup',
      'self_service',
      'legacy_migration'
    )
  );

create or replace function public.get_invitee_referral_code(p_fc_id uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when fp.recommender_fc_id is null then null
    else nullif(trim(coalesce(fp.recommender_code, '')), '')
  end
  from public.fc_profiles fp
  where fp.id = p_fc_id
  limit 1;
$$;

comment on function public.get_invitee_referral_code(uuid)
  is 'Trusted helper for admin-action to read the invitee-facing referral code from canonical fc_profiles snapshot state. Execute grant is service_role only.';

create or replace function public.get_referral_subtree(
  root_fc_id uuid,
  max_depth int default 2
) returns table (
  fc_id uuid,
  name text,
  affiliation text,
  active_code text,
  parent_fc_id uuid,
  node_depth int,
  relationship_source text,
  direct_invitee_count int,
  total_descendant_count int,
  is_ancestor boolean
)
language sql
security definer
set search_path = public
as $$
  with recursive
  params as (
    select greatest(1, least(coalesce(max_depth, 2), 5)) as safe_depth
  ),
  root_profile as (
    select
      fp.id,
      fp.name,
      fp.affiliation,
      fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = root_fc_id
    limit 1
  ),
  active_codes as (
    select distinct on (rc.fc_id)
      rc.fc_id,
      rc.code
    from public.referral_codes rc
    where rc.is_active = true
    order by rc.fc_id, rc.created_at desc, rc.id desc
  ),
  ancestor_walk as (
    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      -1 as node_depth,
      array[root_fc_id, parent.id]::uuid[] as path
    from root_profile root
    join public.fc_profiles parent
      on parent.id = root.recommender_fc_id
    union all
    select
      parent.id as fc_id,
      parent.name,
      parent.affiliation,
      parent.recommender_fc_id as next_parent_fc_id,
      aw.node_depth - 1 as node_depth,
      aw.path || parent.id
    from ancestor_walk aw
    join public.fc_profiles parent
      on parent.id = aw.next_parent_fc_id
    where aw.node_depth > -10
      and parent.id <> all(aw.path)
  ),
  edge_sources as (
    select
      child.recommender_fc_id as parent_fc_id,
      child.id as child_fc_id,
      'linked'::text as relationship_source
    from public.fc_profiles child
    join public.fc_profiles parent
      on parent.id = child.recommender_fc_id
    where child.recommender_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and child.id <> child.recommender_fc_id
  ),
  reachable_all as (
    select
      es.parent_fc_id,
      es.child_fc_id,
      1 as node_depth,
      array[root_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    where es.parent_fc_id = root_fc_id
    union all
    select
      es.parent_fc_id,
      es.child_fc_id,
      ra.node_depth + 1 as node_depth,
      ra.path || es.child_fc_id
    from reachable_all ra
    join edge_sources es
      on es.parent_fc_id = ra.child_fc_id
    where ra.node_depth < 20
      and es.child_fc_id <> all(ra.path)
  ),
  reachable_nodes as (
    select distinct on (ra.child_fc_id)
      ra.child_fc_id as fc_id,
      ra.parent_fc_id,
      ra.node_depth
    from reachable_all ra
    order by ra.child_fc_id, ra.node_depth asc, ra.parent_fc_id
  ),
  subtree_nodes as (
    select root_fc_id as fc_id
    union
    select rn.fc_id
    from reachable_nodes rn
  ),
  direct_counts as (
    select
      es.parent_fc_id as fc_id,
      count(distinct es.child_fc_id)::int as direct_invitee_count
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    group by es.parent_fc_id
  ),
  closure as (
    select
      es.parent_fc_id as ancestor_fc_id,
      es.child_fc_id as descendant_fc_id,
      array[es.parent_fc_id, es.child_fc_id]::uuid[] as path
    from edge_sources es
    join subtree_nodes parent_node
      on parent_node.fc_id = es.parent_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    union all
    select
      cl.ancestor_fc_id,
      es.child_fc_id,
      cl.path || es.child_fc_id
    from closure cl
    join edge_sources es
      on es.parent_fc_id = cl.descendant_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    where es.child_fc_id <> all(cl.path)
      and cardinality(cl.path) < 32
  ),
  total_counts as (
    select
      cl.ancestor_fc_id as fc_id,
      count(distinct cl.descendant_fc_id)::int as total_descendant_count
    from closure cl
    group by cl.ancestor_fc_id
  ),
  descendant_rows as (
    select
      child.id as fc_id,
      child.name,
      child.affiliation,
      ac.code as active_code,
      rn.parent_fc_id,
      rn.node_depth,
      'linked'::text as relationship_source,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      false as is_ancestor
    from reachable_nodes rn
    join params p
      on rn.node_depth <= p.safe_depth
    join public.fc_profiles child
      on child.id = rn.fc_id
    left join active_codes ac
      on ac.fc_id = child.id
    left join direct_counts dc
      on dc.fc_id = child.id
    left join total_counts tc
      on tc.fc_id = child.id
  ),
  ancestor_rows as (
    select
      aw.fc_id,
      aw.name,
      aw.affiliation,
      ac.code as active_code,
      null::uuid as parent_fc_id,
      aw.node_depth,
      'linked'::text as relationship_source,
      0::int as direct_invitee_count,
      0::int as total_descendant_count,
      true as is_ancestor
    from ancestor_walk aw
    left join active_codes ac
      on ac.fc_id = aw.fc_id
  ),
  root_row as (
    select
      root.id as fc_id,
      root.name,
      root.affiliation,
      ac.code as active_code,
      null::uuid as parent_fc_id,
      0 as node_depth,
      'root'::text as relationship_source,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      false as is_ancestor
    from root_profile root
    left join active_codes ac
      on ac.fc_id = root.id
    left join direct_counts dc
      on dc.fc_id = root.id
    left join total_counts tc
      on tc.fc_id = root.id
  )
  select * from root_row
  union all
  select * from ancestor_rows
  union all
  select * from descendant_rows;
$$;

create or replace function public.apply_referral_link_state(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_referral_code_id uuid default null,
  p_referral_code text default null,
  p_source text default 'self_service',
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitee_fc public.fc_profiles%rowtype;
  inviter_fc public.fc_profiles%rowtype;
  selected_code public.referral_codes%rowtype;
  normalized_source text := nullif(trim(coalesce(p_source, '')), '');
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_invitee_phone text;
  normalized_inviter_phone text := null;
  next_recommender_name text := null;
  next_code_id uuid := null;
  next_code text := null;
  next_linked_at timestamptz := null;
  next_link_source text := null;
  event_type text := null;
  changed boolean := false;
  now_ts timestamptz := now();
begin
  if normalized_source is null or normalized_source not in ('signup', 'self_service', 'admin_override', 'legacy_migration') then
    raise exception '추천인 변경 source가 올바르지 않습니다.';
  end if;

  if p_invitee_fc_id is null then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  if normalized_source = 'admin_override' and reason is null then
    raise exception '추천인 변경 사유를 입력해주세요.';
  end if;

  if p_inviter_fc_id is not null and p_inviter_fc_id = p_invitee_fc_id then
    raise exception '자기 자신을 추천인으로 지정할 수 없습니다.';
  end if;

  select *
    into invitee_fc
  from public.fc_profiles
  where id = p_invitee_fc_id
  for update;

  if not found then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  normalized_invitee_phone := regexp_replace(coalesce(invitee_fc.phone, ''), '[^0-9]', '', 'g');
  if normalized_invitee_phone !~ '^[0-9]{11}$' then
    raise exception '추천 관계 대상 FC 전화번호가 올바르지 않습니다.';
  end if;

  if p_inviter_fc_id is not null then
    select *
      into inviter_fc
    from public.fc_profiles
    where id = p_inviter_fc_id
    for update;

    if not found then
      raise exception '추천인 후보 FC를 찾을 수 없습니다.';
    end if;

    normalized_inviter_phone := regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g');
    if normalized_inviter_phone !~ '^[0-9]{11}$' then
      raise exception '추천인 후보 FC 전화번호가 올바르지 않습니다.';
    end if;

    if public.is_request_board_designer_affiliation(inviter_fc.affiliation) then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    if inviter_fc.signup_completed is not true and inviter_fc.is_manager_referral_shadow is not true then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    if exists (
      select 1
      from public.admin_accounts admin_row
      where admin_row.phone = normalized_inviter_phone
    ) then
      raise exception '추천인으로 지정할 수 없는 FC입니다.';
    end if;

    next_recommender_name := nullif(trim(coalesce(inviter_fc.name, '')), '');

    if p_referral_code_id is not null then
      select *
        into selected_code
      from public.referral_codes
      where id = p_referral_code_id
        and fc_id = p_inviter_fc_id
        and is_active = true
      limit 1
      for update;
    elsif nullif(trim(coalesce(p_referral_code, '')), '') is not null then
      select *
        into selected_code
      from public.referral_codes
      where fc_id = p_inviter_fc_id
        and code = upper(trim(p_referral_code))
        and is_active = true
      order by created_at desc, id desc
      limit 1
      for update;
    else
      select *
        into selected_code
      from public.referral_codes
      where fc_id = p_inviter_fc_id
        and is_active = true
      order by created_at desc, id desc
      limit 1
      for update;
    end if;

    if not found then
      raise exception '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.';
    end if;

    next_code_id := selected_code.id;
    next_code := selected_code.code;
    next_linked_at := now_ts;
    next_link_source := normalized_source;

    if invitee_fc.recommender_fc_id is not distinct from p_inviter_fc_id
      and invitee_fc.recommender_code_id is not distinct from next_code_id
      and nullif(trim(coalesce(invitee_fc.recommender_code, '')), '') is not distinct from next_code then
      next_linked_at := coalesce(invitee_fc.recommender_linked_at, now_ts);
      next_link_source := coalesce(invitee_fc.recommender_link_source, normalized_source);
    end if;
  end if;

  changed :=
    invitee_fc.recommender_fc_id is distinct from p_inviter_fc_id
    or nullif(trim(coalesce(invitee_fc.recommender, '')), '') is distinct from next_recommender_name
    or invitee_fc.recommender_code_id is distinct from next_code_id
    or nullif(trim(coalesce(invitee_fc.recommender_code, '')), '') is distinct from next_code
    or invitee_fc.recommender_link_source is distinct from next_link_source
    or invitee_fc.recommender_linked_at is distinct from next_linked_at;

  if not changed then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'inviteeFcId', invitee_fc.id,
      'inviterFcId', invitee_fc.recommender_fc_id,
      'recommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
      'referralCodeId', invitee_fc.recommender_code_id,
      'referralCode', nullif(trim(coalesce(invitee_fc.recommender_code, '')), ''),
      'recommenderLinkSource', invitee_fc.recommender_link_source,
      'recommenderLinkedAt', invitee_fc.recommender_linked_at,
      'eventType', null
    );
  end if;

  if p_inviter_fc_id is null then
    event_type := 'referral_cleared';
  elsif invitee_fc.recommender_fc_id is null then
    event_type := 'referral_linked';
  else
    event_type := 'referral_changed';
  end if;

  update public.fc_profiles
  set recommender_fc_id = p_inviter_fc_id,
      recommender = next_recommender_name,
      recommender_code_id = next_code_id,
      recommender_code = next_code,
      recommender_linked_at = next_linked_at,
      recommender_link_source = next_link_source
  where id = p_invitee_fc_id;

  insert into public.referral_events (
    attribution_id,
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    invitee_fc_id,
    invitee_phone,
    event_type,
    source,
    metadata
  )
  values (
    null,
    next_code_id,
    next_code,
    p_inviter_fc_id,
    normalized_inviter_phone,
    next_recommender_name,
    invitee_fc.id,
    normalized_invitee_phone,
    event_type,
    normalized_source,
    jsonb_strip_nulls(
      jsonb_build_object(
        'source', normalized_source,
        'reason', reason,
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'beforeRecommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
        'beforeRecommenderFcId', invitee_fc.recommender_fc_id,
        'beforeCodeId', invitee_fc.recommender_code_id,
        'beforeCode', nullif(trim(coalesce(invitee_fc.recommender_code, '')), ''),
        'beforeLinkedAt', invitee_fc.recommender_linked_at,
        'beforeLinkSource', invitee_fc.recommender_link_source,
        'afterRecommenderName', next_recommender_name,
        'afterRecommenderFcId', p_inviter_fc_id,
        'afterCodeId', next_code_id,
        'afterCode', next_code,
        'afterLinkedAt', next_linked_at,
        'afterLinkSource', next_link_source,
        'cleared', p_inviter_fc_id is null
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'inviteeFcId', invitee_fc.id,
    'inviterFcId', p_inviter_fc_id,
    'recommenderName', next_recommender_name,
    'referralCodeId', next_code_id,
    'referralCode', next_code,
    'recommenderLinkSource', next_link_source,
    'recommenderLinkedAt', next_linked_at,
    'eventType', event_type
  );
end;
$$;

create or replace function public.admin_apply_recommender_override(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_referral_link_state(
    p_invitee_fc_id => p_invitee_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => null,
    p_referral_code => null,
    p_source => 'admin_override',
    p_actor_phone => p_actor_phone,
    p_actor_role => p_actor_role,
    p_actor_staff_type => p_actor_staff_type,
    p_reason => p_reason
  );
$$;

with active_codes as (
  select distinct on (rc.fc_id)
    rc.fc_id,
    rc.id as referral_code_id,
    rc.code as referral_code
  from public.referral_codes rc
  where rc.is_active = true
  order by rc.fc_id, rc.created_at desc, rc.id desc
),
latest_confirmed as (
  select distinct on (ra.invitee_fc_id)
    ra.invitee_fc_id,
    ra.inviter_fc_id,
    nullif(trim(coalesce(ra.inviter_name, '')), '') as inviter_name,
    ra.referral_code_id,
    nullif(trim(coalesce(ra.referral_code, '')), '') as referral_code,
    case
      when ra.source = 'admin_override' then 'admin_override'
      else 'signup'
    end as link_source,
    coalesce(ra.confirmed_at, ra.created_at) as linked_at
  from public.referral_attributions ra
  where ra.status = 'confirmed'
    and ra.invitee_fc_id is not null
    and ra.inviter_fc_id is not null
  order by ra.invitee_fc_id, coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc, ra.id desc
),
eligible_profiles as (
  select
    fp.id,
    fp.name,
    fp.created_at,
    nullif(regexp_replace(trim(coalesce(fp.name, '')), '\s+', ' ', 'g'), '') as normalized_name
  from public.fc_profiles fp
  where (fp.signup_completed = true or fp.is_manager_referral_shadow = true)
    and regexp_replace(coalesce(fp.phone, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
    and public.is_request_board_designer_affiliation(fp.affiliation) is not true
),
legacy_candidates as (
  select
    invitee.id as invitee_fc_id,
    inviter.id as inviter_fc_id,
    nullif(trim(coalesce(inviter.name, '')), '') as inviter_name,
    active_codes.referral_code_id,
    active_codes.referral_code,
    count(*) over (partition by invitee.id) as candidate_count,
    row_number() over (partition by invitee.id order by inviter.created_at desc, inviter.id) as candidate_rank
  from public.fc_profiles invitee
  join eligible_profiles inviter
    on inviter.normalized_name = nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '')
   and inviter.id <> invitee.id
  join active_codes
    on active_codes.fc_id = inviter.id
  where invitee.recommender_fc_id is null
    and nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '') is not null
    and nullif(regexp_replace(trim(coalesce(invitee.recommender, '')), '\s+', ' ', 'g'), '') is distinct from nullif(regexp_replace(trim(coalesce(invitee.name, '')), '\s+', ' ', 'g'), '')
),
unique_legacy_matches as (
  select
    invitee_fc_id,
    inviter_fc_id,
    inviter_name,
    referral_code_id,
    referral_code
  from legacy_candidates
  where candidate_count = 1
    and candidate_rank = 1
),
resolved_state as (
  select
    fp.id as invitee_fc_id,
    coalesce(lc.inviter_fc_id, fp.recommender_fc_id, ulm.inviter_fc_id) as next_recommender_fc_id,
    case
      when lc.inviter_fc_id is not null then coalesce(lc.inviter_name, current_inviter.name)
      when fp.recommender_fc_id is not null then nullif(trim(coalesce(current_inviter.name, fp.recommender)), '')
      when ulm.inviter_fc_id is not null then ulm.inviter_name
      else null
    end as next_recommender_name,
    coalesce(lc.referral_code_id, current_code.referral_code_id, ulm.referral_code_id) as next_recommender_code_id,
    coalesce(lc.referral_code, current_code.referral_code, ulm.referral_code) as next_recommender_code,
    case
      when lc.inviter_fc_id is not null then lc.linked_at
      when fp.recommender_fc_id is not null then coalesce(fp.recommender_linked_at, fp.updated_at, fp.created_at, now())
      when ulm.inviter_fc_id is not null then coalesce(fp.recommender_linked_at, fp.updated_at, fp.created_at, now())
      else null
    end as next_recommender_linked_at,
    case
      when lc.inviter_fc_id is not null then lc.link_source
      when fp.recommender_fc_id is not null then coalesce(fp.recommender_link_source, 'legacy_migration')
      when ulm.inviter_fc_id is not null then 'legacy_migration'
      else null
    end as next_recommender_link_source
  from public.fc_profiles fp
  left join latest_confirmed lc
    on lc.invitee_fc_id = fp.id
  left join public.fc_profiles current_inviter
    on current_inviter.id = fp.recommender_fc_id
  left join active_codes current_code
    on current_code.fc_id = fp.recommender_fc_id
  left join unique_legacy_matches ulm
    on ulm.invitee_fc_id = fp.id
)
update public.fc_profiles fp
set recommender_fc_id = resolved_state.next_recommender_fc_id,
    recommender = case
      when resolved_state.next_recommender_fc_id is null then null
      else resolved_state.next_recommender_name
    end,
    recommender_code_id = resolved_state.next_recommender_code_id,
    recommender_code = resolved_state.next_recommender_code,
    recommender_linked_at = resolved_state.next_recommender_linked_at,
    recommender_link_source = resolved_state.next_recommender_link_source
from resolved_state
where fp.id = resolved_state.invitee_fc_id;

revoke all on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_referral_link_state(uuid, uuid, uuid, text, text, text, text, text, text) to service_role;
