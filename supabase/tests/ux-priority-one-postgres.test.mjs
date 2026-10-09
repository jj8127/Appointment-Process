import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before, after } from 'node:test';
import { migration, fc, round, category, request, fixtureSql } from './ux-priority-one-fixture.mjs';
const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.OTP_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit isolated loopback port required');
const config = {host:'127.0.0.1',port,user:'otp_fixture',password:'synthetic-local-only',ssl:false,
  connectionTimeoutMillis:3000,options:'-c statement_timeout=8000 -c lock_timeout=6000'};
const database = `ux_priority_one_regression_${process.pid}`;
let admin, db, first, second;
const clients=[];
async function connect() { const client = new Client({...config,database});await client.connect();clients.push(client);return client; }
before(async()=>{
  admin=new Client({...config,database:'postgres'});await admin.connect();await admin.query(`create database ${database}`);
  db=await connect();first=await connect();second=await connect();
  await db.query(fixtureSql.replace('create role anon; create role authenticated; create role service_role bypassrls;', () => `do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    -- Other isolated SQL fixtures may have created this cluster-wide role without BYPASSRLS.
    alter role service_role bypassrls;
  end $$;`));
  assert.equal((await db.query("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0]?.rolbypassrls,true,
    'isolated fixture service_role must match the trusted backend RLS bypass model');
  await db.query('begin;\n'+migration+'\ncommit;');
});
after(async()=>{
  await Promise.all(clients.map(x=>x.end()));
  if(admin){await admin.query(`drop database if exists ${database}`);await admin.end();}
});
async function waitLock() {
  for(let i=0;i<200;i++){
    if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[second.processID])).rows[0]?.wait_event_type==='Lock')return;
    await delay(10);
  } assert.fail('competing transaction did not wait on a real PostgreSQL lock');
}
async function create(client,kind='board',title='Synthetic') {
  await client.query('set role service_role');
  try {
    const result=kind==='board'
      ? await client.query('select create_board_post_idempotent_v1($1,$2,$3,$4,$5,$6,$7) result',['00000000001','admin','Synthetic',request,category,title,'Content'])
      : await client.query('select create_notice_idempotent_v1($1,$2,$3,$4) result',['00000000001','admin',request,{title,body:'Content',images:[],files:[]}]);
    return result.rows[0].result;
  } finally { await client.query('reset role'); }
}
async function deleteRound(client) {
  await client.query('set role service_role');
  try { return (await client.query('select delete_exam_round_atomic_v1($1,$2,$3) result',['00000000001','admin',round])).rows[0].result; }
  finally { await client.query('reset role'); }
}
async function resetCreation() { await db.query('truncate board_posts,notices,ux_creation_receipts'); }
for(const kind of ['board','notice']) {
  test(`${kind}: independent identical requests wait for commit and create exactly one row`,async()=>{
    await resetCreation();await first.query('begin');const original=await create(first,kind);
    const pending=create(second,kind);await waitLock();await first.query('commit');
    assert.deepEqual(await pending,original);
    assert.equal((await db.query(`select count(*)::int count from ${kind==='board'?'board_posts':'notices'}`)).rows[0].count,1);
    assert.equal((await db.query('select count(*)::int count from ux_creation_receipts')).rows[0].count,1);
  });
  test(`${kind}: rollback releases the key and a competing request becomes the sole committed row`,async()=>{
    await resetCreation();await first.query('begin');const rolledBack=await create(first,kind);
    const pending=create(second,kind);await waitLock();await first.query('rollback');
    const committed=await pending;assert.notEqual(committed.id,rolledBack.id);assert.deepEqual(await create(first,kind),committed);
    assert.equal((await db.query(`select count(*)::int count from ${kind==='board'?'board_posts':'notices'}`)).rows[0].count,1);
  });
  test(`${kind}: a changed concurrent payload waits then conflicts without replacing the first result`,async()=>{
    await resetCreation();await first.query('begin');await create(first,kind);
    const pending=create(second,kind,'Changed');const rejection=assert.rejects(pending,/request payload changed/);
    await waitLock();await first.query('commit');await rejection;
    assert.equal((await db.query(`select title from ${kind==='board'?'board_posts':'notices'}`)).rows[0].title,'Synthetic');
  });
}
test('committed creation cannot leave a post behind when receipt insertion fails',async()=>{
  await resetCreation();
  await db.query("create function fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end; $$; create trigger fail_receipt before insert on ux_creation_receipts for each row execute function fail_receipt();");
  await assert.rejects(create(first),/synthetic receipt failure/);
  assert.equal((await db.query('select count(*)::int count from board_posts')).rows[0].count,0);
  await db.query('drop trigger fail_receipt on ux_creation_receipts');
});
test('concurrent application commits first; round deletion waits then protects its parent and locations',async()=>{
  await first.query('begin');await first.query('insert into exam_registrations(round_id) values($1)',[round]);
  const pending=deleteRound(second);const rejection=assert.rejects(pending,/registration-bearing round protected/);
  await waitLock();await first.query('commit');await rejection;
  assert.equal((await db.query('select count(*)::int count from exam_locations')).rows[0].count,1);
});
test('concurrent round deletion commits first; application waits then fails its FK without a partial row',async()=>{
  await db.query('delete from exam_registrations');await first.query('begin');await deleteRound(first);
  const pending=second.query('insert into exam_registrations(round_id) values($1)',[round]);
  const rejection=assert.rejects(pending,/foreign key constraint/);
  await waitLock();await first.query('commit');await rejection;
  assert.equal((await db.query('select count(*)::int count from exam_registrations')).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int count from exam_locations')).rows[0].count,0);
});
