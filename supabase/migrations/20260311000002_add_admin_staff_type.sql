alter table public.admin_accounts
  add column if not exists staff_type text;

update public.admin_accounts
set staff_type = 'admin'
where staff_type is null;

alter table public.admin_accounts
  alter column staff_type set default 'admin';

alter table public.admin_accounts
  alter column staff_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_accounts_staff_type_check'
      and conrelid = 'public.admin_accounts'::regclass
  ) then
    alter table public.admin_accounts
      add constraint admin_accounts_staff_type_check
      check (staff_type in ('admin', 'developer'));
  end if;
end $$;
