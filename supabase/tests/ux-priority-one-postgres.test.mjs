import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before, after } from 'node:test';
import { migration, fc, round, category, request, fixtureSql } from './ux-priority-one-fixture.mjs';
import { preparePlatformMembershipFixture } from './ux-priority-one-fixture.mjs';
const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.OTP_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit isolated loopback port required');
const config = {host:'127.0.0.1',port,user:'otp_fixture',password:'synthetic-local-only',ssl:false,
  connectionTimeoutMillis:3000,options:'-c statement_timeout=8000 -c lock_timeout=6000'};
const database = `ux_priority_one_regression_${process.pid}`;
const withdrawalDatabase = `platform_withdrawal_regression_${process.pid}`;
let admin, db, first, second;
let withdrawalDb, withdrawalFirst, withdrawalSecond, withdrawalActor;
const clients=[];
async function connect(databaseName=database) { const client = new Client({...config,database:databaseName});await client.connect();clients.push(client);return client; }
const roleSetup=`do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
  alter role service_role bypassrls;
end $$;`;
before(async()=>{
  admin=new Client({...config,database:'postgres'});await admin.connect();await admin.query(`create database ${database}`);
  db=await connect();first=await connect();second=await connect();
  await db.query(fixtureSql.replace('create role anon; create role authenticated; create role service_role bypassrls;', () => roleSetup));
  assert.equal((await db.query("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0]?.rolbypassrls,true,
    'isolated fixture service_role must match the trusted backend RLS bypass model');
  await db.query('begin;\n'+migration+'\ncommit;');
  await admin.query(`create database ${withdrawalDatabase}`);
  withdrawalDb=await connect(withdrawalDatabase);withdrawalFirst=await connect(withdrawalDatabase);withdrawalSecond=await connect(withdrawalDatabase);
  withdrawalActor=await connect(withdrawalDatabase);
  await preparePlatformMembershipFixture({exec:sql=>withdrawalDb.query(sql.replace(
    'create role anon; create role authenticated; create role service_role bypassrls;',()=>roleSetup))},{withWithdrawal:true});
});
after(async()=>{
  await Promise.all(clients.map(x=>x.end()));
  if(admin){await admin.query(`drop database if exists ${database}`);await admin.query(`drop database if exists ${withdrawalDatabase}`);await admin.end();}
});
async function waitLock(client=second) {
  for(let i=0;i<200;i++){
    if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;
    await delay(10);
  } assert.fail('competing transaction did not wait on a real PostgreSQL lock');
}

async function withdrawalRpc(client,sql,args=[]) {
  await client.query('set role service_role');
  try{return (await client.query(sql,args)).rows[0].result;}
  finally{await client.query('reset role');}
}
async function withdrawalMember(phone) {
  const hash=Buffer.alloc(32,3).toString('base64'),salt=Buffer.alloc(16,4).toString('base64');
  await withdrawalRpc(withdrawalDb,'select issue_platform_signup_otp($1,$2) result',[phone,hash]);
  return withdrawalRpc(withdrawalDb,'select register_platform_member($1,$2,$3,$4,$5,null) result',[phone,hash,'Synthetic Member',hash,salt]);
}

test('independent withdrawal connections serialize same-operation replay before frozen credentials can be reused',async()=>{
  const member=(await withdrawalDb.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id;
  const operation='a0000000-0000-4000-8000-000000000001',digest='a'.repeat(64);
  const historySql='select status,life_commission_completed,nonlife_commission_completed from fc_profiles where id=$1';
  const beforeHistory=(await withdrawalDb.query(historySql,[fc])).rows[0];
  await withdrawalFirst.query('begin');
  const started=await withdrawalRpc(withdrawalFirst,'select begin_platform_withdrawal_v1($1,$2,$3) result',[member,operation,digest]);
  const competing=withdrawalRpc(withdrawalSecond,'select begin_platform_withdrawal_v1($1,$2,$3) result',[member,operation,digest]);
  const upload=withdrawalRpc(withdrawalActor,'select reserve_messenger_attachment_upload_batch_v2($1,$2,$3,$4,$5,$6) result',
    [fc,'fc','a0000000-0000-4000-8000-000000000099','f'.repeat(64),JSON.stringify({kind:'group'}),'[]'])
    .then(value=>({value}),error=>({error}));
  await waitLock(withdrawalSecond);
  await waitLock(withdrawalActor);
  await withdrawalFirst.query('commit');
  assert.deepEqual(await competing,started);
  assert.match((await upload).error.message,/attachment_actor_not_active/);
  assert.deepEqual((await withdrawalDb.query(historySql,[fc])).rows[0],beforeHistory);
  assert.equal(Number((await withdrawalDb.query('select count(*) n from platform_account_withdrawals where member_id=$1',[member])).rows[0].n),1);
  assert.equal(Number((await withdrawalDb.query('select count(*) n from fc_credentials where fc_id=$1',[fc])).rows[0].n),0);
  assert.equal((await withdrawalDb.query('select signup_completed from fc_profiles where id=$1',[fc])).rows[0].signup_completed,false);
  await assert.rejects(withdrawalSecond.query('insert into fc_credentials(fc_id,password_hash,password_salt) values($1,$2,$3)',[fc,'synthetic','synthetic']),/account_closed/);
});

test('independent different-operation withdrawals cannot freeze or journal the same member twice',async()=>{
  const created=await withdrawalMember('00000000051'),firstId='a0000000-0000-4000-8000-000000000002',secondId='a0000000-0000-4000-8000-000000000003';
  await withdrawalFirst.query('begin');
  await withdrawalRpc(withdrawalFirst,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,firstId,'b'.repeat(64)]);
  const competing=withdrawalRpc(withdrawalSecond,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,secondId,'c'.repeat(64)])
    .then(value=>({value}),error=>({error}));
  await waitLock(withdrawalSecond);await withdrawalFirst.query('commit');
  assert.match((await competing).error.message,/forbidden|member_unavailable/);
  assert.equal(Number((await withdrawalDb.query('select count(*) n from platform_account_withdrawals where member_id=$1',[created.memberId])).rows[0].n),1);
  assert.equal(Number((await withdrawalDb.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),0);
});

test('independent insurance enrollment waits for common withdrawal and cannot create a service account after the accepted freeze',async()=>{
  const phone='00000000052',created=await withdrawalMember(phone),operation='a0000000-0000-4000-8000-000000000004';
  await withdrawalFirst.query('begin');
  await withdrawalRpc(withdrawalFirst,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,operation,'d'.repeat(64)]);
  const competing=withdrawalRpc(withdrawalSecond,'select enroll_platform_insurance_v1($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',
    [created.memberId,phone,'a0000000-0000-4000-8000-000000000005','e'.repeat(64),'insurance-additional-info-v1',
      'Synthetic Branch','synthetic@example.com','SKT',['life'],'unused-after-freeze',fc])
    .then(value=>({value}),error=>({error}));
  await waitLock(withdrawalSecond);await withdrawalFirst.query('commit');
  assert.match((await competing).error.message,/forbidden/);
  assert.equal(Number((await withdrawalDb.query('select count(*) n from fc_profiles where phone=$1',[phone])).rows[0].n),0);
  assert.equal((await withdrawalDb.query('select active from platform_members where id=$1',[created.memberId])).rows[0].active,false);
});

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
    if(kind==='notice') assert.equal((await db.query('select created_by from notices')).rows[0].created_by,'00000000001');
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
