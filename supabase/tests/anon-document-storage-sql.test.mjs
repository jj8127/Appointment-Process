// Real SQL in an isolated in-memory PostgreSQL engine: no credentials or network.
// Reproduces the production fc-documents storage policies and the Storage API's
// per-request operation setting, then checks stage 0b as role anon.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261024120100_close_anon_document_reads.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const FC = '30000000-0000-4000-8000-00000000000a';

const FIXTURE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  create function public.is_manager() returns boolean language sql stable as $$ select false $$;
  create function public.is_fc() returns boolean language sql stable as $$ select false $$;
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  -- Production definitions (storage schema, 2026-10-24).
  create function storage.operation() returns text language plpgsql stable as $f$
  begin return current_setting('storage.operation', true); end; $f$;
  create function storage.allow_any_operation(expected_operations text[]) returns boolean language sql stable as $f$
    with current_operation as (select storage.operation() as raw_operation),
    normalized as (
      select case when raw_operation like 'storage.%' then substr(raw_operation, 9) else raw_operation end as current_operation
      from current_operation
    )
    select exists (
      select 1 from normalized n cross join lateral unnest(expected_operations) as expected_operation
      where expected_operation is not null and expected_operation <> ''
        and n.current_operation = case when expected_operation like 'storage.%' then substr(expected_operation, 9)
          else expected_operation end
    );
  $f$;
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated, service_role;
  -- Production fc-documents policies (pg_policies, 2026-10-24).
  create policy "fc-documents anon read" on storage.objects for select using (bucket_id = 'fc-documents'::text);
  create policy "fc-documents anon write" on storage.objects for insert with check (bucket_id = 'fc-documents'::text);
  create policy "fc-documents read" on storage.objects for select
    using ((bucket_id = 'fc-documents'::text) AND (is_admin() OR is_manager() OR is_fc()));
  create policy "fc-documents write" on storage.objects for insert
    with check ((bucket_id = 'fc-documents'::text) AND (is_admin() OR is_fc()));
  create policy "fc-documents update" on storage.objects for update using ((bucket_id = 'fc-documents'::text) AND is_admin());
  create policy "fc-documents delete" on storage.objects for delete
    using ((bucket_id = 'fc-documents'::text) AND (is_admin() OR is_fc()));
  insert into storage.objects (bucket_id, name) values ('fc-documents', '${FC}/existing.pdf');
`;

async function withDb(run) {
  const db = new PGlite();
  try {
    await db.exec(FIXTURE);
    await db.exec(migration);
    await db.exec(migration); // re-runnable
    await run(db);
  } finally {
    await db.close();
  }
}

// The Storage API sets storage.operation for each request before running SQL as the caller's role.
async function asAnon(db, operation, sql) {
  await db.query("select set_config('storage.operation', $1, false)", [operation ?? '']);
  await db.exec('set role anon');
  try {
    return await db.query(sql);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('storage.operation', '', false)");
  }
}

const upload = (name) => `insert into storage.objects (bucket_id, name) values ('fc-documents', '${name}') returning *`;

test('anon uploads and signed-upload checks still return the new object', async () => {
  await withDb(async (db) => {
    for (const operation of ['storage.object.upload', 'storage.object.sign_upload_url', 'storage.object.upload_signed']) {
      const { rows } = await asAnon(db, operation, upload(`${FC}/${operation.split('.').pop()}.pdf`));
      assert.equal(rows.length, 1, operation);
    }
  });
});

test('anon can no longer list, download or sign document objects', async () => {
  await withDb(async (db) => {
    for (const operation of ['storage.object.list', 'storage.object.list_v2', 'storage.object.sign', 'storage.object.sign_many',
      'storage.object.get_authenticated', 'object.get_authenticated_info', null]) {
      const { rows } = await asAnon(db, operation, `select name from storage.objects where bucket_id = 'fc-documents'`);
      assert.deepEqual(rows, [], String(operation));
    }
    // RETURNING needs a visible row, so uploads outside the upload operations fail.
    await assert.rejects(asAnon(db, 'storage.object.list', upload(`${FC}/x.pdf`)), /row-level security/);
  });
});

test('anon cannot update or delete document objects; the service role still can', async () => {
  await withDb(async (db) => {
    const moved = await asAnon(db, 'storage.object.upload', `update storage.objects set name = 'x' where bucket_id = 'fc-documents'`);
    assert.equal(moved.affectedRows, 0);
    const removed = await asAnon(db, 'storage.object.delete', `delete from storage.objects where bucket_id = 'fc-documents'`);
    assert.equal(removed.affectedRows, 0);
    await db.exec('set role service_role');
    try {
      const { rows } = await db.query(`select name from storage.objects where bucket_id = 'fc-documents'`);
      assert.deepEqual(rows, [{ name: `${FC}/existing.pdf` }]);
    } finally {
      await db.exec('reset role');
    }
  });
});

test('schema snapshot includes the complete stage 0b migration', () => {
  assert.ok(schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n')));
});
