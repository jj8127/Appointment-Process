do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exam_registrations'::regclass
      and contype = 'f'
      and conname = 'exam_registrations_round_exam_type_fkey'
  ) then
    raise exception 'exam_registrations_round_exam_type_fkey must exist before the legacy round relationship is removed';
  end if;

  if exists (
    select 1
    from public.exam_registrations registration
    where registration.round_id is not null
      and (
        registration.exam_type is null
        or not exists (
          select 1
          from public.exam_rounds exam_round
          where exam_round.id = registration.round_id
            and exam_round.exam_type = registration.exam_type
        )
      )
  ) then
    raise exception 'cannot remove legacy exam round relationship while registrations violate the type-aware relationship';
  end if;
end $$;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_id_fkey;

notify pgrst, 'reload schema';
