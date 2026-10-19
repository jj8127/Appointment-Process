import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import { fixtureSql, fc } from './ux-priority-one-fixture.mjs';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration=await readFile(new URL('../migrations/20261012072525_platform_common_membership.sql',import.meta.url),'utf8');
const hospitalMigration=await readFile(new URL('../migrations/20261012072611_hospital_directory_ad_performance.sql',import.meta.url),'utf8');
const recoveryMigration=await readFile(new URL('../migrations/20261012072614_platform_membership_recovery_consent.sql',import.meta.url),'utf8');
const smsDeliveryMigration=await readFile(new URL('../migrations/20261013094533_moduon_signup_sms_delivery_state.sql',import.meta.url),'utf8');
const extendedSmsDeliveryMigration=await readFile(new URL('../migrations/20261013094539_extend_sms_delivery_tracking.sql',import.meta.url),'utf8');
const checkOtpMigration=await readFile(new URL('../migrations/20261016040348_check_platform_signup_otp.sql',import.meta.url),'utf8');
const generations=await readFile(new URL('../migrations/20261004133155_credential_session_generations.sql',import.meta.url),'utf8');
const admin='90000000-0000-4000-8000-000000000001';
const hash=Buffer.alloc(32,3).toString('base64'), salt=Buffer.alloc(16,4).toString('base64');
async function fixture() {
  const db=new PGlite();
  await db.exec(fixtureSql);
  await db.exec(`alter table fc_profiles add column name text default 'Synthetic FC';
    alter table fc_profiles add column recommender_fc_id uuid;
    alter table admin_accounts add column id uuid default gen_random_uuid() unique;
    update admin_accounts set id='${admin}' where phone='00000000001';
    alter table admin_accounts add column staff_type text default 'admin';
    alter table admin_accounts add column name text default 'Synthetic Admin';
    alter table manager_accounts add column id uuid default gen_random_uuid() unique;
    alter table manager_accounts add column name text default 'Synthetic Manager';
    create table referral_codes(fc_id uuid,code text,is_active boolean);
  `);
  await db.exec(generations.slice(generations.indexOf('create or replace function public.advance_credential_session_version()'),
    generations.indexOf('-- The service verifies')));
  try {await db.exec(migration);await db.exec(hospitalMigration);await db.exec(recoveryMigration);await db.exec(smsDeliveryMigration);await db.exec(extendedSmsDeliveryMigration);await db.exec(checkOtpMigration);}
  catch(error) {await db.close();throw new Error(error.message);}
  return db;
}
async function rpc(db,sql,args=[]) {
  await db.exec('set role service_role');
  try{return (await db.query(sql,args)).rows[0].result;} finally{await db.exec('reset role');}
}
async function member(db,phone='00000000011',referral=null) {
  assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',[phone,hash])).ok,true);
  return rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',[phone,hash,'Synthetic Member',hash,salt,referral]);
}
async function partner(db,key='telecom',consumer=.5,referrer=.1,basis='after_consumer') {
  return rpc(db,'select save_platform_partner($1,$2,$3) result',[admin,{id:randomUUID(),serviceKey:key,name:'Synthetic Partner',region:'Synthetic Region',
    active:true,consumerRate:consumer,referrerRate:referrer,referrerBasis:basis},0]);
}
function hospitalInput(overrides={}) {
  return {id:randomUUID(),serviceKey:'hospital',name:'Synthetic Hospital',region:'서울 합성구',provinceCode:'11',district:'합성구',
    address:'Synthetic Address',phone:'00000000000',active:true,consumerRate:0,referrerRate:0,referrerBasis:'commission',
    adPeriodStart:'2026-01-01',adPeriodEnd:'2027-12-31',adPlacement:'regional_list',adFee:500000,
    specialties:['합성진료'],verifiedAt:'2026-01-01',materialApproved:true,reviewRequired:false,...overrides};
}

test('hospital directory uses structured regions, literal search, approved material and bounded pages',async()=>{
  const db=await fixture();try {
    const first=hospitalInput({name:'Synthetic 100% Hospital',adPlacement:'regional_featured'});
    const second=hospitalInput({name:'Synthetic Second',district:'다른구'});
    for(const input of [first,second,hospitalInput({active:false}),hospitalInput({adPeriodEnd:'2026-01-02'})])
      await rpc(db,'select save_platform_partner($1,$2,0) result',[admin,input]);
    const list=filters=>rpc(db,'select get_platform_hospitals($1,$2) result',['2026-10-11',filters]);
    const page=await list({provinceCode:'11',limit:1});
    assert.equal(page.hospitals.length,1);assert.equal(page.featured[0].id,first.id);assert.equal(page.hasMore,true);assert.equal(page.nextOffset,1);
    assert.equal((await list({provinceCode:'11',offset:1,limit:1})).nextOffset,null);
    assert.deepEqual((await list({provinceCode:'11',district:'합성구',specialty:'합성진료',search:'100%'})).hospitals.map(h=>h.id),[first.id]);
    assert.equal((await list({search:'%'})).hospitals.length,1);
    assert.equal((await list({provinceCode:'26'})).hospitals.length,0);
    assert.deepEqual((await list({})).regions,[{provinceCode:'11',districts:['다른구','합성구']}]);
    assert.deepEqual((await list({})).specialties,['합성진료']);
    assert.equal('adFee' in page.hospitals[0],false);assert.equal('last_request' in page.hospitals[0],false);
    const rotatingIds=Array.from({length:8},(_,i)=>`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
    for(const id of rotatingIds) await rpc(db,'select save_platform_partner($1,$2,0) result',
      [admin,hospitalInput({id,name:`Synthetic rotation ${id.slice(-1)}`,district:'순환구',adPlacement:'regional_featured'})]);
    const rotating=rotationBucket=>list({provinceCode:'11',district:'순환구',rotationBucket});
    const bucketA=await rotating('0'),bucketB=await rotating('1');
    assert.equal(bucketA.featured.length,5);assert.equal(bucketB.featured.length,5);
    assert.deepEqual((await rotating('0')).featured,bucketA.featured);
    assert.notDeepEqual(bucketA.featured.map(h=>h.id).sort(),bucketB.featured.map(h=>h.id).sort());
    assert.deepEqual(bucketA.hospitals.map(h=>h.id).sort(),rotatingIds);
    await assert.rejects(list({limit:51}),/invalid_input/);
    await assert.rejects(rpc(db,'select save_platform_partner($1,$2,0) result',[admin,hospitalInput({materialApproved:false})]),/invalid_partner/);
    await assert.rejects(rpc(db,'select save_platform_partner($1,$2,0) result',[admin,hospitalInput({reviewRequired:null})]),/invalid_partner/);
    await assert.rejects(rpc(db,'select save_platform_partner($1,$2,0) result',[admin,hospitalInput({reviewRequired:true,reviewNumber:'synthetic-review',reviewExpiresAt:'2026-01-01'})]),/invalid_partner/);
    await db.query('update platform_partners set review_required=true,review_number=$2,review_expires_at=$3 where id=$1',[first.id,'synthetic-review','2026-01-01']);
    assert.equal((await list({hospitalId:first.id})).hospitals.length,0);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from platform_hospital_events'),/permission denied/);
      await assert.rejects(db.query('insert into platform_hospital_events(event_id) values($1)',[randomUUID()]),/permission denied/);
      await assert.rejects(db.query("select get_platform_hospitals('2026-10-11','{}')"),/permission denied/);
      await assert.rejects(db.query("select get_platform_hospital_report($1,'2026-10-11','2026-10-11',null)",[admin]),/permission denied/);
      await db.exec('reset role');
    }
  } finally {await db.close();}
});

test('hospital event admission is retry safe, placement aware and reports immutable revisions without customer data',async()=>{
  const db=await fixture();try {
    const input=hospitalInput({adPlacement:'regional_featured'});
    await rpc(db,'select save_platform_partner($1,$2,0) result',[admin,input]);
    const session='a'.repeat(64),source='b'.repeat(64),eventId=randomUUID();
    const record=(revision=0,placement='regional_featured',type='impression',id=randomUUID(),digest=session)=>rpc(db,
      'select record_platform_hospital_event($1,$2,$3,$4,$5,$6,$7) result',[input.id,revision,placement,id,type,digest,source]);
    assert.equal((await record(0,'regional_featured','impression',eventId)).accepted,true);
    assert.equal((await record(0,'regional_featured','impression',eventId)).accepted,false);
    assert.equal((await record()).accepted,false);
    assert.equal((await record(0,'regional_list')).accepted,true);
    assert.equal((await record(0,'regional_list','phone')).accepted,true);
    await rpc(db,'select save_platform_partner($1,$2,0) result',[admin,{...input,name:'Renamed Synthetic',adPlacement:'regional_list'}]);
    assert.equal((await record()).accepted,false);
    assert.equal((await record(1,'regional_featured')).accepted,false);
    assert.equal((await record(1,'regional_list')).accepted,true);
    const today=(await db.query("select (now() at time zone 'Asia/Seoul')::date::text as today")).rows[0].today;
    const report=await rpc(db,'select get_platform_hospital_report($1,$2,$3,$4) result',[admin,today,today,input.id]);
    assert.deepEqual(report.totals,{impressions:3,detailViews:0,phoneClicks:1,directionsClicks:0});
    assert.equal(report.rows.some(r=>r.revision===0 && r.name==='Synthetic Hospital' && r.placement==='regional_featured'),true);
    assert.equal(report.rows.some(r=>r.revision===1 && r.name==='Renamed Synthetic' && r.placement==='regional_list'),true);
    assert.equal(JSON.stringify(report).includes('session_digest'),false);assert.equal(JSON.stringify(report).includes('source_digest'),false);
    for(let i=0;i<56;i++) assert.equal((await record(1,'regional_list','detail',randomUUID(),(i+1).toString(16).padStart(64,'0'))).accepted,true);
    assert.equal((await record(1,'regional_list','detail',randomUUID(),'c'.repeat(64))).accepted,false);
    await assert.rejects(rpc(db,'select get_platform_hospital_report($1,$2,$3,$4) result',[randomUUID(),today,today,input.id]),/forbidden/);
    await assert.rejects(rpc(db,'select get_platform_hospital_report($1,$2,$3,$4) result',[admin,'2026-01-01','2026-12-31',input.id]),/invalid_input/);
    await db.query('update platform_partners set active=false where id=$1',[input.id]);
    assert.equal((await record(1,'regional_list','detail')).accepted,false);
  } finally {await db.close();}
});
async function apply(db,id,key='telecom',nonce='20000000-0000-4000-8000-000000000011') {
  return rpc(db,'select create_platform_application($1,$2,$3,$4) result',[id,key,{region:'Synthetic Region',requestType:'information'},nonce]);
}
const settle=(db,a,p,amount=500000,nonce='30000000-0000-4000-8000-000000000011',transaction='test-transaction')=>rpc(db,
  'select settle_platform_application($1,$2,$3,$4,$5,$6,$7,$8) result',
  [admin,a,p,amount,'2026-01-01T00:00:00Z',nonce,transaction,'test-settlement-evidence']);

test('the separate code check shares the signup lock and leaves the challenge for signup',async()=>{
  const db=await fixture();try{
    const check=(phone,code)=>rpc(db,'select check_platform_signup_otp($1,$2) result',[phone,code]);
    await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000014',hash]);
    assert.equal((await check('00000000014',null)).code,'invalid_code');
    assert.equal((await check('00000000014',hash)).ok,true);
    // A confirmed code is not consumed: signup still verifies and uses it.
    assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000014',hash,'Synthetic',hash,salt,null])).ok,true);
    await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000015',hash]);
    for(let n=0;n<5;n++) assert.equal((await check('00000000015',null)).code,'invalid_code');
    assert.equal((await check('00000000015',hash)).code,'locked');
    assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000015',hash,'Synthetic',hash,salt,null])).code,'locked');
    assert.equal((await check('00000000099',hash)).code,'expired_code');
    await db.exec('set role anon');
    await assert.rejects(db.query('select check_platform_signup_otp($1,$2)',['00000000014',hash]),/permission denied/);
    await db.exec('reset role');
  }finally{await db.close();}
});

test('minimal signup consumes OTP atomically, locks attempts, and has no FC or direct client privilege',async()=>{
  const db=await fixture();try{
    const before=Number((await db.query('select count(*) n from fc_profiles')).rows[0].n);
    await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000011',hash]);
    assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000011',hash])).code,'cooldown');
    const created=await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000011',hash,'Synthetic',hash,salt,null]);
    assert.equal(created.ok,true);
    assert.equal((await rpc(db,'select platform_login_attempt($1,$2) result',[created.memberId,null])).ok,false);
    assert.equal((await rpc(db,'select platform_login_attempt($1,$2) result',[created.memberId,hash])).sessionVersion,0);
    await db.query('update platform_member_credentials set password_salt=$1,session_version=999 where member_id=$2',[Buffer.alloc(16,9).toString('base64'),created.memberId]);
    assert.equal(Number((await db.query('select session_version from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].session_version),1);
    assert.equal(Number((await db.query('select count(*) n from fc_profiles')).rows[0].n),before);
    const retry=await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000011',hash,'Synthetic',hash,Buffer.alloc(16,9).toString('base64'),null]);
    assert.equal(retry.memberId,created.memberId);assert.equal(Number(retry.sessionVersion),1);
    assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000011',hash,'Synthetic',Buffer.alloc(32,9).toString('base64'),salt,null])).code,'already_exists');
    await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000012',hash]);
    for(let n=0;n<5;n++) assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000012',null,'Synthetic',hash,salt,null])).code,'invalid_code');
    assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',['00000000012',hash,'Synthetic',hash,salt,null])).code,'locked');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from platform_members'),/permission denied/);
    await assert.rejects(db.query('select issue_platform_signup_otp($1,$2)',['00000000013',hash]),/permission denied/);
    await db.exec('reset role');
    const rls=(await db.query("select relname,relrowsecurity from pg_class where relname like 'platform_%' and relkind='r'")).rows;
    assert.equal(rls.length,9);assert.ok(rls.every(row=>row.relrowsecurity));
  }finally{await db.close();}
});

test('SMS delivery finalization tracks NCP acceptance and compensates only the current rejected OTP generation',async()=>{
  const db=await fixture();try {
    const phone='00000000031';
    const first=await rpc(db,'select issue_platform_signup_otp($1,$2) result',[phone,hash]);
    assert.equal(first.ok,true);assert.match(first.deliveryId,/^[0-9a-f-]{36}$/);
    const accepted=await rpc(db,'select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6) result',
      [phone,first.deliveryId,'accepted','synthetic-ncp-request-1','202',null]);
    assert.deepEqual(accepted,{ok:true,current:true});
    const attempt=(await db.query('select purpose,state,provider_request_id,provider_status_code,failure_reason from platform_sms_delivery_attempts where id=$1',[first.deliveryId])).rows[0];
    assert.deepEqual(attempt,{purpose:'signup',state:'accepted',provider_request_id:'synthetic-ncp-request-1',provider_status_code:'202',failure_reason:null});
    assert.equal((await db.query('select delivery_id from platform_signup_challenges where phone=$1',[phone])).rows[0].delivery_id,first.deliveryId);

    const rejectedPhone='00000000032';
    const rejectedIssue=await rpc(db,'select issue_platform_signup_otp($1,$2) result',[rejectedPhone,hash]);
    assert.equal((await rpc(db,'select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6) result',
      [rejectedPhone,rejectedIssue.deliveryId,'rejected',null,'400','provider_rejected'])).ok,true);
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where phone=$1',[rejectedPhone])).rows[0].n),0);
    assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',[rejectedPhone,hash])).ok,true);

    const stalePhone='00000000033';
    const stale=await rpc(db,'select issue_platform_signup_otp($1,$2) result',[stalePhone,hash]);
    await db.query("update platform_signup_challenges set sent_at=clock_timestamp()-interval '61 seconds' where phone=$1",[stalePhone]);
    const current=await rpc(db,'select issue_platform_signup_otp($1,$2) result',[stalePhone,Buffer.alloc(32,5).toString('base64')]);
    assert.notEqual(current.deliveryId,stale.deliveryId);
    assert.equal((await rpc(db,'select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6) result',
      [stalePhone,stale.deliveryId,'rejected',null,'400','provider_rejected'])).code,'stale_delivery');
    assert.equal((await db.query('select delivery_id from platform_signup_challenges where phone=$1',[stalePhone])).rows[0].delivery_id,current.deliveryId);

    const unknownPhone='00000000034';
    const unknown=await rpc(db,'select issue_platform_signup_otp($1,$2) result',[unknownPhone,hash]);
    assert.equal((await rpc(db,'select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6) result',
      [unknownPhone,unknown.deliveryId,'unknown',null,null,'timeout'])).ok,true);
    assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',[unknownPhone,hash])).code,'cooldown');
    assert.equal((await rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',
      [unknownPhone,hash,'Synthetic Unknown',hash,salt,null])).ok,true);
    assert.equal((await rpc(db,'select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6) result',
      [unknownPhone,unknown.deliveryId,'rejected',null,'400','provider_rejected'])).code,'already_consumed');
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where phone=$1',[unknownPhone])).rows[0].n),1);

    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from platform_sms_delivery_attempts'),/permission denied/);
      await assert.rejects(db.query('select finalize_platform_signup_otp_delivery($1,$2,$3,$4,$5,$6)',
        [phone,first.deliveryId,'accepted',null,'202',null]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});

test('FC signup and password reset share a PII-free, service-only SMS delivery ledger',async()=>{
  const db=await fixture();try {
    const fc=await rpc(db,'select begin_platform_sms_delivery_attempt($1) result',['fc_signup']);
    const reset=await rpc(db,'select begin_platform_sms_delivery_attempt($1) result',['password_reset']);
    assert.match(fc.deliveryId,/^[0-9a-f-]{36}$/);assert.match(reset.deliveryId,/^[0-9a-f-]{36}$/);

    assert.deepEqual(await rpc(db,'select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6) result',
      [fc.deliveryId,'fc_signup','accepted','synthetic-fc-request','202',null]),{ok:true});
    assert.deepEqual(await rpc(db,'select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6) result',
      [reset.deliveryId,'password_reset','unknown',null,null,'timeout']),{ok:true});

    const rows=(await db.query(`select purpose,state,provider_request_id,provider_status_code,failure_reason,
      completed_at is not null completed from platform_sms_delivery_attempts
      where id in ($1,$2) order by purpose`,[fc.deliveryId,reset.deliveryId])).rows;
    assert.deepEqual(rows,[
      {purpose:'fc_signup',state:'accepted',provider_request_id:'synthetic-fc-request',provider_status_code:'202',failure_reason:null,completed:true},
      {purpose:'password_reset',state:'unknown',provider_request_id:null,provider_status_code:null,failure_reason:'timeout',completed:false},
    ]);
    assert.equal((await rpc(db,'select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6) result',
      [fc.deliveryId,'fc_signup','accepted','synthetic-fc-request','202',null])).code,'delivery_not_pending');
    assert.equal((await rpc(db,'select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6) result',
      [reset.deliveryId,'fc_signup','rejected',null,'400','provider_rejected'])).code,'delivery_not_pending');
    await assert.rejects(rpc(db,'select begin_platform_sms_delivery_attempt($1) result',['signup']),/invalid_input/);
    await assert.rejects(rpc(db,'select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6) result',
      [reset.deliveryId,'password_reset','accepted',null,'202',null]),/invalid_input/);

    const columns=(await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='platform_sms_delivery_attempts' order by column_name`)).rows.map(row=>row.column_name);
    assert.equal(columns.some(name=>/phone|message|code_hash|token/i.test(name)),false);

    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select begin_platform_sms_delivery_attempt($1)',['fc_signup']),/permission denied/);
      await assert.rejects(db.query('select finalize_platform_sms_delivery_attempt($1,$2,$3,$4,$5,$6)',
        [reset.deliveryId,'password_reset','unknown',null,null,'timeout']),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}

  const schema=(await readFile(new URL('../schema.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  assert.ok(schema.includes(`-- Migration: extended SMS delivery tracking (20261013094539).\n${extendedSmsDeliveryMigration.replaceAll('\r\n','\n')}`));
});

test('one shared referral code spans service interests; snapshots and idempotency survive later graph changes',async()=>{
  const db=await fixture();try{
    const inviter=await member(db);
    const code=(await db.query('select referral_code from platform_members where id=$1',[inviter.memberId])).rows[0].referral_code;
    const buyer=await member(db,'00000000012',code);
    const a=await apply(db,buyer.memberId);
    assert.deepEqual(await apply(db,buyer.memberId),a);
    await assert.rejects(rpc(db,'select create_platform_application($1,$2,$3,$4) result',[buyer.memberId,'care',{},'20000000-0000-4000-8000-000000000012']),/invalid_details/);
    await assert.rejects(apply(db,buyer.memberId,'care'),/idempotency_conflict/);
    await db.query('update platform_members set referrer_id=null where id=$1',[buyer.memberId]);
    const p=await partner(db);
    const first=await settle(db,a.applicationId,p.partnerId,500000,undefined,'  test-transaction  ');
    const repeat=await settle(db,a.applicationId,p.partnerId);
    assert.deepEqual(first,repeat);
    assert.equal(Date.parse(first.dueAt)-Date.parse('2026-01-01T00:00:00Z'),7*86400000);
    const benefits=(await db.query('select member_id,kind,amount from platform_member_benefits order by kind')).rows;
    assert.deepEqual(benefits.map(row=>[row.kind,Number(row.amount)]),[['consumer',250000],['direct_referrer',25000]]);
    assert.equal(benefits[1].member_id,inviter.memberId);
    await assert.rejects(settle(db,a.applicationId,p.partnerId,500001),/idempotency_conflict/);
    await assert.rejects(rpc(db,'select cancel_platform_application($1,$2) result',[buyer.memberId,a.applicationId]),/settled_cancellation/);
    await db.query('update admin_accounts set staff_type=$1 where id=$2',['developer',admin]);
    await assert.rejects(partner(db),/forbidden/);
  }finally{await db.close();}
});

test('consumer password recovery is single use, expires, locks guesses, revokes sessions and never grants FC recovery',async()=>{
  const db=await fixture();try {
    const created=await member(db),changedHash=Buffer.alloc(32,7).toString('base64'),changedSalt=Buffer.alloc(16,7).toString('base64');
    const reset=(action,token=hash)=>rpc(db,'select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result',
      [action,'member',created.memberId,'00000000011',token,changedHash,changedSalt]);
    assert.equal((await reset('consume')).code,'invalid_token');
    assert.equal((await reset('issue')).ok,true);
    assert.equal((await rpc(db,'select cancel_password_reset_challenge($1,$2,$3,$4) result',
      ['member',created.memberId,'00000000011',changedHash])).code,'stale_challenge');
    assert.equal((await rpc(db,'select cancel_password_reset_challenge($1,$2,$3,$4) result',
      ['member',created.memberId,'00000000011',hash])).ok,true);
    assert.equal((await reset('issue')).ok,true);
    assert.equal((await reset('issue')).code,'cooldown');
    for(let i=0;i<5;i++) assert.equal((await reset('consume',changedHash)).code,i===4 ? 'attempts_exhausted' : 'invalid_token');
    assert.equal((await reset('consume')).code,'attempts_exhausted');
    await db.query("update platform_member_credentials set reset_sent_at=now()-interval '61 seconds' where member_id=$1",[created.memberId]);
    assert.equal((await reset('issue')).ok,true);
    await db.query("update platform_member_credentials set reset_token_expires_at=now()-interval '1 second' where member_id=$1",[created.memberId]);
    assert.equal((await reset('consume')).code,'expired_token');
    await db.query("update platform_member_credentials set reset_sent_at=now()-interval '61 seconds' where member_id=$1",[created.memberId]);
    await reset('issue');
    assert.equal((await reset('consume')).ok,true);
    assert.equal((await reset('consume')).code,'invalid_token');
    assert.equal((await reset('issue')).code,'cooldown');
    assert.equal((await rpc(db,'select platform_login_attempt($1,$2) result',[created.memberId,hash])).ok,false);
    assert.equal(Number((await rpc(db,'select platform_login_attempt($1,$2) result',[created.memberId,changedHash])).sessionVersion),1);
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000011','Synthetic promoted FC',true)",['10000000-0000-4000-8000-000000000099']);
    assert.equal((await reset('issue')).code,'account_unavailable');
    const second=await member(db,'00000000012');
    await rpc(db,'select delete_platform_member($1) result',[second.memberId]);
    assert.equal((await rpc(db,'select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7) result',
      ['issue','member',second.memberId,'00000000012',hash,null,null])).code,'account_unavailable');
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select process_password_reset_challenge($1,$2,$3,$4,$5,$6,$7)',
        ['issue','member',created.memberId,'00000000011',hash,null,null]),/permission denied/);
      await assert.rejects(db.query('select enroll_platform_legacy_member($1,$2,$3,$4)',
        ['00000000002','Synthetic FC',fc,'2026-10-12']),/permission denied/);
      await db.exec('reset role');
    }
  } finally {await db.close();}
});

test('auth cleanup removes expired receipts while preserving live codes and active guess locks',async()=>{
  const db=await fixture();try {
    const created=await member(db);
    for(const phone of ['00000000012','00000000013','00000000014']) await rpc(db,'select issue_platform_signup_otp($1,$2) result',[phone,hash]);
    await db.query("update platform_signup_challenges set expires_at=now()-interval '1 second' where phone<>$1",['00000000014']);
    await db.query("update platform_signup_challenges set locked_until=now()+interval '9 minutes' where phone=$1",['00000000013']);
    await rpc(db,'select process_password_reset_challenge($1,$2,$3,$4,$5) result',['issue','member',created.memberId,'00000000011',hash]);
    await db.query("update platform_member_credentials set reset_token_expires_at=now()-interval '1 second' where member_id=$1",[created.memberId]);
    await rpc(db,'select cleanup_platform_auth_challenges() result');
    assert.deepEqual((await db.query('select phone from platform_signup_challenges order by phone')).rows.map(r=>r.phone),['00000000013','00000000014']);
    const credential=(await db.query('select reset_token_hash,reset_token_expires_at,reset_sent_at,reset_failed_count,session_version from platform_member_credentials where member_id=$1',[created.memberId])).rows[0];
    assert.equal(credential.reset_token_hash,null);assert.equal(credential.reset_token_expires_at,null);assert.equal(credential.reset_sent_at,null);
    assert.equal(Number(credential.session_version),0);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);await assert.rejects(db.query('select cleanup_platform_auth_challenges()'),/permission denied/);await db.exec('reset role');
    }
    const canonical=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
    assert.ok(canonical.replaceAll('\r\n','\n').includes(recoveryMigration.replaceAll('\r\n','\n')));
    assert.ok(canonical.replaceAll('\r\n','\n').includes(smsDeliveryMigration.replaceAll('\r\n','\n')));
    const schedule=await readFile(new URL('../migrations/20261012072615_platform_auth_cleanup_schedule.sql',import.meta.url),'utf8');
    assert.match(schedule,/create extension if not exists pg_cron with schema pg_catalog/);
    assert.match(schedule,/cron\.schedule\('platform-auth-challenge-cleanup','\*\/5 \* \* \* \*'/);
    assert.ok(canonical.replaceAll('\r\n','\n').includes(schedule.replaceAll('\r\n','\n')));
  } finally {await db.close();}
});

test('partner edits require revision; hospital advertising and insurance intake never generate referral payments',async()=>{
  const db=await fixture();try{
    const p=await partner(db);
    const input={id:p.partnerId,serviceKey:'telecom',name:'Synthetic edit',region:'Synthetic',active:false,consumerRate:.4,referrerRate:.1,referrerBasis:'commission'};
    assert.equal((await rpc(db,'select save_platform_partner($1,$2,$3) result',[admin,input,0])).revision,1);
    assert.equal((await rpc(db,'select save_platform_partner($1,$2,$3) result',[admin,input,0])).revision,1);
    await assert.rejects(rpc(db,'select save_platform_partner($1,$2,$3) result',[admin,{...input,name:'Different edit'},0]),/revision_conflict/);
    await assert.rejects(partner(db,'hospital',0,.1),/check constraint|invalid_partner/);
    await assert.rejects(partner(db,'hospital',0,0),/check constraint|invalid_partner/);
    const ad=await rpc(db,'select save_platform_partner($1,$2,$3) result',[admin,{id:randomUUID(),serviceKey:'hospital',name:'Synthetic Hospital',region:'Synthetic',
      active:true,consumerRate:0,referrerRate:0,referrerBasis:'commission',adPeriodStart:'2026-01-01',adPeriodEnd:'2026-12-31',adPlacement:'regional_list',adFee:500000,
      provinceCode:'11',district:'합성구',address:'Synthetic Address',verifiedAt:'2026-01-01',materialApproved:true,reviewRequired:false},0]);
    const buyer=await member(db);const a=await apply(db,buyer.memberId,'insurance');const insurance=await partner(db,'insurance',0,0);
    await assert.rejects(settle(db,a.applicationId,insurance.partnerId),/partner_unavailable/);
    await assert.rejects(settle(db,a.applicationId,ad.partnerId),/partner_unavailable/);
    assert.equal(Number((await db.query('select count(*) n from platform_member_benefits')).rows[0].n),0);
  }finally{await db.close();}
});

test('care direct referral uses configured basis and recorded transfers are idempotent',async()=>{
  const db=await fixture();try{
    const inviter=await member(db);const code=(await db.query('select referral_code from platform_members where id=$1',[inviter.memberId])).rows[0].referral_code;
    const buyer=await member(db,'00000000012',code);const a=await apply(db,buyer.memberId,'care');const p=await partner(db,'care',0,.5);
    await settle(db,a.applicationId,p.partnerId,10000);
    const reward=(await db.query("select id,amount from platform_member_benefits where kind='direct_referrer'")).rows[0];
    assert.equal(Number(reward.amount),5000);
    const args=[admin,reward.id,'2026-01-02T00:00:00Z','synthetic-transfer'];
    const first=await rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',args);
    assert.deepEqual(await rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',args),first);
    await assert.rejects(rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',[...args.slice(0,3),'different-transfer']),/idempotency_conflict/);
  }finally{await db.close();}
});

test('FC mapping preserves member identity across phone edits and consumer promotion retains shared referrer',async()=>{
  const db=await fixture();try{
    assert.equal(Number((await db.query('select count(*) n from platform_members where fc_id=$1',[fc])).rows[0].n),0);
    await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4) result',['00000000002','Synthetic FC',fc,'2026-10-12']);
    const mapped=(await db.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id;
    await db.query("update fc_profiles set phone='00000000020' where id=$1",[fc]);
    assert.equal((await db.query('select id from platform_members where phone=$1',['00000000020'])).rows[0].id,mapped);
    const inviter=await member(db);const code=(await db.query('select referral_code from platform_members where id=$1',[inviter.memberId])).rows[0].referral_code;
    const buyer=await member(db,'00000000012',code);
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000012','Synthetic FC',true)",['10000000-0000-4000-8000-000000000012']);
    assert.equal((await db.query('select referrer_id from platform_members where id=$1',[buyer.memberId])).rows[0].referrer_id,inviter.memberId);
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[buyer.memberId])).rows[0].n),0);
    await assert.rejects(db.query('update platform_members set referrer_id=$1 where id=$2',[buyer.memberId,inviter.memberId]),/referral_cycle/);
    await db.query('delete from fc_documents where fc_id=$1',[fc]);
    await db.query('delete from fc_profiles where id=$1',[fc]);
    const erased=(await db.query('select phone,name,active,fc_id from platform_members where id=$1',[mapped])).rows[0];
    assert.deepEqual(erased,{phone:null,name:'탈퇴 회원',active:false,fc_id:null});
    assert.equal((await rpc(db,'select delete_platform_member($1) result',[inviter.memberId])).deleted,true);
    assert.equal((await db.query('select phone,active from platform_members where id=$1',[inviter.memberId])).rows[0].phone,null);
  }finally{await db.close();}
});

test('common withdrawal preserves FC work and erases signup receipts after promotion and phone changes',async()=>{
  const db=await fixture();try {
    const created=await member(db),promoted='10000000-0000-4000-8000-000000000021';
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000011','Synthetic FC',true)",[promoted]);
    await db.query("update fc_profiles set phone='00000000021' where id=$1",[promoted]);
    const application=await apply(db,created.memberId);
    assert.equal((await rpc(db,'select delete_platform_member($1) result',[created.memberId])).deleted,true);
    assert.equal((await db.query('select phone from fc_profiles where id=$1',[promoted])).rows[0].phone,'00000000021');
    const erased=(await db.query('select phone,name,active,fc_id,terms_version,terms_accepted_at from platform_members where id=$1',[created.memberId])).rows[0];
    assert.deepEqual(erased,{phone:null,name:'탈퇴 회원',active:false,fc_id:null,terms_version:null,terms_accepted_at:null});
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges')).rows[0].n),0);
    assert.equal((await db.query('select status,details from platform_service_applications where id=$1',[application.applicationId])).rows[0].status,'cancelled');
    await db.query("update fc_profiles set name='Synthetic changed FC' where id=$1",[promoted]);
    assert.equal((await db.query('select phone from platform_members where id=$1',[created.memberId])).rows[0].phone,null);
    await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4) result',['00000000021','Synthetic changed FC',promoted,'2026-10-12']);
    const reenrolled=(await db.query('select id from platform_members where fc_id=$1',[promoted])).rows[0].id;
    assert.notEqual(reenrolled,created.memberId);
    await db.query("insert into platform_signup_challenges(phone,code_hash,expires_at,consumed_member_id) values('00000000011',$1,now()+interval '5 minutes',$2)",[hash,reenrolled]);
    await db.query('delete from fc_profiles where id=$1',[promoted]);
    assert.equal((await db.query('select active,phone from platform_members where id=$1',[reenrolled])).rows[0].active,false);
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges')).rows[0].n),0);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);await assert.rejects(db.query('select delete_platform_member($1)',[reenrolled]),/permission denied/);await db.exec('reset role');
    }
  } finally {await db.close();}
});

test('staff enrollment and deletion use the verified source while common withdrawal leaves staff work intact',async()=>{
  const db=await fixture();try {
    for(const [kind,table,phone,changedPhone] of [['admin','admin_accounts','00000000001','00000000031'],['manager','manager_accounts','00000000003','00000000033']]) {
      const id=(await db.query(`select id from ${table} where phone=$1`,[phone])).rows[0].id;
      const enroll=()=>rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4,$5,$6) result',[phone,'Synthetic Staff',null,'2026-10-12',kind,id]);
      await assert.rejects(rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4,$5,$6) result',[phone,'Synthetic Staff',null,'2026-10-12',kind,randomUUID()]),/forbidden/);
      await enroll();
      let mapped=(await db.query('select id from platform_members where staff_account_id=$1',[id])).rows[0].id;
      if(kind==='manager') {
        const shadow='10000000-0000-4000-8000-000000000033';
        await db.query('insert into fc_profiles(id,phone,name,signup_completed) values($1,$2,$3,true)',[shadow,phone,'Synthetic manager FC']);
        await db.query("update fc_profiles set name='Synthetic FC changed' where id=$1",[shadow]);
        assert.equal((await db.query('select fc_id from platform_members where id=$1',[mapped])).rows[0].fc_id,null);
        await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4,$5,$6) result',[phone,'Synthetic FC changed',shadow,'2026-10-12','fc',shadow]);
        assert.equal((await db.query('select id from platform_members where fc_id=$1',[shadow])).rows[0].id,mapped);
        await enroll();
        assert.equal((await db.query('select id from platform_members where staff_account_id=$1',[id])).rows[0].id,mapped);
        assert.equal((await db.query('select fc_id from platform_members where id=$1',[mapped])).rows[0].fc_id,null);
      }
      await rpc(db,'select delete_platform_member($1) result',[mapped]);
      assert.equal(Number((await db.query(`select count(*) n from ${table} where id=$1`,[id])).rows[0].n),1);
      await enroll();
      const current=(await db.query('select id from platform_members where staff_account_id=$1',[id])).rows[0].id;
      assert.notEqual(current,mapped);mapped=current;
      await db.query(`update ${table} set phone=$1,name='Synthetic changed Staff' where id=$2`,[changedPhone,id]);
      assert.equal((await db.query('select phone from platform_members where id=$1',[mapped])).rows[0].phone,changedPhone);
      await db.query("insert into platform_signup_challenges(phone,code_hash,expires_at,consumed_member_id) values($1,$2,now()+interval '5 minutes',$3)",[phone,hash,mapped]);
      await db.query(`delete from ${table} where id=$1`,[id]);
      const erased=(await db.query('select phone,active,staff_account_id,terms_version from platform_members where id=$1',[mapped])).rows[0];
      assert.deepEqual(erased,{phone:null,active:false,staff_account_id:null,terms_version:null});
      assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where consumed_member_id=$1',[mapped])).rows[0].n),0);
    }
  } finally {await db.close();}
});
