-- Policy change: deadline and applied status independently gate FC self-cancellation.
-- Existing admin transitions/account-deletion RPC, ACL, proof and history behavior stay intact.
-- FC self-cancellation is allowed through the whole registration deadline day
-- in Asia/Seoul. Trusted callers cannot supply a clock to the mutation RPC.
create or replace function public.exam_self_cancellation_deadline_passed(
  p_registration_deadline date,
  p_checked_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when p_registration_deadline is null or not isfinite(p_registration_deadline)
      or p_checked_at is null or not isfinite(p_checked_at) then true
    else (p_checked_at at time zone 'Asia/Seoul')::date > p_registration_deadline
  end;
$$;

revoke all on function public.exam_self_cancellation_deadline_passed(date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.exam_self_cancellation_deadline_passed(date, timestamptz)
  to service_role;

create or replace function public.transition_exam_registration(
  p_registration_id uuid,
  p_action text,
  p_actor_type text,
  p_actor_admin_id uuid default null,
  p_actor_fc_id uuid default null,
  p_reason text default null
)
returns table (
  registration_id uuid,
  status text,
  proof_path text,
  target_resident_id text,
  exam_type text,
  notification_id uuid,
  recipient_actor_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_admin public.admin_accounts%rowtype;
  v_exam_type text;
  v_registration_deadline date;
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_proof_path text;
  v_target_url text;
  v_title text;
  v_body text;
  v_notification_id uuid;
begin
  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.id = p_registration_id
   for update;

  if v_registration.id is null then
    raise exception using errcode = 'P0002', message = 'exam_registration_not_found';
  end if;

  select round_row.exam_type, round_row.registration_deadline
    into v_exam_type, v_registration_deadline
    from public.exam_rounds round_row
   where round_row.id = v_registration.round_id
   for share;

  if v_registration.status in ('completed', 'no_show') then
    raise exception using errcode = '55000', message = 'terminal_exam_registration';
  end if;

  if p_action = 'cancel_by_fc' then
    if p_actor_type is distinct from 'fc'
       or p_actor_fc_id is null
       or p_actor_fc_id is distinct from v_registration.fc_id then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  else
    if p_actor_type not in ('admin', 'developer') or p_actor_admin_id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
    select admin_row.* into v_admin
      from public.admin_accounts admin_row
     where admin_row.id = p_actor_admin_id
       and admin_row.active = true
       and (
         (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
         or (p_actor_type = 'admin' and coalesce(admin_row.staff_type, 'admin') = 'admin')
       )
     for share;
    if v_admin.id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  end if;

  v_from_status := v_registration.status;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'confirm' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'confirmed';
    when 'unconfirm' then
      if v_from_status <> 'confirmed' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'applied';
    when 'reject' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      if v_reason is null or char_length(v_reason) > 1000 then
        raise exception using errcode = '22023', message = 'invalid_rejection_reason';
      end if;
      v_to_status := 'rejected';
    when 'cancel_by_fc' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      -- Check only after actor ownership and existing state guards, under the
      -- registration and round locks, before any proof/history mutation.
      if public.exam_self_cancellation_deadline_passed(v_registration_deadline, clock_timestamp()) then
        raise exception using
          errcode = 'P0001',
          message = 'exam_cancellation_deadline_passed';
      end if;
      v_to_status := 'cancelled_by_fc';
    when 'cancel_by_admin' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_admin';
    else
      raise exception using errcode = '22023', message = 'invalid_exam_transition_action';
  end case;

  if v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then
    select proof.storage_path into v_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'discarded'
     where proof.registration_id = v_registration.id and proof.status = 'attached';
  end if;

  update public.exam_registrations registration
     set status = v_to_status,
         is_confirmed = v_to_status = 'confirmed',
         payment_proof_attached = case
           when v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then false
           else registration.payment_proof_attached
         end,
         rejection_reason = case when v_to_status = 'rejected' then v_reason else null end,
         rejected_at = case when v_to_status = 'rejected' then now() else null end,
         rejected_by_admin_id = case when v_to_status = 'rejected' then p_actor_admin_id else null end,
         rejected_by_staff_type = case when v_to_status = 'rejected' then p_actor_type else null end
   where registration.id = v_registration.id;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, reason,
    actor_type, actor_admin_id_snapshot, actor_fc_id_snapshot
  ) values (
    v_registration.id,
    case p_action
      when 'confirm' then 'confirmed'
      when 'unconfirm' then 'unconfirmed'
      when 'reject' then 'rejected'
      when 'cancel_by_fc' then 'cancelled_by_fc'
      when 'cancel_by_admin' then 'cancelled_by_admin'
    end,
    v_from_status,
    v_to_status,
    case when p_action = 'reject' then v_reason else null end,
    p_actor_type,
    p_actor_admin_id,
    p_actor_fc_id
  );

  if p_action <> 'cancel_by_fc' then
    v_target_url := case when v_exam_type = 'nonlife' then '/exam-apply2' else '/exam-apply' end;
    v_title := case p_action
      when 'confirm' then '시험 접수가 승인되었습니다.'
      when 'unconfirm' then '시험 접수 승인이 취소되었습니다.'
      when 'reject' then '시험 접수가 반려되었습니다.'
      else '시험 접수가 취소되었습니다.'
    end;
    v_body := case
      when p_action = 'reject' then v_title || ' 사유: ' || v_reason
      else v_title
    end;
    insert into public.notifications (
      fc_id, resident_id, recipient_role, recipient_actor_id,
      title, body, category, target, target_url
    ) values (
      v_registration.fc_id, v_registration.resident_id, 'fc', v_registration.fc_id,
      v_title, v_body, 'exam_apply',
      jsonb_build_object(
        'version', 1,
        'kind', 'exam',
        'examType', v_exam_type,
        'examRegistrationId', v_registration.id
      ),
      v_target_url
    )
    returning id into v_notification_id;
  end if;

  return query
  select v_registration.id, v_to_status, v_proof_path,
         v_registration.resident_id, v_exam_type, v_notification_id,
         v_registration.fc_id;
end;
$$;

revoke all on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) to service_role;
