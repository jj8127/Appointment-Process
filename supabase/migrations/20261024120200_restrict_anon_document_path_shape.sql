-- Anon lockdown, after stage 0: anon document rows may name only one plain object in
-- the member's own folder. 20261024120000 checked only the "<fc_id>/" prefix, but
-- Storage request URLs collapse '.'/'..' segments (also percent-encoded), so a value
-- such as "<fc_id>/../<other fc_id>/x.pdf" could make service-role signers (admin-action,
-- admin web) sign another member's file. Every app version writes "<fc_id>/<name>.pdf"
-- or the 'deleted' tombstone, which still pass. Rows written before this keep their
-- values; admin-action refuses such paths before signing.
-- Re-runnable: the guard function is replaced in place and keeps its trigger.

-- Fail fast instead of queueing API traffic behind the function lock.
set local lock_timeout = '3s';

create or replace function public.fc_documents_anon_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_object_name text;
begin
  if current_user <> 'anon' then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.fc_id is distinct from old.fc_id or new.doc_type is distinct from old.doc_type) then
    raise exception 'fc_documents_anon_write_guard: fc_id and doc_type are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from 'pending' or new.reviewer_note is not null then
    raise exception 'fc_documents_anon_write_guard: only pending submissions' using errcode = '42501';
  end if;
  if new.storage_path = 'deleted' and new.file_name = 'deleted.pdf' then
    return new;
  end if;
  v_object_name := substr(new.storage_path, length(new.fc_id::text) + 2);
  if new.storage_path is null
    or left(new.storage_path, length(new.fc_id::text) + 1) <> (new.fc_id::text || '/')
    or v_object_name !~ '^[^/%\\?#[:cntrl:]]+$'
    or v_object_name in ('.', '..') then
    raise exception 'fc_documents_anon_write_guard: storage path must be under the member folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.fc_documents_anon_write_guard() from public, anon, authenticated;
