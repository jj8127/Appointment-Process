-- Normalize legacy affiliation labels to the updated 2026-02 team mapping.
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
