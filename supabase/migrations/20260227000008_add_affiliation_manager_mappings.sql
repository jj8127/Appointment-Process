create table if not exists public.affiliation_manager_mappings (
  id uuid primary key default gen_random_uuid(),
  affiliation text not null,
  manager_phone text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliation, manager_phone)
);

create index if not exists idx_affiliation_manager_mappings_affiliation
  on public.affiliation_manager_mappings (affiliation);
create index if not exists idx_affiliation_manager_mappings_manager_phone
  on public.affiliation_manager_mappings (manager_phone);

drop trigger if exists trg_affiliation_manager_mappings_updated_at on public.affiliation_manager_mappings;
create trigger trg_affiliation_manager_mappings_updated_at
before update on public.affiliation_manager_mappings
for each row execute function public.set_updated_at();

alter table public.affiliation_manager_mappings enable row level security;

drop policy if exists "affiliation_manager_mappings select" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings select"
  on public.affiliation_manager_mappings
  for select
  using (public.is_admin() or public.is_manager());

drop policy if exists "affiliation_manager_mappings insert" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings insert"
  on public.affiliation_manager_mappings
  for insert
  with check (public.is_admin());

drop policy if exists "affiliation_manager_mappings update" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings update"
  on public.affiliation_manager_mappings
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "affiliation_manager_mappings delete" on public.affiliation_manager_mappings;
create policy "affiliation_manager_mappings delete"
  on public.affiliation_manager_mappings
  for delete
  using (public.is_admin());

-- Legacy labels can still exist in older rows; normalize to the current team labels.
update public.fc_profiles
set affiliation = case affiliation
  when '1본부 [본부장: 서선미]' then '1팀(서울1) : 서선미 본부장님'
  when '2본부 [본부장: 박성훈]' then '2팀(서울2) : 박성훈 본부장님'
  when '3본부 [본부장: 현경숙]' then '3팀(부산1) : 김태희 본부장님'
  when '4본부 [본부장: 최철준]' then '4팀(대전1) : 현경숙 본부장님'
  when '5본부 [본부장: 박선희]' then '5팀(대전2) : 최철준 본부장님'
  when '6본부 [본부장: 김태희]' then '6팀(전주1) : 박선희 본부장님'
  when '7본부 [본부장: 김동훈]' then '7팀(청주1/직할) : 김동훈 본부장님'
  when '8본부 [본부장: 정승철]' then '8팀(서울3) : 정승철 본부장님'
  else affiliation
end
where affiliation in (
  '1본부 [본부장: 서선미]',
  '2본부 [본부장: 박성훈]',
  '3본부 [본부장: 현경숙]',
  '4본부 [본부장: 최철준]',
  '5본부 [본부장: 박선희]',
  '6본부 [본부장: 김태희]',
  '7본부 [본부장: 김동훈]',
  '8본부 [본부장: 정승철]'
);

with affiliation_defaults(affiliation, manager_name) as (
  values
    ('1팀(서울1) : 서선미 본부장님', '서선미'),
    ('2팀(서울2) : 박성훈 본부장님', '박성훈'),
    ('3팀(부산1) : 김태희 본부장님', '김태희'),
    ('4팀(대전1) : 현경숙 본부장님', '현경숙'),
    ('5팀(대전2) : 최철준 본부장님', '최철준'),
    ('6팀(전주1) : 박선희 본부장님', '박선희'),
    ('7팀(청주1/직할) : 김동훈 본부장님', '김동훈'),
    ('8팀(서울3) : 정승철 본부장님', '정승철')
),
resolved as (
  select
    d.affiliation,
    regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g') as manager_phone
  from affiliation_defaults d
  join public.manager_accounts m
    on regexp_replace(regexp_replace(coalesce(m.name, ''), '\s+', '', 'g'), '본부장님?$', '') =
       regexp_replace(d.manager_name, '\s+', '', 'g')
)
insert into public.affiliation_manager_mappings (affiliation, manager_phone, active)
select affiliation, manager_phone, true
from resolved
where manager_phone <> ''
on conflict (affiliation, manager_phone)
do update set
  active = true,
  updated_at = now();
