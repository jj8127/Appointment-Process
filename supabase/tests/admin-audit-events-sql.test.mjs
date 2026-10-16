import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261016100000_admin_audit_events.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const FC_ID = '10000000-0000-4000-8000-000000000001';
const insert = (overrides = '') => `
  insert into public.admin_audit_events (actor_role, actor_staff_type, actor_phone, category, action, target_fc_id, target_count, detail${overrides ? ', reason' : ''})
  values ('admin', 'admin', '01000000001', 'fc_action', 'update_status', '${FC_ID}', 1, '{"status":"docs-approved"}'::jsonb${overrides ? `, ${overrides}` : ''})`;

async function withDb(run) {
  const db = new PGlite();
  try {
    await db.exec(`
      -- Supabase's service_role bypasses RLS; the fixture mirrors that attribute.
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    await db.exec(migration); // idempotent re-run
    await run(db);
  } finally {
    await db.close();
  }
}

async function asRole(db, role, sql) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('reset role');
  }
}

test('service role appends and reads audit events; other roles cannot', async () => {
  await withDb(async (db) => {
    await asRole(db, 'service_role', insert());
    const rows = await asRole(db, 'service_role', 'select category, action, target_count from public.admin_audit_events');
    assert.deepEqual(rows.rows, [{ category: 'fc_action', action: 'update_status', target_count: 1 }]);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(asRole(db, role, 'select * from public.admin_audit_events'), /permission denied/);
      await assert.rejects(asRole(db, role, insert()), /permission denied/);
    }
  });
});

test('audit events are append-only, even for the table owner', async () => {
  await withDb(async (db) => {
    await db.exec(insert());
    await assert.rejects(db.exec("update public.admin_audit_events set action = 'changed'"), /append-only/);
    await assert.rejects(db.exec('delete from public.admin_audit_events'), /append-only/);
    await assert.rejects(db.exec('truncate public.admin_audit_events'), /append-only/);
  });
});

test('resident-number-shaped detail, invalid categories and actors are rejected', async () => {
  await withDb(async (db) => {
    await assert.rejects(db.exec(insert().replace('{"status":"docs-approved"}', '{"note":"900101-1234567"}')), /check constraint/);
    await assert.rejects(db.exec(insert().replace('{"status":"docs-approved"}', '{"note":"9001011234567"}')), /check constraint/);
    await assert.rejects(db.exec(insert().replace("'fc_action'", "'other'")), /check constraint/);
    await assert.rejects(db.exec(insert().replace("'01000000001'", "'010-0000-0001'")), /check constraint/);
    await assert.rejects(db.exec(insert().replace("'update_status'", "'Update Status'")), /check constraint/);
    await db.exec(insert("'협회 접수'").replace("'fc_action'", "'export'"));
    const { rows } = await db.query("select reason from public.admin_audit_events where category = 'export'");
    assert.deepEqual(rows, [{ reason: '협회 접수' }]);
  });
});

test('schema snapshot includes the complete audit migration', () => {
  assert.ok(schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n')));
});
