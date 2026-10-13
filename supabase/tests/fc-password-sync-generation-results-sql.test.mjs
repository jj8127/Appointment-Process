import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(
  new URL('../migrations/20261013042114_fc_password_sync_generation_results.sql', import.meta.url),
  'utf8',
);
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const FC_ID = '10000000-0000-4000-8000-000000000001';
const MISSING_FC_ID = '10000000-0000-4000-8000-000000000002';

const fixtureSql = `
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.fc_credentials (
  fc_id uuid primary key,
  password_hash text not null,
  password_salt text not null,
  session_version bigint not null default 0 check (session_version >= 0)
);

create or replace function public.advance_credential_session_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.password_hash is distinct from new.password_hash
    or old.password_salt is distinct from new.password_salt then
    new.session_version := old.session_version + 1;
  else
    new.session_version := old.session_version;
  end if;
  return new;
end;
$$;

create trigger credential_session_version before update on public.fc_credentials
for each row execute function public.advance_credential_session_version();

create or replace function public.complete_admin_assisted_password_change_v1(
  p_fc_id uuid,
  p_phone text,
  p_nonce_hash text,
  p_password_hash text,
  p_password_salt text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  update public.fc_credentials
  set password_hash = p_password_hash,
      password_salt = p_password_salt
  where fc_id = p_fc_id;
  if not found then raise exception 'synthetic_missing_credential'; end if;
  return jsonb_build_object(
    'ok', true,
    'fcId', p_fc_id,
    'phone', p_phone,
    'name', 'Fixture FC',
    'affiliation', 'Fixture'
  );
end;
$$;

create or replace function public.process_password_reset_challenge(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if p_action = 'consume' and p_account_kind = 'fc' then
    update public.fc_credentials
    set password_hash = p_password_hash,
        password_salt = p_password_salt
    where fc_id = p_account_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'account_unavailable'); end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant select, insert, update on public.fc_credentials to service_role;
grant execute on function public.complete_admin_assisted_password_change_v1(
  uuid, text, text, text, text
) to service_role;
grant execute on function public.process_password_reset_challenge(
  text, text, uuid, text, text, text, text
) to service_role;
`;

async function rpc(db, sql, args) {
  await db.exec('set role service_role');
  try {
    return (await db.query(sql, args)).rows[0].result;
  } finally {
    await db.exec('reset role');
  }
}

test('password mutation wrappers return the exact committed FC credential generation', async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(migration);
    await db.query(
      `insert into public.fc_credentials(fc_id,password_hash,password_salt)
       values($1,'hash-0','salt-0')`,
      [FC_ID],
    );

    const assisted = await rpc(
      db,
      'select public.complete_admin_assisted_password_change_v2($1,$2,$3,$4,$5) result',
      [FC_ID, '01000000000', 'a'.repeat(64), 'hash-1', 'salt-1'],
    );
    assert.equal(assisted.ok, true);
    assert.equal(assisted.fcId, FC_ID);
    assert.equal(Number(assisted.sessionVersion), 1);

    const reset = await rpc(
      db,
      'select public.process_password_reset_challenge_v2($1,$2,$3,$4,$5,$6,$7) result',
      ['consume', 'fc', FC_ID, '01000000000', 'token-hash', 'hash-2', 'salt-2'],
    );
    assert.deepEqual(reset, { ok: true, sessionVersion: 2 });
    assert.equal(
      Number((await db.query('select session_version from fc_credentials where fc_id=$1', [FC_ID])).rows[0].session_version),
      2,
    );

    const issue = await rpc(
      db,
      'select public.process_password_reset_challenge_v2($1,$2,$3,$4,$5,$6,$7) result',
      ['issue', 'fc', FC_ID, '01000000000', 'next-token', null, null],
    );
    assert.deepEqual(issue, { ok: true });
    assert.equal(
      Number((await db.query('select session_version from fc_credentials where fc_id=$1', [FC_ID])).rows[0].session_version),
      2,
    );

    const unavailable = await rpc(
      db,
      'select public.process_password_reset_challenge_v2($1,$2,$3,$4,$5,$6,$7) result',
      ['consume', 'fc', MISSING_FC_ID, '01000000001', 'missing-token', 'hash-x', 'salt-x'],
    );
    assert.deepEqual(unavailable, { ok: false, code: 'account_unavailable' });
  } finally {
    await db.close();
  }
});

test('generation wrappers are invoker-only, service-role-only, and preserved in schema', async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(migration);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query(
          'select public.process_password_reset_challenge_v2($1,$2,$3,$4,$5,$6,$7)',
          ['issue', 'fc', FC_ID, '01000000000', 'token-hash', null, null],
        ),
        /permission denied for function/,
      );
      await db.exec('reset role');
    }

    const flags = await db.query(`
      select proname, prosecdef
      from pg_proc
      where proname in (
        'complete_admin_assisted_password_change_v2',
        'process_password_reset_challenge_v2'
      )
      order by proname
    `);
    assert.deepEqual(flags.rows, [
      { proname: 'complete_admin_assisted_password_change_v2', prosecdef: false },
      { proname: 'process_password_reset_challenge_v2', prosecdef: false },
    ]);
    assert.match(
      migration,
      /complete_admin_assisted_password_change_v1[\s\S]*select credential\.session_version[\s\S]*sessionVersion/,
    );
    assert.match(
      migration,
      /process_password_reset_challenge\([\s\S]*select credential\.session_version[\s\S]*sessionVersion/,
    );
    assert.ok(
      schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n')),
      'schema snapshot must include the complete generation-result migration',
    );
  } finally {
    await db.close();
  }
});
