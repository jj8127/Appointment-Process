-- Local preparation only. Apply and verify this migration before deploying its callers.
-- All authority parameters come from an Edge/server verified signed session.
create table if not exists public.fc_document_cleanup_queue (
  storage_path text primary key,
  fc_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.fc_document_cleanup_queue enable row level security;
revoke all on public.fc_document_cleanup_queue from public, anon, authenticated;
grant all on public.fc_document_cleanup_queue to service_role;

create or replace function public.assert_ux_mutation_actor_v1(p_phone text, p_role text, p_fc_id uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_role = 'admin' and exists(select 1 from public.admin_accounts where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and active=true) then return; end if;
  if p_role = 'fc' and p_fc_id is not null and exists(
    select 1 from public.fc_profiles where id=p_fc_id and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and signup_completed=true
      and coalesce(is_manager_referral_shadow,false)=false
  ) then return; end if;
  raise exception 'actor not authorized' using errcode='42501';
end; $$;
revoke all on function public.assert_ux_mutation_actor_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_ux_mutation_actor_v1(text,text,uuid) to service_role;

create or replace function public.update_fc_document_requests_atomic_v1(
  p_actor_phone text,p_actor_role text,p_fc_id uuid,p_types text[],p_deadline date
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_deadline date;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  if p_types is null or cardinality(p_types)>100 or exists(select 1 from unnest(p_types) t where t is null or btrim(t)='' or length(t)>150)
    then raise exception 'invalid document types' using errcode='22023'; end if;
  select docs_deadline_at into v_deadline from public.fc_profiles where id=p_fc_id for update;
  if not found then raise exception 'profile not found' using errcode='P0002'; end if;
  perform 1 from public.fc_documents where fc_id=p_fc_id for update;
  if cardinality(p_types)=0 then
    insert into public.fc_document_cleanup_queue(storage_path,fc_id)
      select storage_path,p_fc_id from public.fc_documents where fc_id=p_fc_id and coalesce(storage_path,'') not in ('','deleted')
      on conflict(storage_path) do nothing;
    delete from public.fc_documents where fc_id=p_fc_id;
    update public.fc_profiles set status='allowance-consented',docs_deadline_at=null,docs_deadline_last_notified_at=null where id=p_fc_id;
  else
    delete from public.fc_documents where fc_id=p_fc_id and not(doc_type=any(p_types)) and coalesce(storage_path,'') in ('','deleted');
    insert into public.fc_documents(fc_id,doc_type,status,file_name,storage_path)
      select p_fc_id,t,'pending','','' from (select distinct btrim(t) t from unnest(p_types) t) requested
      where not exists(select 1 from public.fc_documents d where d.fc_id=p_fc_id and d.doc_type=requested.t);
    update public.fc_profiles set status='docs-requested',docs_deadline_at=p_deadline,
      docs_deadline_last_notified_at=case when v_deadline is distinct from p_deadline then null else docs_deadline_last_notified_at end
      where id=p_fc_id;
  end if;
  return jsonb_build_object('updated',true,'cleanupPending',exists(select 1 from public.fc_document_cleanup_queue where fc_id=p_fc_id));
end; $$;
revoke all on function public.update_fc_document_requests_atomic_v1(text,text,uuid,text[],date) from public,anon,authenticated;
grant execute on function public.update_fc_document_requests_atomic_v1(text,text,uuid,text[],date) to service_role;

create or replace function public.remove_fc_document_atomic_v1(
  p_actor_phone text,p_actor_role text,p_fc_id uuid,p_doc_type text,p_expected_storage_path text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_path text; v_status text;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role,p_fc_id);
  perform 1 from public.fc_profiles where id=p_fc_id for update;
  if not found then raise exception 'profile not found' using errcode='P0002'; end if;
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role,p_fc_id);
  select storage_path,status into v_path,v_status from public.fc_documents where fc_id=p_fc_id and doc_type=p_doc_type for update;
  if not found then raise exception 'document not found' using errcode='P0002'; end if;
  if v_status='approved' then raise exception 'approved document protected' using errcode='42501'; end if;
  if coalesce(v_path,'') not in ('','deleted') then
    if p_expected_storage_path is not null and v_path<>p_expected_storage_path then raise exception 'document changed; reload required' using errcode='40001'; end if;
    insert into public.fc_document_cleanup_queue(storage_path,fc_id) values(v_path,p_fc_id) on conflict(storage_path) do nothing;
    insert into public.fc_document_cleanup_queue(storage_path,fc_id)
      select hanwha_commission_pdf_path,p_fc_id from public.fc_profiles where id=p_fc_id and coalesce(hanwha_commission_pdf_path,'') not in ('','deleted')
      on conflict(storage_path) do nothing;
    update public.fc_documents set storage_path='deleted',file_name='deleted.pdf',status='pending',reviewer_note=null where fc_id=p_fc_id and doc_type=p_doc_type;
    update public.fc_profiles set status='docs-pending',
      hanwha_commission_date_sub=null,hanwha_commission_date=null,hanwha_commission_reject_reason=null,
      hanwha_commission_pdf_path=null,hanwha_commission_pdf_name=null,appointment_url=null,appointment_date=null,
      appointment_schedule_life=null,appointment_schedule_nonlife=null,appointment_date_life=null,appointment_date_nonlife=null,
      appointment_date_life_sub=null,appointment_date_nonlife_sub=null,appointment_reject_reason_life=null,
      appointment_reject_reason_nonlife=null,life_commission_completed=false,nonlife_commission_completed=false where id=p_fc_id;
  end if;
  return jsonb_build_object('deleted',true,'cleanupPending',exists(select 1 from public.fc_document_cleanup_queue where fc_id=p_fc_id));
end; $$;
revoke all on function public.remove_fc_document_atomic_v1(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.remove_fc_document_atomic_v1(text,text,uuid,text,text) to service_role;

create or replace function public.delete_exam_round_atomic_v1(p_actor_phone text,p_actor_role text,p_round_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  -- FOR UPDATE conflicts with FK key-share, so a concurrent application cannot slip past the check.
  perform 1 from public.exam_rounds where id=p_round_id for update;
  if not found then return jsonb_build_object('deleted',true,'alreadyDeleted',true); end if;
  if exists(select 1 from public.exam_registrations where round_id=p_round_id) then
    raise exception 'registration-bearing round protected' using errcode='23503';
  end if;
  delete from public.exam_locations where round_id=p_round_id;
  delete from public.exam_rounds where id=p_round_id;
  return jsonb_build_object('deleted',true,'alreadyDeleted',false);
end; $$;
revoke all on function public.delete_exam_round_atomic_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_exam_round_atomic_v1(text,text,uuid) to service_role;

create table if not exists public.ux_creation_receipts (
  actor_role text not null, actor_phone text not null, request_id uuid not null,
  operation text not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_role,actor_phone,request_id,operation)
);
alter table public.ux_creation_receipts enable row level security;
revoke all on public.ux_creation_receipts from public,anon,authenticated;
grant all on public.ux_creation_receipts to service_role;

create or replace function public.create_board_post_idempotent_v1(
  p_actor_phone text,p_actor_role text,p_actor_name text,p_request_id uuid,p_category_id uuid,p_title text,p_content text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_payload jsonb; v_receipt record; v_result jsonb;
begin
  if current_user<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_actor_role is null or p_actor_role not in ('admin','manager') then raise exception 'actor not authorized' using errcode='42501'; end if;
  if p_actor_role='admin' then perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  elsif p_actor_role<>'manager' or not exists(select 1 from public.manager_accounts where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_actor_phone,'[^0-9]','','g') and active=true) then
    raise exception 'actor not authorized' using errcode='42501'; end if;
  if p_request_id is null or btrim(coalesce(p_title,''))='' or btrim(coalesce(p_content,''))='' then raise exception 'invalid payload' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('categoryId',p_category_id,'title',p_title,'content',p_content);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_role||':'||p_actor_phone||':'||p_request_id::text||':board',0));
  select payload,result into v_receipt from public.ux_creation_receipts where actor_role=p_actor_role and actor_phone=p_actor_phone and request_id=p_request_id and operation='board';
  if found then
    if v_receipt.payload<>v_payload then raise exception 'request payload changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.board_categories where id=p_category_id and is_active=true) then raise exception 'invalid category' using errcode='22023'; end if;
  insert into public.board_posts(category_id,title,content,author_role,author_resident_id,author_name)
    values(p_category_id,p_title,p_content,p_actor_role,p_actor_phone,p_actor_name) returning jsonb_build_object('id',id,'updated_at',updated_at) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'board',v_payload,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_board_post_idempotent_v1(text,text,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_board_post_idempotent_v1(text,text,text,uuid,uuid,text,text) to service_role;

alter table public.notices add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.notices add column if not exists files jsonb not null default '[]'::jsonb;

create or replace function public.create_notice_idempotent_v1(p_actor_phone text,p_actor_role text,p_request_id uuid,p_notice jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_receipt record; v_result jsonb;
begin
  perform public.assert_ux_mutation_actor_v1(p_actor_phone,p_actor_role);
  if p_request_id is null or btrim(coalesce(p_notice->>'title',''))='' or btrim(coalesce(p_notice->>'body',''))='' then raise exception 'invalid payload' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_role||':'||p_actor_phone||':'||p_request_id::text||':notice',0));
  select payload,result into v_receipt from public.ux_creation_receipts where actor_role=p_actor_role and actor_phone=p_actor_phone and request_id=p_request_id and operation='notice';
  if found then
    if v_receipt.payload<>p_notice then raise exception 'request payload changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  insert into public.notices(title,body,category,images,files)
    values(p_notice->>'title',p_notice->>'body',coalesce(nullif(p_notice->>'category',''),'공지사항'),coalesce(p_notice->'images','[]'::jsonb),coalesce(p_notice->'files','[]'::jsonb))
    returning jsonb_build_object('id',id) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'notice',p_notice,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) to service_role;
