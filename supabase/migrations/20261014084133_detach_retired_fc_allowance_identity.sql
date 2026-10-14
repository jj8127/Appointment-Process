-- Preserve reviewed allowance history when its live FC account is removed.
alter table public.referral_allowance_imports
  add column if not exists beneficiary_fc_id_snapshot uuid;
alter table public.referral_allowance_imports
  alter column beneficiary_fc_id drop not null;
alter table public.referral_allowance_imports
  drop constraint if exists referral_allowance_imports_beneficiary_fc_id_fkey;
alter table public.referral_allowance_imports
  add constraint referral_allowance_imports_beneficiary_fc_id_fkey
  foreign key (beneficiary_fc_id) references public.fc_profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_allowance_imports'::regclass
      and conname = 'referral_allowance_imports_beneficiary_identity'
  ) then
    alter table public.referral_allowance_imports
      add constraint referral_allowance_imports_beneficiary_identity check (
        (beneficiary_fc_id is not null and beneficiary_fc_id_snapshot is null)
        or (beneficiary_fc_id is null and beneficiary_fc_id_snapshot is not null)
      );
  end if;
end $$;

-- Keep the existing live-account constraints/RPC conflict targets unchanged.
-- The same source, revision and single-published-month rules also cover archives.
create unique index if not exists referral_allowance_archive_source_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month, source_sha256, policy_version, pilot_revision)
  where beneficiary_fc_id is null;
create unique index if not exists referral_allowance_archive_revision_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month, revision)
  where beneficiary_fc_id is null;
create unique index if not exists referral_allowance_archive_published_month_unique
  on public.referral_allowance_imports
    (beneficiary_fc_id_snapshot, performance_month)
  where beneficiary_fc_id is null and status = 'published';

create or replace function public.guard_referral_allowance_import_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the nested FK action after deletion of the referenced FC may detach
  -- identity. Direct updates and forged nested updates with a live FC fail.
  if pg_trigger_depth() > 1
    and old.beneficiary_fc_id is not null
    and new.beneficiary_fc_id is null
    and old.beneficiary_fc_id_snapshot is null
    and new.beneficiary_fc_id_snapshot is null
    and not exists (
      select 1 from public.fc_profiles where id = old.beneficiary_fc_id
    ) then
    if (to_jsonb(new) - array['beneficiary_fc_id','beneficiary_fc_id_snapshot'])
      is distinct from
      (to_jsonb(old) - array['beneficiary_fc_id','beneficiary_fc_id_snapshot']) then
      raise exception using errcode = '23514', message = 'allowance_import_immutable';
    end if;
    new.beneficiary_fc_id_snapshot := old.beneficiary_fc_id;
    return new;
  end if;

  if old.beneficiary_fc_id_snapshot is not null then
    raise exception using errcode = '23514', message = 'archived_allowance_import_immutable';
  end if;
  if (to_jsonb(new) - array['status','published_by','published_at','superseded_at'])
    is distinct from
    (to_jsonb(old) - array['status','published_by','published_at','superseded_at']) then
    raise exception using errcode = '23514', message = 'allowance_import_immutable';
  end if;
  if old.status = 'draft' and new.status = 'published' and new.superseded_at is null then return new; end if;
  if old.status = 'published' and new.status = 'superseded'
    and new.published_by is not distinct from old.published_by
    and new.published_at is not distinct from old.published_at then return new; end if;
  raise exception using errcode = '23514', message = 'invalid_allowance_transition';
end;
$$;
