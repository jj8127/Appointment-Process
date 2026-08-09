-- Presence functions return a column named `phone`, so unqualified conflict
-- targets and predicates can collide with the PL/pgSQL output variable.
-- Patch the exact deployed bodies while preserving signatures, ACL and all
-- unrelated behavior.

begin;

do $migration$
declare
  v_definition text;
  v_patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.touch_user_presence(text,text)'::regprocedure
  ) into v_definition;
  v_patched_definition := pg_catalog.regexp_replace(
    v_definition,
    'on\s+conflict\s+\(phone\)\s+do\s+update',
    'on conflict on constraint user_presence_pkey do update',
    'i'
  );
  if v_patched_definition is not distinct from v_definition then
    raise exception 'touch_user_presence_phone_source_drift';
  end if;
  execute v_patched_definition;

  select pg_catalog.pg_get_functiondef(
    'public.stale_user_presence(text,text,timestamp with time zone)'::regprocedure
  ) into v_definition;
  v_patched_definition := pg_catalog.regexp_replace(
    v_definition,
    'from\s+public\.user_presence\s+where\s+phone\s*=\s*normalized_phone',
    'from public.user_presence as presence where presence.phone = normalized_phone',
    'i'
  );
  if v_patched_definition is not distinct from v_definition then
    raise exception 'stale_user_presence_phone_source_drift';
  end if;
  execute v_patched_definition;
end;
$migration$;

commit;
