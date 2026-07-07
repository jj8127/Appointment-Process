create or replace function public.get_referral_subtree(
  root_fc_id uuid,
  max_depth int default 2
)
returns table (
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
  edge_candidates as (
    select
      child.recommender_fc_id as parent_fc_id,
      child.id as child_fc_id,
      'structured'::text as source_kind
    from public.fc_profiles child
    join public.fc_profiles parent
      on parent.id = child.recommender_fc_id
    where child.recommender_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and child.id <> child.recommender_fc_id

    union all

    select
      ra.inviter_fc_id as parent_fc_id,
      ra.invitee_fc_id as child_fc_id,
      'confirmed'::text as source_kind
    from public.referral_attributions ra
    join public.fc_profiles child
      on child.id = ra.invitee_fc_id
    join public.fc_profiles parent
      on parent.id = ra.inviter_fc_id
    where ra.status = 'confirmed'
      and ra.inviter_fc_id is not null
      and ra.invitee_fc_id is not null
      and child.is_manager_referral_shadow is not true
      and (parent.is_manager_referral_shadow is not true or parent.id = root_fc_id)
      and ra.inviter_fc_id <> ra.invitee_fc_id
  ),
  edge_sources as (
    select
      ec.parent_fc_id,
      ec.child_fc_id,
      case
        when bool_or(ec.source_kind = 'structured') and bool_or(ec.source_kind = 'confirmed') then 'both'
        when bool_or(ec.source_kind = 'structured') then 'structured'
        else 'confirmed'
      end as relationship_source
    from edge_candidates ec
    where ec.parent_fc_id is not null
      and ec.child_fc_id is not null
    group by ec.parent_fc_id, ec.child_fc_id
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
      c.ancestor_fc_id,
      es.child_fc_id as descendant_fc_id,
      c.path || es.child_fc_id
    from closure c
    join edge_sources es
      on es.parent_fc_id = c.descendant_fc_id
    join subtree_nodes child_node
      on child_node.fc_id = es.child_fc_id
    where es.child_fc_id <> all(c.path)
  ),
  total_counts as (
    select
      c.ancestor_fc_id as fc_id,
      count(distinct c.descendant_fc_id)::int as total_descendant_count
    from closure c
    group by c.ancestor_fc_id
  ),
  returned_descendants as (
    select
      rn.fc_id,
      fp.name,
      fp.affiliation,
      ac.code as active_code,
      rn.parent_fc_id,
      rn.node_depth,
      coalesce(dc.direct_invitee_count, 0) as direct_invitee_count,
      coalesce(tc.total_descendant_count, 0) as total_descendant_count,
      es.relationship_source
    from reachable_nodes rn
    join params p
      on true
    join public.fc_profiles fp
      on fp.id = rn.fc_id
    left join active_codes ac
      on ac.fc_id = rn.fc_id
    left join direct_counts dc
      on dc.fc_id = rn.fc_id
    left join total_counts tc
      on tc.fc_id = rn.fc_id
    left join edge_sources es
      on es.parent_fc_id = rn.parent_fc_id
     and es.child_fc_id = rn.fc_id
    where rn.node_depth <= p.safe_depth
  )
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

  union all

  select
    aw.fc_id,
    aw.name,
    aw.affiliation,
    ac.code as active_code,
    aw.next_parent_fc_id as parent_fc_id,
    aw.node_depth,
    'structured'::text as relationship_source,
    0 as direct_invitee_count,
    0 as total_descendant_count,
    true as is_ancestor
  from ancestor_walk aw
  left join active_codes ac
    on ac.fc_id = aw.fc_id

  union all

  select
    rd.fc_id,
    rd.name,
    rd.affiliation,
    rd.active_code,
    rd.parent_fc_id,
    rd.node_depth,
    rd.relationship_source,
    rd.direct_invitee_count,
    rd.total_descendant_count,
    false as is_ancestor
  from returned_descendants rd

  order by node_depth asc, name asc nulls last, fc_id asc;
$$;

revoke all on function public.get_referral_subtree(uuid, int) from public, anon, authenticated;
grant execute on function public.get_referral_subtree(uuid, int) to service_role;

comment on function public.get_referral_subtree(uuid, int)
  is 'Trusted referral tree reader for mobile self-service drill-down. Execute grant is service_role only.';
