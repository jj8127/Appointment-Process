import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import { preparePlatformMembershipFixture, fc } from './ux-priority-one-fixture.mjs';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const recoveryMigration=await readFile(new URL('../migrations/20261012072614_platform_membership_recovery_consent.sql',import.meta.url),'utf8');
const smsDeliveryMigration=await readFile(new URL('../migrations/20261013094533_moduon_signup_sms_delivery_state.sql',import.meta.url),'utf8');
const extendedSmsDeliveryMigration=await readFile(new URL('../migrations/20261013094539_extend_sms_delivery_tracking.sql',import.meta.url),'utf8');
const enrollmentMigration=await readFile(new URL('../migrations/20261014043557_unified_common_insurance_enrollment.sql',import.meta.url),'utf8');
const withdrawalMigration=await readFile(new URL('../migrations/20261014073458_platform_affiliate_account_withdrawal.sql',import.meta.url),'utf8');
const checkOtpMigration=await readFile(new URL('../migrations/20261016040348_check_platform_signup_otp.sql',import.meta.url),'utf8');
const insuranceOnlyWithdrawalMigration=await readFile(new URL('../migrations/20261016090000_platform_insurance_only_withdrawal.sql',import.meta.url),'utf8');
const careRequestMigration=await readFile(new URL('../migrations/20261020100000_platform_hospital_care_requests.sql',import.meta.url),'utf8');
const admin='90000000-0000-4000-8000-000000000001';
const hash=Buffer.alloc(32,3).toString('base64'), salt=Buffer.alloc(16,4).toString('base64');
async function fixture(seedSql='',withWithdrawal=false) {
  const db=new PGlite();
  try {await preparePlatformMembershipFixture(db,{seedSql,withWithdrawal,admin,hash,salt});return db;}
  catch(error){await db.close();throw error;}
}
async function rpc(db,sql,args=[]) {
  await db.exec('set role service_role');
  try{return (await db.query(sql,args)).rows[0].result;} finally{await db.exec('reset role');}
}
async function member(db,phone='00000000011',referral=null) {
  assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',[phone,hash])).ok,true);
  return rpc(db,'select register_platform_member($1,$2,$3,$4,$5,$6) result',[phone,hash,'Synthetic Member',hash,salt,referral]);
}
async function serviceCode(db,id,key='care') {
  return (await rpc(db,'select ensure_platform_service_referral_code_v1($1,$2) result',[id,key])).code;
}
async function careMember(db,phone,code) {
  assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',[phone,hash])).ok,true);
  return rpc(db,'select register_platform_member_v2($1,$2,$3,$4,$5,$6,$7) result',[phone,hash,'Synthetic Member',hash,salt,'care',code]);
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
    await db.exec(checkOtpMigration);
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
    assert.equal(rls.length,12);assert.ok(rls.every(row=>row.relrowsecurity));
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

test('service referrers stay with their own service; snapshots and idempotency survive later graph changes',async()=>{
  const db=await fixture();try{
    const inviter=await member(db);
    const commonCode=(await db.query('select referral_code from platform_members where id=$1',[inviter.memberId])).rows[0].referral_code;
    const code=await serviceCode(db,inviter.memberId);
    assert.match(code,/^S[0-9A-F]{11}$/);
    assert.equal(await serviceCode(db,inviter.memberId),code);
    const buyer=await careMember(db,'00000000012',code);
    assert.equal((await db.query('select referrer_id from platform_members where id=$1',[buyer.memberId])).rows[0].referrer_id,null);
    const telecom=await apply(db,buyer.memberId);
    const a=await apply(db,buyer.memberId,'care','20000000-0000-4000-8000-000000000013');
    assert.deepEqual(await apply(db,buyer.memberId,'care','20000000-0000-4000-8000-000000000013'),a);
    await assert.rejects(rpc(db,'select create_platform_application($1,$2,$3,$4) result',[buyer.memberId,'care',{},'20000000-0000-4000-8000-000000000012']),/invalid_details/);
    await assert.rejects(apply(db,buyer.memberId,'care'),/idempotency_conflict/);
    const snapshots=(await db.query('select service_key,referrer_id_snapshot from platform_service_applications where member_id=$1 order by service_key',[buyer.memberId])).rows;
    assert.deepEqual(snapshots.map(row=>[row.service_key,row.referrer_id_snapshot]),[['care',inviter.memberId],['telecom',null]]);
    // A legacy common referrer is history only and never pays a service referral.
    const legacy=await member(db,'00000000013',commonCode);
    assert.equal((await db.query('select referrer_id from platform_members where id=$1',[legacy.memberId])).rows[0].referrer_id,inviter.memberId);
    const legacyCare=await apply(db,legacy.memberId,'care','20000000-0000-4000-8000-000000000014');
    assert.equal((await db.query('select referrer_id_snapshot from platform_service_applications where id=$1',[legacyCare.applicationId])).rows[0].referrer_id_snapshot,null);
    await db.query('delete from platform_service_referrals where member_id=$1',[buyer.memberId]);
    const p=await partner(db,'care');
    const first=await settle(db,a.applicationId,p.partnerId,500000,undefined,'  test-transaction  ');
    const repeat=await settle(db,a.applicationId,p.partnerId);
    assert.deepEqual(first,repeat);
    assert.equal(Date.parse(first.dueAt)-Date.parse('2026-01-01T00:00:00Z'),7*86400000);
    const t=await partner(db);
    await settle(db,telecom.applicationId,t.partnerId,500000,'30000000-0000-4000-8000-000000000012','telecom-transaction');
    const benefits=(await db.query("select member_id,kind,amount from platform_member_benefits where kind='direct_referrer'")).rows;
    assert.deepEqual(benefits.map(row=>[row.member_id,Number(row.amount)]),[[inviter.memberId,25000]]);
    await assert.rejects(settle(db,a.applicationId,p.partnerId,500001),/idempotency_conflict/);
    await assert.rejects(rpc(db,'select cancel_platform_application($1,$2) result',[buyer.memberId,a.applicationId]),/settled_cancellation/);
    await db.query('update admin_accounts set staff_type=$1 where id=$2',['developer',admin]);
    await assert.rejects(partner(db),/forbidden/);
  }finally{await db.close();}
});

test('service referral binding is first-wins, cycle-free, consent-gated and rolls back an unusable signup code',async()=>{
  const db=await fixture();try{
    const inviter=await member(db);const code=await serviceCode(db,inviter.memberId);
    const commonCode=(await db.query('select referral_code from platform_members where id=$1',[inviter.memberId])).rows[0].referral_code;
    const other=await member(db,'00000000013');const otherCode=await serviceCode(db,other.memberId);
    const signup=referral=>rpc(db,'select register_platform_member_v2($1,$2,$3,$4,$5,$6,$7) result',
      ['00000000012',hash,'Synthetic Member',hash,salt,'care',referral]);
    assert.equal((await rpc(db,'select issue_platform_signup_otp($1,$2) result',['00000000012',hash])).ok,true);
    await assert.rejects(signup('SFFFFFFFFFFF'),/invalid_referral/);
    assert.equal(Number((await db.query("select count(*) n from platform_members where phone='00000000012'")).rows[0].n),0);
    const buyer=await signup(code);
    assert.equal(buyer.ok,true);
    assert.equal((await signup(code)).memberId,buyer.memberId);
    const bind=(id,referral,source='manual',key='care')=>rpc(db,'select bind_platform_service_referral_v1($1,$2,$3,$4) result',[id,key,referral,source]);
    assert.deepEqual(await bind(buyer.memberId,code),{ok:true,serviceKey:'care',alreadyBound:true});
    assert.deepEqual(await bind(buyer.memberId,otherCode),{ok:false,code:'referral_already_bound'});
    await assert.rejects(signup(otherCode),/invalid_referral/);
    const telecomCode=await serviceCode(db,other.memberId,'telecom');
    assert.deepEqual(await bind(buyer.memberId,telecomCode,'manual','telecom'),{ok:true,serviceKey:'telecom',alreadyBound:false});
    assert.deepEqual(await bind(inviter.memberId,telecomCode),{ok:false,code:'invalid_referral'});
    assert.deepEqual(await bind(inviter.memberId,code),{ok:false,code:'invalid_referral'});
    assert.deepEqual(await bind(inviter.memberId,await serviceCode(db,buyer.memberId)),{ok:false,code:'invalid_referral'});
    await assert.rejects(bind(inviter.memberId,code,'admin'),/invalid_input/);
    assert.deepEqual(await bind(other.memberId,commonCode,'manual','telecom'),{ok:false,code:'invalid_referral'});
    assert.deepEqual(await bind(other.memberId,commonCode.toLowerCase(),'invite_confirmed'),{ok:true,serviceKey:'care',alreadyBound:false});
    assert.deepEqual(await rpc(db,'select preview_platform_service_referral_v1($1,$2,$3) result',[other.memberId,'care',code]),
      {ok:true,serviceKey:'care',referrerName:'Synthetic Member'});
    const state=await rpc(db,'select get_platform_service_referral_v1($1,$2) result',[buyer.memberId,'care']);
    assert.equal(state.code,await serviceCode(db,buyer.memberId));
    assert.deepEqual({...state.referrer,createdAt:undefined},{name:'Synthetic Member',source:'invite_signup',createdAt:undefined});
    assert.equal((await rpc(db,'select get_platform_service_referral_v1($1,$2) result',[inviter.memberId,'care'])).referrer,null);
    await db.query('update platform_members set terms_accepted_at=null,terms_basis=null where id=$1',[inviter.memberId]);
    assert.deepEqual(await rpc(db,'select preview_platform_service_referral_v1($1,$2,$3) result',[other.memberId,'care',code]),{ok:false,code:'invalid_referral'});
    await assert.rejects(rpc(db,'select ensure_platform_service_referral_code_v1($1,$2) result',[inviter.memberId,'care']),/consent_required/);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from platform_service_referrals'),/permission denied/);
      await assert.rejects(db.query('select * from platform_service_referral_codes'),/permission denied/);
      await assert.rejects(db.query("select bind_platform_service_referral_v1($1,'care',$2,'manual')",[other.memberId,code]),/permission denied/);
      await db.exec('reset role');
    }
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
    assert.ok(canonical.replaceAll('\r\n','\n').includes(enrollmentMigration.replaceAll('\r\n','\n').trimEnd()));
    assert.ok(canonical.replaceAll('\r\n','\n').includes(withdrawalMigration.replaceAll('\r\n','\n').trimEnd()));
    const schedule=await readFile(new URL('../migrations/20261012072615_platform_auth_cleanup_schedule.sql',import.meta.url),'utf8');
    assert.match(schedule,/create extension if not exists pg_cron with schema pg_catalog/);
    assert.match(schedule,/cron\.schedule\('platform-auth-challenge-cleanup','\*\/5 \* \* \* \*'/);
    assert.ok(canonical.replaceAll('\r\n','\n').includes(schedule.replaceAll('\r\n','\n')));
    // The withdrawal drain reads its key from Vault and never embeds a credential.
    const drain=await readFile(new URL('../migrations/20261014140000_platform_withdrawal_drain_schedule.sql',import.meta.url),'utf8');
    assert.match(drain,/cron\.schedule\('platform-withdrawal-cleanup-drain','\*\/5 \* \* \* \*'/);
    assert.match(drain,/vault\.decrypted_secrets\s+where name='platform_withdrawal_drain_service_key'/);
    assert.match(drain,/'action','withdrawal_cleanup_drain'/);
    assert.match(drain,/revoke all on function public\.request_platform_withdrawal_drain_v1\(\) from public,anon,authenticated,service_role/);
    assert.doesNotMatch(drain,/eyJ[A-Za-z0-9_-]{10,}|sb_secret_/);
    assert.ok(canonical.replaceAll('\r\n','\n').includes(drain.replaceAll('\r\n','\n')));
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
    const inviter=await member(db);const code=await serviceCode(db,inviter.memberId);
    const buyer=await careMember(db,'00000000012',code);const a=await apply(db,buyer.memberId,'care');const p=await partner(db,'care',0,.5);
    await settle(db,a.applicationId,p.partnerId,10000);
    const reward=(await db.query("select id,amount from platform_member_benefits where kind='direct_referrer'")).rows[0];
    assert.equal(Number(reward.amount),5000);
    const args=[admin,reward.id,'2026-01-02T00:00:00Z','synthetic-transfer'];
    const first=await rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',args);
    assert.deepEqual(await rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',args),first);
    await assert.rejects(rpc(db,'select mark_platform_benefit_paid($1,$2,$3,$4) result',[...args.slice(0,3),'different-transfer']),/idempotency_conflict/);
  }finally{await db.close();}
});

test('coordinated consumer withdrawal retains settled UUIDs, erases account data and replays only the same operation',async()=>{
  const db=await fixture('',true);try {
    const created=await member(db),operation=randomUUID(),digest='a'.repeat(64);
    const application=await apply(db,created.memberId),settlementPartner=await partner(db);
    await settle(db,application.applicationId,settlementPartner.partnerId);
    const begin=()=>rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,operation,digest]);
    const first=await begin();assert.equal(first.completed,false);assert.equal(first.source_fc_id,null);
    assert.deepEqual(await rpc(db,'select get_platform_withdrawal_v1(null,$1) result',[digest]),first);
    assert.equal(await rpc(db,'select get_platform_withdrawal_v1(null,$1) result',['b'.repeat(64)]),null);
    assert.deepEqual(await begin(),first);
    assert.equal((await db.query('select active from platform_members where id=$1',[created.memberId])).rows[0].active,false);
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),0);
    assert.equal(await rpc(db,'select get_platform_withdrawal_v1($1,$2) result',[operation,'b'.repeat(64)]),null);
    await assert.rejects(rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,'b'.repeat(64),'not_applicable']),/forbidden/);
    await assert.rejects(rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest]),/forbidden/);
    await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'not_applicable']);
    const done=await rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest]);
    assert.equal(done.completed,true);assert.equal(done.cleanup_receipt,null);
    assert.equal((await begin()).completed,true);
    assert.deepEqual((await db.query('select phone,name,active from platform_members where id=$1',[created.memberId])).rows[0],
      {phone:null,name:'탈퇴 회원',active:false});
    assert.equal(Number((await db.query('select count(*) n from platform_partner_settlements where application_id=$1',[application.applicationId])).rows[0].n),1);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select get_platform_withdrawal_v1($1,$2)',[operation,digest]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});

test('coordinated common withdrawal preserves company admin and manager credentials and accounts',async()=>{
  const db=await fixture('',true);try {
    for(const [kind,table] of [['admin','admin_accounts'],['manager','manager_accounts']]) {
      const account=(await db.query(`select id,phone,active,session_version,password_set_at from ${table} where active`)).rows[0];
      const mapped=(await db.query('select id from platform_members where staff_account_id=$1',[account.id])).rows[0].id;
      const operation=randomUUID(),digest='c'.repeat(64);
      const started=await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[mapped,operation,digest]);
      assert.equal(started.source_fc_id,null);assert.equal(started.preserved_company_role,kind);
      await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'not_applicable']);
      assert.equal((await rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest])).completed,true);
      assert.deepEqual((await db.query(`select id,phone,active,session_version,password_set_at from ${table} where id=$1`,[account.id])).rows[0],account);
    }
  }finally{await db.close();}
});

test('coordinated FC withdrawal erases service PII without deleting financial principals and waits for every cleanup receipt',async()=>{
  const db=await fixture('',true);try {
    const mapped=(await db.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id;
    await db.exec(`create table synthetic_financial_snapshot(fc_id uuid references fc_profiles(id),amount bigint);
      insert into synthetic_financial_snapshot values('${fc}',10000);
      update fc_profiles set resident_id_masked='synthetic-private',address='Synthetic Address',admin_memo='Synthetic Private Memo',
        hanwha_commission_pdf_path='hanwha-url-pdf/${fc}/synthetic-private.pdf',hanwha_commission_pdf_name='synthetic-private.pdf'
        where id='${fc}';`);
    const operation=randomUUID(),digest='d'.repeat(64);
    await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[mapped,operation,digest]);
    assert.ok((await db.query('select account_closed_at from fc_profiles where id=$1',[fc])).rows[0].account_closed_at);
    assert.equal((await db.query('select signup_completed from fc_profiles where id=$1',[fc])).rows[0].signup_completed,false);
    assert.equal(Number((await db.query('select count(*) n from fc_credentials where fc_id=$1',[fc])).rows[0].n),0);
    await assert.rejects(db.query('insert into fc_credentials(fc_id,password_hash,password_salt) values($1,$2,$3)',[fc,hash,salt]),/account_closed/);
    await assert.rejects(db.query("update fc_profiles set name='Revived' where id=$1",[fc]),/account_closed/);
    await assert.rejects(rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'not_applicable']),/affiliate_receipt_required/);
    const erased=await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'erased']);
    assert.equal(erased.local_erased,true);assert.equal(erased.completed,false);
    assert.ok(erased.cleanup_receipt.document_paths.includes('synthetic-path'));
    assert.ok(erased.cleanup_receipt.document_paths.includes(`hanwha-url-pdf/${fc}/synthetic-private.pdf`));
    assert.deepEqual((await db.query('select phone,name,affiliation,resident_id_masked,address,admin_memo,signup_completed,hanwha_commission_pdf_path from fc_profiles where id=$1',[fc])).rows[0],
      {phone:`deleted-fc:${fc}`,name:'탈퇴 회원',affiliation:'삭제',resident_id_masked:null,address:null,admin_memo:null,signup_completed:false,hanwha_commission_pdf_path:null});
    assert.equal(Number((await db.query('select count(*) n from synthetic_financial_snapshot where fc_id=$1',[fc])).rows[0].n),1);
    assert.equal(Number((await db.query('select count(*) n from fc_documents where fc_id=$1',[fc])).rows[0].n),0);
    await assert.rejects(rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest]),/cleanup_pending/);
    await rpc(db,'select record_account_deletion_cleanup_attempt_v1($1,true,null) result',[erased.cleanup_outbox_id]);
    assert.deepEqual((await db.query('select cleanup_payload from account_deletion_cleanup_outbox where id=$1',[erased.cleanup_outbox_id])).rows[0].cleanup_payload,{});
    assert.equal((await rpc(db,'select get_platform_withdrawal_v1($1,$2) result',[operation,digest])).cleanup_receipt,null);
    const queued=randomUUID(),batch=randomUUID();
    await db.query("insert into messenger_attachment_cleanup_outbox(id,batch_id,status,bucket_id,storage_path,reason_code,sweep_phase) values($1,$2,'pending','messenger-attachments-v2','synthetic-private-file','account_deleted','post_token_expiry')",[queued,batch]);
    await db.query('insert into platform_withdrawal_messenger_cleanup values($1,$2)',[operation,queued]);
    assert.deepEqual(await rpc(db,'select get_platform_withdrawal_cleanup_v1($1,$2) result',[operation,digest]),{batch_ids:[batch],pending:true});
    await assert.rejects(rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest]),/cleanup_pending/);
    await db.query("update messenger_attachment_cleanup_outbox set status='completed',storage_path=null where id=$1",[queued]);
    assert.equal((await rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest])).completed,true);
    assert.equal((await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'erased'])).completed,true);
  }finally{await db.close();}
});

test('FC closure queues real messenger objects and upload intents, erases names, and completes only after the delayed expiry sweep',async()=>{
  const db=await fixture('',true);try {
    const mapped=(await db.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id;
    const operation=randomUUID(),digest='e'.repeat(64),batch=randomUUID(),attachment=randomUUID();
    await db.query("insert into messenger_attachment_delivery_batches(id,actor_id,actor_role,context_kind,status,expires_at) values($1,$2,'fc','group','pending',clock_timestamp()+interval '10 minutes')",[batch,fc]);
    await db.query("insert into messenger_attachment_objects(id,batch_id,original_name,byte_size,sha256,bucket_id,storage_path,status,reference_count) values($1,$2,'synthetic-private-name.pdf',100,$3,'messenger-attachments-v2','synthetic-object','active',1)",[attachment,batch,'f'.repeat(64)]);
    await db.query("insert into messenger_attachment_upload_intents(id,batch_id,original_name,bucket_id,object_path,status) values($1,$2,'synthetic-private-name.pdf','messenger-attachments-v2','synthetic-intent','pending')",[randomUUID(),batch]);
    await db.exec('create unique index on messenger_attachment_cleanup_outbox(bucket_id,storage_path,sweep_phase) where bucket_id is not null and storage_path is not null');
    await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[mapped,operation,digest]);
    assert.equal((await db.query('select original_name,status,storage_path from messenger_attachment_objects where id=$1',[attachment])).rows[0].original_name,'삭제');
    assert.deepEqual((await db.query('select original_name,status,object_path from messenger_attachment_upload_intents where batch_id=$1',[batch])).rows[0],{original_name:'삭제',status:'revoked',object_path:null});
    assert.equal((await db.query('select original_name from messenger_attachment_deletion_audit')).rows[0].original_name,'삭제');
    assert.equal(Number((await db.query('select count(*) n from platform_withdrawal_messenger_cleanup where operation_id=$1',[operation])).rows[0].n),4);
    const claim=async()=>{await db.exec('set role service_role');try{return (await db.query('select * from claim_messenger_attachment_cleanup_v2(100,$1)',[batch])).rows;}finally{await db.exec('reset role');}};
    const immediate=await claim();assert.equal(immediate.length,2);assert.equal(immediate.every(row=>row.sweep_phase==='immediate'),true);
    for(const row of immediate) await rpc(db,'select complete_messenger_attachment_cleanup_v2($1,true,null) result',[row.job_id]);
    const erased=await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'erased']);
    await rpc(db,'select record_account_deletion_cleanup_attempt_v1($1,true,null) result',[erased.cleanup_outbox_id]);
    await assert.rejects(rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest]),/cleanup_pending/);
    assert.equal((await claim()).length,0);
    await db.exec("update messenger_attachment_cleanup_outbox set not_before=clock_timestamp()-interval '1 second' where status='pending'");
    const delayed=await claim();assert.equal(delayed.length,2);
    for(const row of delayed) await rpc(db,'select complete_messenger_attachment_cleanup_v2($1,true,null) result',[row.job_id]);
    assert.equal((await rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest])).completed,true);
    assert.equal(Number((await db.query('select count(*) n from messenger_attachment_cleanup_outbox where storage_path is not null or bucket_id is not null')).rows[0].n),0);
  }finally{await db.close();}
});

test('withdrawal worker selects only three due jobs and backs off blocked identities without starving later jobs',async()=>{
  const db=await fixture('',true);try {
    const operations=[];
    for(let i=0;i<4;i++) {
      const created=await member(db,`0000000001${i+1}`),operation=randomUUID();operations.push(operation);
      await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,operation,'f'.repeat(64)]);
    }
    assert.equal((await rpc(db,'select list_due_platform_withdrawals_v1() result')).length,3);
    await rpc(db,'select record_platform_withdrawal_retry_v1($1,$2,$3) result',[operations[0],'f'.repeat(64),'affiliate_identity_unbound']);
    const due=await rpc(db,'select list_due_platform_withdrawals_v1() result');
    assert.equal(due.length,3);assert.equal(due.some(row=>row.operation_id===operations[0]),false);
    assert.equal(due.some(row=>row.operation_id===operations[3]),true);
    assert.equal((await db.query('select attempt_count,pending_reason from platform_account_withdrawals where operation_id=$1',[operations[0]])).rows[0].attempt_count,1);
    await assert.rejects(rpc(db,'select record_platform_withdrawal_retry_v1($1,$2,$3) result',[operations[0],'a'.repeat(64),'affiliate_unavailable']),/forbidden/);
  }finally{await db.close();}
});

test('FC mapping preserves member identity across phone edits and consumer promotion retains shared referrer',async()=>{
  const db=await fixture('',true);try{
    await db.exec(insuranceOnlyWithdrawalMigration);
    assert.equal(Number((await db.query('select count(*) n from platform_members where fc_id=$1',[fc])).rows[0].n),1);
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
    // Deleting only the insurance account detaches it; the 모두온 member stays.
    const detached=(await db.query('select phone,active,fc_id from platform_members where id=$1',[mapped])).rows[0];
    assert.deepEqual(detached,{phone:'00000000020',active:true,fc_id:null});
    assert.equal((await rpc(db,'select delete_platform_member($1) result',[inviter.memberId])).deleted,true);
    assert.equal((await db.query('select phone,active from platform_members where id=$1',[inviter.memberId])).rows[0].phone,null);
  }finally{await db.close();}
});

test('common withdrawal keeps historical UUIDs and blocks automatic import while fresh explicit acceptance preserves FC work',async()=>{
  const db=await fixture();try {
    const created=await member(db),promoted='10000000-0000-4000-8000-000000000021';
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000011','Synthetic FC',true)",[promoted]);
    await db.query("update fc_profiles set phone='00000000021' where id=$1",[promoted]);
    const application=await apply(db,created.memberId);
    const originalReferralCode=(await db.query('select referral_code from platform_members where id=$1',[created.memberId])).rows[0].referral_code;
    const child=await member(db,'00000000012',originalReferralCode);
    const settledApplication=await apply(db,created.memberId,'telecom',randomUUID());
    const settlementPartner=await partner(db);
    await settle(db,settledApplication.applicationId,settlementPartner.partnerId);
    const settlementId=(await db.query('select id from platform_partner_settlements where application_id=$1',[settledApplication.applicationId])).rows[0].id;
    assert.equal((await rpc(db,'select delete_platform_member($1) result',[created.memberId])).deleted,true);
    assert.equal((await db.query('select phone from fc_profiles where id=$1',[promoted])).rows[0].phone,'00000000021');
    const erased=(await db.query('select phone,name,active,fc_id,terms_version,terms_accepted_at from platform_members where id=$1',[created.memberId])).rows[0];
    assert.deepEqual(erased,{phone:null,name:'탈퇴 회원',active:false,fc_id:null,terms_version:null,terms_accepted_at:null});
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where consumed_member_id=$1',[created.memberId])).rows[0].n),0);
    assert.equal((await db.query('select status,details from platform_service_applications where id=$1',[application.applicationId])).rows[0].status,'cancelled');
    await db.query("update fc_profiles set name='Synthetic changed FC' where id=$1",[promoted]);
    assert.equal((await db.query('select phone from platform_members where id=$1',[created.memberId])).rows[0].phone,null);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',
      ['00000000021','fc',promoted])).code,'common_membership_withdrawn');
    assert.equal((await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4) result',
      ['00000000021','Synthetic changed FC',promoted,'2026-10-12'])).ok,true);
    const renewed=(await db.query('select id,terms_basis,terms_accepted_at from platform_members where fc_id=$1',[promoted])).rows[0];
    assert.notEqual(renewed.id,created.memberId);assert.equal(renewed.terms_basis,'user_acceptance');assert.ok(renewed.terms_accepted_at);
    const acceptedAt=String(renewed.terms_accepted_at);
    await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4) result',['00000000021','Synthetic changed FC',promoted,'2026-10-12']);
    assert.equal(String((await db.query('select terms_accepted_at from platform_members where id=$1',[renewed.id])).rows[0].terms_accepted_at),acceptedAt);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',
      ['00000000021','fc',promoted])).code,'common_membership_withdrawn');
    assert.equal((await db.query('select referrer_id from platform_members where id=$1',[child.memberId])).rows[0].referrer_id,created.memberId);
    assert.equal((await db.query('select member_id,status from platform_service_applications where id=$1',[settledApplication.applicationId])).rows[0].member_id,created.memberId);
    assert.equal((await db.query('select id from platform_partner_settlements where application_id=$1',[settledApplication.applicationId])).rows[0].id,settlementId);
    assert.equal((await db.query('select member_id from platform_member_benefits where settlement_id=$1',[settlementId])).rows[0].member_id,created.memberId);
    assert.equal(Number((await db.query('select count(*) n from platform_member_benefits where member_id=$1',[renewed.id])).rows[0].n),0);
    assert.deepEqual((await db.query('select active,phone,withdrawal_source_kind,withdrawal_source_id from platform_members where id=$1',[created.memberId])).rows[0],
      {active:false,phone:null,withdrawal_source_kind:'fc',withdrawal_source_id:promoted});
    await db.query('delete from fc_profiles where id=$1',[promoted]);
    assert.equal((await db.query('select active,phone from platform_members where id=$1',[created.memberId])).rows[0].active,false);
    assert.equal((await db.query('select active,phone from platform_members where id=$1',[renewed.id])).rows[0].active,false);
    assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where consumed_member_id in ($1,$2)',[created.memberId,renewed.id])).rows[0].n),0);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);await assert.rejects(db.query('select delete_platform_member($1)',[created.memberId]),/permission denied/);await db.exec('reset role');
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
        await assert.rejects(rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4,$5,$6) result',
          [phone,'Synthetic FC changed',shadow,'2026-10-12','fc',shadow]),/forbidden/);
        assert.equal((await db.query('select id from platform_members where staff_account_id=$1',[id])).rows[0].id,mapped);
        assert.equal((await db.query('select fc_id from platform_members where id=$1',[mapped])).rows[0].fc_id,null);
      }
      await rpc(db,'select delete_platform_member($1) result',[mapped]);
      assert.equal(Number((await db.query(`select count(*) n from ${table} where id=$1`,[id])).rows[0].n),1);
      assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',[phone,kind,id])).code,'common_membership_withdrawn');
      assert.equal((await enroll()).ok,true);
      const renewed=(await db.query('select id,terms_basis,terms_accepted_at from platform_members where staff_account_id=$1',[id])).rows[0];
      assert.notEqual(renewed.id,mapped);assert.equal(renewed.terms_basis,'user_acceptance');assert.ok(renewed.terms_accepted_at);
      assert.equal((await db.query('select created_member_id from platform_legacy_membership_cohort where account_kind=$1 and account_id=$2',[kind,id])).rows[0].created_member_id,mapped);
      assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',[phone,kind,id])).code,'common_membership_withdrawn');
      await db.query(`update ${table} set phone=$1,name='Synthetic changed Staff' where id=$2`,[changedPhone,id]);
      assert.equal((await db.query('select phone from platform_members where id=$1',[mapped])).rows[0].phone,null);
      assert.equal((await db.query('select phone from platform_members where id=$1',[renewed.id])).rows[0].phone,changedPhone);
      await db.query(`delete from ${table} where id=$1`,[id]);
      const erased=(await db.query('select phone,active,staff_account_id,terms_version from platform_members where id=$1',[mapped])).rows[0];
      assert.deepEqual(erased,{phone:null,active:false,staff_account_id:null,terms_version:null});
      assert.equal((await db.query('select active from platform_members where id=$1',[renewed.id])).rows[0].active,false);
      assert.equal(Number((await db.query('select count(*) n from platform_signup_challenges where consumed_member_id=$1',[mapped])).rows[0].n),0);
    }
  } finally {await db.close();}
});

test('manual staff grant attaches to the common member, moves its single password and guards staff phones',async()=>{
  const db=await fixture();try {
    const grant=(...args)=>rpc(db,'select grant_platform_staff_account_v1($1,$2,$3,$4) result',args);
    const created=await member(db,'00000000021');
    const granted=await grant(created.memberId,'admin','developer',null);
    assert.equal(granted.ok,true);assert.equal(granted.created,true);
    const account=(await db.query('select name,phone,staff_type,password_hash,password_salt,active from admin_accounts where id=$1',[granted.accountId])).rows[0];
    assert.deepEqual(account,{name:'Synthetic Member',phone:'00000000021',staff_type:'developer',password_hash:hash,password_salt:salt,active:true});
    assert.deepEqual((await db.query('select staff_account_kind,staff_account_id from platform_members where id=$1',[created.memberId])).rows[0],
      {staff_account_kind:'admin',staff_account_id:granted.accountId});
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),0);
    assert.equal((await rpc(db,'select platform_login_attempt($1,$2) result',[created.memberId,hash])).ok,false);
    assert.equal((await grant(created.memberId,'admin','admin',null)).alreadyGranted,true);
    assert.equal((await grant(created.memberId,'manager','admin',null)).code,'staff_already_bound');
    await assert.rejects(grant(created.memberId,'admin','owner',null),/invalid_input/);

    // Direct staff rows and phone edits cannot shadow another common member.
    const other=await member(db,'00000000022');
    await assert.rejects(db.query("insert into manager_accounts(phone,active,id) values('00000000022',true,$1)",[randomUUID()]),/platform_member_phone_requires_grant/);
    await assert.rejects(db.query("update admin_accounts set phone='00000000022' where id=$1",[granted.accountId]),/platform_member_phone_requires_grant/);
    await db.query("update admin_accounts set name='Synthetic renamed' where id=$1",[granted.accountId]);

    // A pre-guard collision binds explicitly and adopts the common password.
    await db.exec('alter table manager_accounts disable trigger platform_manager_phone_guard');
    const legacy=randomUUID(),otherHash=Buffer.alloc(32,9).toString('base64');
    await db.query("insert into manager_accounts(phone,active,id,password_hash,password_salt) values('00000000022',true,$1,$2,$3)",[legacy,otherHash,salt]);
    await db.exec('alter table manager_accounts enable trigger platform_manager_phone_guard');
    assert.equal((await grant(other.memberId,'manager',null,null)).code,'staff_phone_conflict');
    assert.equal((await grant(other.memberId,'admin','admin',legacy)).code,'staff_phone_conflict');
    const bound=await grant(other.memberId,'manager',null,legacy);
    assert.deepEqual([bound.ok,bound.created,bound.accountId],[true,false,legacy]);
    assert.equal((await db.query('select password_hash from manager_accounts where id=$1',[legacy])).rows[0].password_hash,hash);

    const fcMember=await member(db,'00000000023');
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000023','Synthetic FC',true)",[randomUUID()]);
    assert.equal((await grant(fcMember.memberId,'admin','admin',null)).code,'fc_member_not_supported');
    assert.equal((await grant(randomUUID(),'admin','admin',null)).code,'member_unavailable');
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {await assert.rejects(db.query('select grant_platform_staff_account_v1($1,$2,$3,$4)',[other.memberId,'admin','admin',null]),/permission denied/);}
      finally {await db.exec('reset role');}
    }
  } finally {await db.close();}
});

test('restored completed FCs link to the existing common member and keep the common password once',async()=>{
  const db=await fixture('',true);try {
    const repair=await readFile(new URL('../migrations/20261015030000_link_restored_fc_common_members.sql',import.meta.url),'utf8');
    await db.exec('alter table fc_credentials add column if not exists temporary_password_issued_at timestamptz');
    const created=await member(db,'00000000041');
    const restored=randomUUID(),closed=randomUUID(),oldHash=Buffer.alloc(32,7).toString('base64');
    // The roster restore inserted FCs without touching common rows, so the projection trigger did not link them.
    await db.exec('alter table fc_profiles disable trigger platform_fc_projection');
    await db.query("insert into fc_profiles(id,phone,name,signup_completed,status) values($1,'00000000041','Synthetic Restored',true,'draft'),($2,'00000000042','Synthetic Closed',true,'draft')",[restored,closed]);
    await db.query('insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at) values($1,$2,$3,now())',[restored,oldHash,salt]);
    await db.exec('alter table fc_profiles enable trigger platform_fc_projection');
    const other=await member(db,'00000000043');
    await db.exec(repair);
    assert.equal((await db.query('select fc_id from platform_members where id=$1',[created.memberId])).rows[0].fc_id,restored);
    assert.equal((await db.query('select password_hash from fc_credentials where fc_id=$1',[restored])).rows[0].password_hash,hash);
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),0);
    assert.equal((await db.query('select fc_id from platform_members where id=$1',[other.memberId])).rows[0].fc_id,null);
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[other.memberId])).rows[0].n),1);
    await db.exec(repair);
    assert.equal((await db.query('select password_hash from fc_credentials where fc_id=$1',[restored])).rows[0].password_hash,hash);
  } finally {await db.close();}
});

test('legacy import records company attestation, keeps real consent dates and follows existing recruiters independent of login order',async()=>{
  const recruit=randomUUID();
  const db=await fixture(`insert into fc_profiles(id,phone,name,signup_completed,recommender_fc_id) values('${recruit}','00000000041','Synthetic Recruit',true,'${fc}');
    insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at) values('${recruit}','${hash}','${salt}',now());`);try {
    const imported=await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000041','fc',recruit]);
    const row=(await db.query('select * from platform_members where id=$1',[imported.memberId])).rows[0];
    assert.equal(row.terms_accepted_at,null);assert.equal(row.terms_basis,'company_attested_import');
    assert.equal(row.insurance_consent_source,'company_attested_import');assert.ok(row.terms_recorded_at);
    assert.equal(row.referrer_id,(await db.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000041','fc',recruit])).memberId,imported.memberId);
    const before=Number((await db.query('select count(*) n from platform_members')).rows[0].n);
    await rpc(db,'select delete_platform_member($1) result',[imported.memberId]);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000041','fc',recruit])).code,'common_membership_withdrawn');
    assert.equal(Number((await db.query('select count(*) n from platform_members')).rows[0].n),before);
    assert.deepEqual((await db.query('select withdrawal_source_kind,withdrawal_source_id from platform_members where id=$1',[imported.memberId])).rows[0],
      {withdrawal_source_kind:'fc',withdrawal_source_id:recruit});
    const original=(await db.query('select id from platform_members where fc_id=$1',[fc])).rows[0].id;
    await db.query("update platform_members set terms_accepted_at='2026-01-02T03:04:05Z',terms_basis='user_acceptance',terms_recorded_at='2026-01-02T03:04:05Z' where id=$1",[original]);
    await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000002','fc',fc]);
    assert.equal(new Date((await db.query('select terms_accepted_at from platform_members where id=$1',[original])).rows[0].terms_accepted_at).toISOString(),'2026-01-02T03:04:05.000Z');
    const code=(await db.query('select referral_code from platform_members where id=$1',[original])).rows[0].referral_code;
    assert.equal((await member(db,'00000000042',code)).ok,true);
    const shadow=randomUUID();
    await db.query("insert into fc_profiles(id,phone,name,signup_completed,is_manager_referral_shadow) values($1,'00000000043','Synthetic Shadow',true,true)",[shadow]);
    await db.query('insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at) values($1,$2,$3,now())',[shadow,hash,salt]);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000043','fc',shadow])).code,'company_attestation_unavailable');
  }finally{await db.close();}
});

test('company cohort freezes eligible source IDs, maps manager recruiters and preserves chosen null referral and consent dates',async()=>{
  const draft=randomUUID(),shadow=randomUUID(),recruited=randomUUID(),missingPassword=randomUUID();
  const db=await fixture(`
    insert into fc_profiles(id,phone,name,signup_completed,status) values('${draft}','00000000051','Synthetic Draft',false,'draft');
    insert into fc_profiles(id,phone,name,signup_completed,is_manager_referral_shadow,status)
      values('${shadow}','00000000003','Synthetic Manager Shadow',false,true,'draft');
    insert into fc_profiles(id,phone,name,signup_completed,recommender_fc_id,status)
      values('${recruited}','00000000052','Synthetic Recruited',true,'${shadow}','draft');
    insert into fc_profiles(id,phone,name,signup_completed,status)
      values('${missingPassword}','00000000053','Synthetic Missing Password',true,'draft');
    insert into platform_members(phone,name,fc_id,referrer_id,terms_accepted_at,terms_version)
      values('00000000002','Synthetic Existing Choice','${fc}',null,'2026-01-02T03:04:05Z','2026-10-12');
  `);try {
    const original=(await db.query('select id,referrer_id,terms_accepted_at from platform_members where fc_id=$1',[fc])).rows[0];
    assert.equal(original.referrer_id,null);assert.equal(new Date(original.terms_accepted_at).toISOString(),'2026-01-02T03:04:05.000Z');
    const managerId=(await db.query("select id from platform_members where staff_account_kind='manager'")).rows[0].id;
    assert.equal((await db.query('select referrer_id from platform_members where fc_id=$1',[recruited])).rows[0].referrer_id,managerId);
    assert.equal(Number((await db.query('select count(*) n from platform_members where fc_id=$1',[shadow])).rows[0].n),0);
    assert.equal(Number((await db.query('select count(*) n from platform_members where fc_id=$1',[missingPassword])).rows[0].n),1);
    await db.query('update fc_profiles set signup_completed=true where id=$1',[draft]);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000051','fc',draft])).code,'company_attestation_unavailable');
    const future=randomUUID();
    await db.query("insert into fc_profiles(id,phone,name,signup_completed) values($1,'00000000054','Synthetic Future',true)",[future]);
    assert.equal((await rpc(db,'select import_platform_legacy_member_v1($1,$2,$3) result',['00000000054','fc',future])).code,'company_attestation_unavailable');
    const imported=(await db.query('select id from platform_members where fc_id=$1',[recruited])).rows[0].id;
    await rpc(db,'select enroll_platform_legacy_member($1,$2,$3,$4) result',['00000000052','Synthetic Recruited',recruited,'2026-10-12']);
    const accepted=(await db.query('select terms_basis,terms_accepted_at from platform_members where id=$1',[imported])).rows[0];
    assert.equal(accepted.terms_basis,'user_acceptance');assert.ok(accepted.terms_accepted_at);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from platform_legacy_membership_cohort'),/permission denied/);
      await assert.rejects(db.query("insert into platform_legacy_membership_cohort(account_kind,account_id) values('fc',$1)",[future]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
  await assert.rejects(fixture("insert into platform_members(name,phone,active) values('Synthetic historical withdrawal',null,false)"),/platform_withdrawal_provenance_required/);
});

async function insuranceEnrollment(db,created,overrides={}) {
  const input={phone:'00000000011',version:0,key:'70000000-0000-4000-8000-000000000001',fingerprint:'a'.repeat(64),
    consent:'insurance-additional-info-v1',affiliation:'가람',email:'synthetic@example.invalid',carrier:'KT',statuses:['life'],
    code:'SYNTHETIC',inviter:fc,...overrides};
  return rpc(db,'select enroll_platform_insurance_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',
    [created.memberId,input.phone,input.version,input.key,input.fingerprint,input.consent,input.affiliation,input.email,
      input.carrier,input.statuses,input.code,input.inviter]);
}

test('explicit insurance enrollment transfers credentials once, preserves common referral and keeps identity/workflow gates',async()=>{
  const db=await fixture();try {
    await db.query("insert into referral_codes(fc_id,code,is_active) values($1,'SYNTHETIC',true)",[fc]);
    const commonInviter=await member(db,'00000000012');
    const commonCode=(await db.query('select referral_code from platform_members where id=$1',[commonInviter.memberId])).rows[0].referral_code;
    const created=await member(db,'00000000011',commonCode);
    const first=await insuranceEnrollment(db,created);
    assert.equal(first.ok,true);assert.equal(first.alreadyApplied,false);
    const profile=(await db.query('select name,phone,status,identity_completed,signup_completed,signup_verification_method,life_commission_completed,nonlife_commission_completed,recommender_fc_id from fc_profiles where id=$1',[first.fcId])).rows[0];
    assert.deepEqual(profile,{name:'Synthetic Member',phone:'00000000011',status:'draft',identity_completed:false,signup_completed:true,
      signup_verification_method:'platform_member_session',life_commission_completed:false,nonlife_commission_completed:false,recommender_fc_id:fc});
    assert.deepEqual((await db.query('select password_hash,password_salt from fc_credentials where fc_id=$1',[first.fcId])).rows[0],{password_hash:hash,password_salt:salt});
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),0);
    const common=(await db.query('select id,referrer_id,insurance_consent_source,insurance_consent_recorded_at from platform_members where fc_id=$1',[first.fcId])).rows[0];
    assert.equal(common.id,created.memberId);assert.equal(common.referrer_id,commonInviter.memberId);assert.equal(common.insurance_consent_source,'user_acceptance');
    const retry=await insuranceEnrollment(db,created);
    assert.equal(retry.fcId,first.fcId);assert.equal(retry.alreadyApplied,true);
    assert.equal(String((await db.query('select insurance_consent_recorded_at from platform_members where id=$1',[created.memberId])).rows[0].insurance_consent_recorded_at),String(common.insurance_consent_recorded_at));
    await assert.rejects(insuranceEnrollment(db,created,{fingerprint:'b'.repeat(64)}),/idempotency_conflict/);
    await assert.rejects(insuranceEnrollment(db,created,{key:randomUUID()}),/idempotency_conflict/);
    await db.query('update fc_credentials set session_version=session_version+1 where fc_id=$1',[first.fcId]);
    await assert.rejects(insuranceEnrollment(db,created),/idempotency_conflict/);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select enroll_platform_insurance_v1($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [created.memberId,'00000000011',randomUUID(),'a'.repeat(64),'insurance-additional-info-v1','가람','synthetic@example.invalid','KT',['life'],'SYNTHETIC',fc]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});

test('leaving only 가람in keeps the 모두온 account, its password and other services; leaving 모두온 removes them',async()=>{
  const db=await fixture('',true);try {
    await db.exec(insuranceOnlyWithdrawalMigration);
    await db.query("insert into referral_codes(fc_id,code,is_active) values($1,'SYNTHETIC',true)",[fc]);
    const created=await member(db,'00000000011');
    const telecom=await apply(db,created.memberId);
    const enrolled=await insuranceEnrollment(db,created);
    const operation=randomUUID(),digest='a'.repeat(64);
    const begin=(id=operation,d=digest)=>rpc(db,'select begin_platform_insurance_withdrawal_v1($1,$2,$3) result',[created.memberId,id,d]);
    const started=await begin();
    assert.equal(started.scope,'insurance');assert.equal(started.source_fc_id,enrolled.fcId);
    assert.deepEqual(await begin(),started);
    await assert.rejects(begin(operation,'b'.repeat(64)),/forbidden/);
    // The common account stays signed-in capable with the same password, under a new session generation.
    assert.deepEqual((await db.query('select active,phone,fc_id,insurance_consent_version from platform_members where id=$1',[created.memberId])).rows[0],
      {active:true,phone:'00000000011',fc_id:null,insurance_consent_version:null});
    assert.deepEqual((await db.query('select password_hash,password_salt,session_version from platform_member_credentials where member_id=$1',[created.memberId])).rows[0],
      {password_hash:hash,password_salt:salt,session_version:1});
    assert.equal(Number((await db.query('select count(*) n from fc_credentials where fc_id=$1',[enrolled.fcId])).rows[0].n),0);
    assert.ok((await db.query('select account_closed_at from fc_profiles where id=$1',[enrolled.fcId])).rows[0].account_closed_at);
    await assert.rejects(rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'not_applicable']),/affiliate_receipt_required/);
    const erased=await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[operation,digest,'erased']);
    assert.equal(erased.local_erased,true);
    assert.deepEqual((await db.query('select phone,name,email,carrier,license_statuses from fc_profiles where id=$1',[enrolled.fcId])).rows[0],
      {phone:`deleted-fc:${enrolled.fcId}`,name:'탈퇴 회원',email:null,carrier:null,license_statuses:null});
    assert.equal((await db.query('select active from platform_members where id=$1',[created.memberId])).rows[0].active,true);
    assert.equal((await db.query('select status from platform_service_applications where id=$1',[telecom.applicationId])).rows[0].status,'interest');
    await rpc(db,'select record_account_deletion_cleanup_attempt_v1($1,true,null) result',[erased.cleanup_outbox_id]);
    assert.equal((await rpc(db,'select complete_platform_withdrawal_v1($1,$2) result',[operation,digest])).completed,true);

    // The member can register for 가람in again with a fresh FC account.
    const again=await insuranceEnrollment(db,created,{version:1,key:randomUUID()});
    assert.equal(again.ok,true);assert.notEqual(again.fcId,enrolled.fcId);

    // Leaving 모두온 afterwards removes every service; an unsettled application is deleted.
    const all=randomUUID();
    await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,all,'c'.repeat(64)]);
    await rpc(db,'select erase_platform_withdrawal_v1($1,$2,$3) result',[all,'c'.repeat(64),'erased']);
    assert.equal((await db.query('select active from platform_members where id=$1',[created.memberId])).rows[0].active,false);
    assert.equal(Number((await db.query('select count(*) n from platform_service_applications where id=$1',[telecom.applicationId])).rows[0].n),0);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select begin_platform_insurance_withdrawal_v1($1,$2,$3)',[created.memberId,randomUUID(),digest]),/permission denied/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});

test('insurance registration rejects authority claims, stale common sessions and invalid referrals without partial conversion',async()=>{
  const db=await fixture();try {
    await db.query("insert into referral_codes(fc_id,code,is_active) values($1,'SYNTHETIC',true),($1,'FAILAPPLY',true)",[fc]);
    const created=await member(db);
    for(const [overrides,error] of [[{affiliation:'Synthetic 설계매니저'},/invalid_input/],[{version:9},/forbidden/],
      [{consent:'unapproved'},/invalid_input/],[{code:'missing'},/invalid_referral/],[{inviter:randomUUID()},/invalid_referral/],
      [{code:'FAILAPPLY'},/synthetic_referral_failure/]]) await assert.rejects(insuranceEnrollment(db,created,overrides),error);
    assert.equal((await db.query('select fc_id,insurance_consent_recorded_at from platform_members where id=$1',[created.memberId])).rows[0].fc_id,null);
    assert.equal(Number((await db.query("select count(*) n from fc_profiles where phone='00000000011'")).rows[0].n),0);
    assert.equal(Number((await db.query('select count(*) n from platform_member_credentials where member_id=$1',[created.memberId])).rows[0].n),1);
    const draft=randomUUID();
    await db.query("insert into fc_profiles(id,phone,name,signup_completed,status) values($1,'00000000011','Synthetic Prereg',false,'draft')",[draft]);
    const completed=await insuranceEnrollment(db,created);assert.equal(completed.fcId,draft);
    const member2=await member(db,'00000000013');
    const established=randomUUID();
    await db.query("insert into fc_profiles(id,phone,name,signup_completed,status) values($1,'00000000013','Synthetic Existing',false,'docs-pending')",[established]);
    await assert.rejects(insuranceEnrollment(db,member2,{phone:'00000000013'}),/forbidden/);
    assert.equal((await db.query('select status,signup_completed from fc_profiles where id=$1',[established])).rows[0].status,'docs-pending');
    const staffInsert="insert into admin_accounts(phone,active,id,name,staff_type) values('00000000013',true,$1,'Synthetic Staff','developer')";
    await assert.rejects(db.query(staffInsert,[randomUUID()]),/platform_member_phone_requires_grant/);
    // Collisions created before the guard still block conversion.
    await db.exec('alter table admin_accounts disable trigger platform_admin_phone_guard');
    await db.query(staffInsert,[randomUUID()]);
    await assert.rejects(insuranceEnrollment(db,member2,{phone:'00000000013'}),/forbidden/);
  }finally{await db.close();}
});

test('hospital care requests and member push tokens are member owned, retry safe, bounded, answered only by admins and purged on withdrawal',async()=>{
  const db=await fixture('',true);try {
    await db.exec(careRequestMigration);
    const created=await member(db),hospitalId='20000000-0000-4000-8000-000000000001';
    const today=(await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
    const input=(overrides={})=>({hospitalId,hospitalName:'Synthetic Partner Hospital',desiredStart:today,careType:'full_day',contactTime:'morning',...overrides});
    const request=(body,key)=>rpc(db,'select create_hospital_care_request_v1($1,$2,$3) result',[created.memberId,body,key]);
    const key=randomUUID(),first=await request(input(),key);
    assert.equal(first.status,'requested');assert.equal(first.created,true);
    assert.deepEqual(await request(input(),key),{...first,created:false});
    await assert.rejects(request(input({careType:'day_time'}),key),/idempotency_conflict/);
    await assert.rejects(request(input({desiredStart:'2020-01-01'}),randomUUID()),/invalid_details/);
    await assert.rejects(request({...input(),patientCondition:'free text'},randomUUID()),/invalid_details/);
    await request(input(),randomUUID());await request(input(),randomUUID());
    await assert.rejects(request(input(),randomUUID()),/care_request_limit/);
    const respond=(status,note,actor=admin)=>rpc(db,'select respond_hospital_care_request_v1($1,$2,$3,$4) result',[actor,first.requestId,status,note]);
    await assert.rejects(respond('confirmed',null,randomUUID()),/forbidden/);
    await assert.rejects(respond('adjusted',' '),/invalid_details/);
    const confirmed=await respond('confirmed','Synthetic note');
    assert.equal(confirmed.changed,true);assert.equal(confirmed.memberId,created.memberId);
    assert.equal((await respond('confirmed','Synthetic note')).changed,false);
    await assert.rejects(rpc(db,'select cancel_hospital_care_request_v1($1,$2) result',[created.memberId,first.requestId]),/application_unavailable/);
    await assert.rejects(rpc(db,'select cancel_hospital_care_request_v1($1,$2) result',[randomUUID(),first.requestId]),/application_unavailable/);
    await request(input(),randomUUID());
    await db.query("insert into platform_member_push_tokens(expo_push_token,member_id,platform) values('ExponentPushToken[synthetic]',$1,'android')",[created.memberId]);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from platform_hospital_care_requests'),/permission denied/);
      await assert.rejects(db.query('select * from platform_member_push_tokens'),/permission denied/);
      await assert.rejects(db.query('select create_hospital_care_request_v1($1,$2,$3)',[created.memberId,input(),randomUUID()]),/permission denied/);
      await db.exec('reset role');
    }
    await rpc(db,'select begin_platform_withdrawal_v1($1,$2,$3) result',[created.memberId,randomUUID(),'c'.repeat(64)]);
    assert.equal(Number((await db.query('select count(*) n from platform_hospital_care_requests')).rows[0].n),0);
    assert.equal(Number((await db.query('select count(*) n from platform_member_push_tokens')).rows[0].n),0);
  }finally{await db.close();}
});

test('hospital care response time uses Seoul operating hours, records milestones once and reports on-time first contact',async()=>{
  const db=await fixture();try {
    await db.exec(careRequestMigration);
    const due=async(at)=>Number((await db.query("select extract(epoch from hospital_care_first_contact_due_v1($1))*1000 ms",[at])).rows[0].ms);
    assert.equal(new Date(await due('2026-10-20T10:00:00+09:00')).toISOString(),'2026-10-20T01:30:00.000Z');
    assert.equal(new Date(await due('2026-10-20T06:10:00+09:00')).toISOString(),'2026-10-19T23:30:00.000Z');
    assert.equal(new Date(await due('2026-10-20T23:40:00+09:00')).toISOString(),'2026-10-20T23:30:00.000Z');
    const created=await member(db),hospitalId='20000000-0000-4000-8000-000000000001';
    const today=(await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
    const input={hospitalId,hospitalName:'Synthetic Partner Hospital',desiredStart:today,careType:'day_time',contactTime:'anytime'};
    const make=async()=>(await rpc(db,'select create_hospital_care_request_v1($1,$2,$3) result',[created.memberId,input,randomUUID()])).requestId;
    const [late,onTime,waiting]=[await make(),await make(),await make()];
    // Fix history: late was answered after its due time, onTime before it, waiting is still unanswered and past due.
    await db.query("update platform_hospital_care_requests set created_at=now()-interval '2 hours',first_contact_due_at=now()-interval '90 minutes' where id=any($1)",[[late,waiting]]);
    await db.query("update platform_hospital_care_requests set created_at=now()-interval '20 minutes',first_contact_due_at=now()+interval '10 minutes' where id=$1",[onTime]);
    const mark=(id,milestone,actor=admin)=>rpc(db,'select mark_hospital_care_milestone_v1($1,$2,$3) result',[actor,id,milestone]);
    await assert.rejects(mark(late,'first_contact',randomUUID()),/forbidden/);
    await assert.rejects(mark(onTime,'care_started'),/application_unavailable/);
    assert.equal((await mark(late,'first_contact')).changed,true);
    assert.equal((await mark(late,'first_contact')).changed,false);
    assert.equal((await db.query('select status from platform_hospital_care_requests where id=$1',[late])).rows[0].status,'reviewing');
    await rpc(db,'select respond_hospital_care_request_v1($1,$2,$3,$4) result',[admin,onTime,'confirmed',null]);
    assert.equal((await mark(onTime,'care_started')).changed,true);
    const claim=()=>rpc(db,'select claim_overdue_hospital_care_v1() result');
    assert.equal(await claim(),1);
    assert.equal(await claim(),0);
    const metrics=await rpc(db,"select get_hospital_care_metrics_v1($1,now()-interval '1 day') result",[admin]);
    assert.deepEqual({requests:metrics.requests,due:metrics.firstContactDue,onTime:metrics.firstContactOnTime,overdue:metrics.overdueNow,
      confirmed:metrics.confirmed,started:metrics.started},{requests:3,due:3,onTime:1,overdue:1,confirmed:1,started:1});
    assert.ok(Number(metrics.medianFirstContactMinutes)>=20 && Number(metrics.medianDecisionMinutes)>=20);
    await assert.rejects(rpc(db,"select get_hospital_care_metrics_v1($1,now()) result",[randomUUID()]),/forbidden/);
  }finally{await db.close();}
});
