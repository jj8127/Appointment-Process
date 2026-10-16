-- A 1:1 conversation that changes (send, read mark, delete) sends a content-free
-- "changed" broadcast; the open room then asks fc-notify for the changes after
-- its cursor. The app has no Supabase Auth session, so the broadcast goes to a
-- public channel whose name is an HMAC of the thread id: only a client that
-- fc-notify handed the name to can listen, and a leaked thread id does not
-- reveal it. The payload carries no message data either way.
--
-- Without the Vault key nothing is sent and rooms keep refreshing on a timer.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'messenger_realtime_topic_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'messenger_realtime_topic_key',
      'HMAC key for 1:1 messenger realtime channel names'
    );
  end if;
end;
$$;

create or replace function public.messenger_direct_realtime_topic_v1(p_thread_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if p_thread_id is null then
    return null;
  end if;
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'messenger_realtime_topic_key'
  limit 1;
  if v_key is null or v_key = '' then
    return null;
  end if;
  return 'dm-' || encode(extensions.hmac(p_thread_id::text, v_key, 'sha256'), 'hex');
end;
$$;

revoke all on function public.messenger_direct_realtime_topic_v1(uuid) from public, anon, authenticated;
grant execute on function public.messenger_direct_realtime_topic_v1(uuid) to service_role;

create or replace function public.messages_signal_direct_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_thread uuid;
  v_topic text;
begin
  for v_thread in select distinct thread_id from changed_rows where thread_id is not null loop
    -- A signal is a hint; a failure here must never undo the message write.
    begin
      v_topic := public.messenger_direct_realtime_topic_v1(v_thread);
      if v_topic is not null then
        perform realtime.send(jsonb_build_object('at', clock_timestamp()), 'changed', v_topic, false);
      end if;
    exception when others then
      raise warning 'messages_signal_direct_change skipped: %', sqlstate;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.messages_signal_direct_change() from public, anon, authenticated;

-- One signal per conversation per statement: marking twenty rows read sends one.
create or replace trigger messages_signal_direct_insert
  after insert on public.messages
  referencing new table as changed_rows
  for each statement execute function public.messages_signal_direct_change();

create or replace trigger messages_signal_direct_update
  after update on public.messages
  referencing new table as changed_rows
  for each statement execute function public.messages_signal_direct_change();
