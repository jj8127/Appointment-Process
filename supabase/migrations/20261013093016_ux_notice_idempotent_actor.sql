-- Preserve verified authorship when the admin UI uses the existing atomic
-- notice creation RPC. Existing receipts and the result shape remain intact.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.notices add column if not exists created_by text;

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
  insert into public.notices(title,body,category,images,files,created_by)
    values(p_notice->>'title',p_notice->>'body',coalesce(nullif(p_notice->>'category',''),'공지사항'),coalesce(p_notice->'images','[]'::jsonb),coalesce(p_notice->'files','[]'::jsonb),p_actor_phone)
    returning jsonb_build_object('id',id) into v_result;
  insert into public.ux_creation_receipts values(p_actor_role,p_actor_phone,p_request_id,'notice',p_notice,v_result,now());
  return v_result;
end; $$;
revoke all on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_notice_idempotent_v1(text,text,uuid,jsonb) to service_role;
