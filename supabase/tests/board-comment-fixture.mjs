import { readFile } from 'node:fs/promises';
export const migration = await readFile(new URL('../migrations/20261002020937_board_comment_idempotency.sql', import.meta.url), 'utf8');
export const postId = '20000000-0000-4000-8000-000000000001';
export const actorId = '10000000-0000-4000-8000-000000000001';
export const fixtureSql = `
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table admin_accounts(id uuid primary key, phone text, active boolean);
create table manager_accounts(like admin_accounts including all);
create table fc_profiles(id uuid primary key, phone text, signup_completed boolean);
create table board_posts(id uuid primary key, author_resident_id text, author_role text, title text);
create table board_comments(id uuid primary key default gen_random_uuid(),
 post_id uuid references board_posts on delete cascade, parent_id uuid references board_comments on delete cascade,
 content text, author_role text, author_resident_id text, author_name text);
create table notifications(id uuid primary key default gen_random_uuid(), recipient_role text,
 resident_id text, recipient_actor_id uuid, title text, body text, category text, target jsonb,
 target_url text, delivery_key text unique);
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on all tables in schema public to service_role;
insert into fc_profiles values ('${actorId}', '00000000001', true),
 ('10000000-0000-4000-8000-000000000002', '00000000002', true);
insert into board_posts values ('${postId}', '00000000002', 'fc', 'Synthetic post');
`;
export async function rpc(db, requestId, overrides = {}) {
  const { rows } = await db.query('select public.create_board_comment_idempotent($1,$2,$3,$4,$5,$6,$7) result',
    [overrides.role ?? 'fc', overrides.phone ?? '00000000001', 'Synthetic actor', requestId,
      overrides.postId ?? postId, overrides.parentId ?? null, overrides.content ?? 'Synthetic comment']);
  return rows[0].result;
}
