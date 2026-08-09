-- Backfill exam_rounds.exam_month for legacy environments where the monthly slot
-- value was not yet persisted on existing exam rounds.
--
-- Goal:
-- - recover exam_month for date-TBD rounds using existing registrations and
--   round labels,
-- - keep behavior conservative (fail closed when a round cannot be resolved),
-- - leave final schema changes to the canonical migration.

do $exam_round_month_legacy$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'exam_rounds'
       and column_name = 'exam_month'
  ) then
    alter table public.exam_rounds
      add column exam_month date;
  end if;
end
$exam_round_month_legacy$;

-- 1) Exact date rounds: inherit the month of exam_date.
update public.exam_rounds
   set exam_month = date_trunc('month', exam_date)::date
 where exam_month is null
   and exam_date is not null;

-- 2) Legacy TBD rounds that already have registration history.
with backfilled_by_registrations as (
  select
    reg.round_id,
    min(reg.exam_month) as inferred_exam_month
  from public.exam_registrations reg
  join public.exam_rounds round_row
    on round_row.id = reg.round_id
   and round_row.exam_month is null
 where reg.exam_month is not null
 group by reg.round_id
 having count(distinct reg.exam_month) = 1
)
update public.exam_rounds round_row
   set exam_month = backfill.inferred_exam_month
  from backfilled_by_registrations backfill
 where round_row.id = backfill.round_id
   and round_row.exam_month is null;

-- 3) Parse unresolved labels (examples: '2026년 9월', '26년 9월', '9월')
--    and infer a deterministic month.
with parsed_tbd_rounds as (
  select
    round_row.id,
    round_row.registration_deadline,
    regexp_match(
      btrim(coalesce(round_row.round_label, '')),
      '^(?:([0-9]{2}|[0-9]{4})\\s*[^0-9]*?)?([0]?[1-9]|1[0-2])'
    ) as parsed_parts
  from public.exam_rounds round_row
  where round_row.exam_month is null
),
resolved_tbd_months as (
  select
    parsed.id,
    parsed.registration_deadline,
    case
      when parsed_parts[1] is null then extract(year from parsed.registration_deadline)::integer
      when char_length(parsed_parts[1]) = 2 then 2000 + parsed_parts[1]::integer
      else parsed_parts[1]::integer
    end as resolved_year,
    parsed_parts[1] is not null as has_year_label,
    parsed_parts[2]::integer as resolved_month
  from parsed_tbd_rounds parsed
  where parsed.parsed_parts is not null
    and parsed.registration_deadline is not null
    and parsed_parts[2]::integer between 1 and 12
),
canonical_tbd_months as (
  select
    parsed_tbd.id,
    parsed_tbd.resolved_year,
    case
      when parsed_tbd.resolved_year is null then null
      when not parsed_tbd.has_year_label
           and parsed_tbd.resolved_month < extract(month from parsed_tbd.registration_deadline)::integer
        then make_date(parsed_tbd.resolved_year + 1, parsed_tbd.resolved_month, 1)
      else make_date(parsed_tbd.resolved_year, parsed_tbd.resolved_month, 1)
    end as resolved_exam_month
  from resolved_tbd_months parsed_tbd
)
update public.exam_rounds round_row
   set exam_month = canonical_tbd_months.resolved_exam_month
  from canonical_tbd_months
 where round_row.id = canonical_tbd_months.id
   and round_row.exam_month is null
   and canonical_tbd_months.resolved_exam_month is not null
   and canonical_tbd_months.resolved_year between 2000 and 2100;

-- 4) As last resort, use the registration deadline month.
update public.exam_rounds
   set exam_month = date_trunc('month', registration_deadline)::date
 where exam_month is null
   and registration_deadline is not null;

-- 5) Recover legacy application rows that were written before round month existed.
update public.exam_registrations registration
   set exam_month = round_row.exam_month
  from public.exam_rounds round_row
 where registration.round_id = round_row.id
   and registration.exam_month is null
   and round_row.exam_month is not null;

-- Guardrail to prevent silently leaving unresolved rounds.
do $exam_round_month_legacy_guard$
begin
  if exists (
    select 1
      from public.exam_rounds
     where exam_month is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_round_month_backfill_unresolved';
  end if;
end
$exam_round_month_legacy_guard$;
