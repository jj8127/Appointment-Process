import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
import { migration, fc, round, category, request, fixtureSql } from './ux-priority-one-fixture.mjs';
async function fixture() {
  const db = new PGlite();
  await db.exec(fixtureSql);
  await db.exec('begin;\n' + migration + '\ncommit;');
  return db;
}
async function rpc(db, sql, params) {
  await db.exec('set role service_role');
  try { return (await db.query(sql, params)).rows[0].result; }
  finally { await db.exec('reset role'); }
}
const remove = (db, phone = '00000000002', path = 'synthetic-path') => rpc(db,
  'select remove_fc_document_atomic_v1($1,$2,$3,$4,$5) result', [phone, 'fc', fc, 'required', path]);
const update = (db, types = ['new']) => rpc(db,
  'select update_fc_document_requests_atomic_v1($1,$2,$3,$4,$5) result', ['00000000001','admin',fc,types,'2026-10-20']);
const removeRound = (db) => rpc(db,
  'select delete_exam_round_atomic_v1($1,$2,$3) result', ['00000000001','admin',round]);
async function state(db) { return {
  documents: (await db.query('select * from fc_documents order by doc_type')).rows,
  profile: (await db.query('select * from fc_profiles')).rows,
  queue: (await db.query('select * from fc_document_cleanup_queue')).rows,
}; }

test('document delete commits profile reset and cleanup receipt together; identical retry cannot reset newly updated profile', async () => {
  const db = await fixture(); try {
    assert.deepEqual(await remove(db), { deleted:true,cleanupPending:true });
    const first = await state(db);
    assert.equal(first.documents[0].storage_path,'deleted');
    assert.equal(first.profile[0].appointment_url,null);
    assert.equal(first.profile[0].life_commission_completed,false);
    assert.equal(first.queue.length,1);
    await db.query("update fc_profiles set appointment_url='new-synthetic-url'");
    await remove(db);
    assert.equal((await state(db)).profile[0].appointment_url,'new-synthetic-url');
  } finally { await db.close(); }
});
test('profile write failure rolls back document write and cleanup queue', async () => {
  const db = await fixture(); try {
    await db.exec("create function fail_profile() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end; $$; create trigger fail_profile before update on fc_profiles for each row execute function fail_profile();");
    const before = await state(db); await assert.rejects(remove(db), /synthetic failure/);
    assert.deepEqual(await state(db),before);
  } finally { await db.close(); }
});

test('reset also durably queues the existing commission PDF and validates current FC facts', async () => {
  const db = await fixture(); try {
    await db.query("update fc_profiles set hanwha_commission_pdf_path='synthetic-commission.pdf'");
    await remove(db);
    assert.deepEqual((await db.query('select storage_path from fc_document_cleanup_queue order by storage_path')).rows.map(row=>row.storage_path), ['synthetic-commission.pdf','synthetic-path']);
    for (const patch of ["signup_completed=false", "signup_completed=true,is_manager_referral_shadow=true", "is_manager_referral_shadow=false,phone='00000000004'"]) {
      await db.query(`update fc_profiles set ${patch}`);
      await assert.rejects(rpc(db,'select assert_ux_mutation_actor_v1($1,$2,$3) result',['00000000002','fc',fc]), /actor not authorized/);
    }
    await db.query('delete from fc_documents where fc_id=$1',[fc]);
    await db.query('delete from fc_profiles where id=$1',[fc]);
    await assert.rejects(rpc(db,'select assert_ux_mutation_actor_v1($1,$2,$3) result',['00000000002','fc',fc]), /actor not authorized/);
  } finally { await db.close(); }
});
test('approved documents, stale paths, other FC and inactive admin are protected before writes', async () => {
  const db = await fixture(); try {
    const before = await state(db);
    await assert.rejects(remove(db,'00000000004'));
    await assert.rejects(remove(db,'00000000002','changed-path'));
    await assert.rejects(rpc(db,'select remove_fc_document_atomic_v1($1,$2,$3,$4,$5) result',['00000000009','admin',fc,'required','synthetic-path']));
    assert.deepEqual(await state(db),before);
    await db.exec("update fc_documents set status='approved'");
    const approved = await state(db); await assert.rejects(remove(db));
    assert.deepEqual(await state(db),approved);
  } finally { await db.close(); }
});
test('request updates preserve uploaded excluded docs and commit new requirements plus deadline together', async () => {
  const db = await fixture(); try {
    assert.deepEqual(await update(db), {updated:true,cleanupPending:false});
    const result = await state(db);
    assert.deepEqual(result.documents.map(x=>x.doc_type),['new','required']);
    assert.equal(result.profile[0].status,'docs-requested');
    assert.equal(result.profile[0].docs_deadline_at.toISOString().slice(0,10),'2026-10-20');
    await update(db); assert.equal((await state(db)).documents.length,2);
  } finally { await db.close(); }
});
test('zero requirements failure preserves all documents, profile and cleanup receipt', async () => {
  const db = await fixture(); try {
    await db.exec("create function fail_profile() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end; $$; create trigger fail_profile before update on fc_profiles for each row execute function fail_profile();");
    const before = await state(db); await assert.rejects(update(db,[]), /synthetic failure/);
    assert.deepEqual(await state(db),before);
  } finally { await db.close(); }
});
test('zero requirements commits preserved reset policy and queued physical cleanup', async () => {
  const db = await fixture(); try {
    assert.deepEqual(await update(db,[]),{updated:true,cleanupPending:true});
    const result = await state(db); assert.equal(result.documents.length,0);
    assert.equal(result.profile[0].status,'allowance-consented');
    assert.equal(result.profile[0].docs_deadline_at,null);
    assert.equal(result.queue.length,1);
  } finally { await db.close(); }
});
test('round failure rolls back prior location deletion; registered rounds are protected; retries are idempotent', async () => {
  const db = await fixture(); try {
    await db.exec("create function fail_round() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end; $$; create trigger fail_round before delete on exam_rounds for each row execute function fail_round();");
    await assert.rejects(removeRound(db), /synthetic failure/);
    assert.equal((await db.query('select * from exam_locations')).rows.length,1);
    await db.exec('drop trigger fail_round on exam_rounds');
    await db.query('insert into exam_registrations(round_id) values($1)',[round]);
    await assert.rejects(removeRound(db));
    assert.equal((await db.query('select * from exam_locations')).rows.length,1);
    await db.exec('delete from exam_registrations');
    assert.deepEqual(await removeRound(db),{deleted:true,alreadyDeleted:false});
    assert.deepEqual(await removeRound(db),{deleted:true,alreadyDeleted:true});
  } finally { await db.close(); }
});
test('board lost response retries return one post; changed payload conflicts; separate intent creates another', async () => {
  const db = await fixture(); try {
    const create = (id=request,title='Synthetic') => rpc(db,'select create_board_post_idempotent_v1($1,$2,$3,$4,$5,$6,$7) result',['00000000001','admin','Synthetic',id,category,title,'Content']);
    const first = await create(); assert.deepEqual(await create(),first);
    await assert.rejects(create(request,'changed'));
    assert.equal((await db.query('select count(*)::int count from board_posts')).rows[0].count,1);
    await create('40000000-0000-4000-8000-000000000002');
    assert.equal((await db.query('select count(*)::int count from board_posts')).rows[0].count,2);
  } finally { await db.close(); }
});
test('notice lost response retries return one notice and payload mismatch cannot replace it', async () => {
  const db = await fixture(); try {
    const create = (title='Synthetic') => rpc(db,'select create_notice_idempotent_v1($1,$2,$3,$4) result',['00000000001','admin',request,{title,body:'Content',images:[],files:[]}]);
    const first = await create(); assert.deepEqual(await create(),first);
    await assert.rejects(create('Changed'));
    assert.equal((await db.query('select count(*)::int count from notices')).rows[0].count,1);
  } finally { await db.close(); }
});
test('public clients cannot invoke privileged RPCs or read receipt/cleanup records', async () => {
  const db = await fixture(); try {
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select remove_fc_document_atomic_v1($1,$2,$3,$4,$5)',['00000000002','fc',fc,'required','synthetic-path']));
    await assert.rejects(db.query('select * from ux_creation_receipts'));
    await assert.rejects(db.query('select * from fc_document_cleanup_queue'));
    await db.exec('reset role');
  } finally { await db.close(); }
});
