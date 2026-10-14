import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serveWithConfiguredCors, referralCorsHeaders } from '../_shared/serve-with-cors.ts';
import { createAppSessionToken, createRequestBoardBridgeToken, createPlatformMemberToken, getEnv, parsePlatformMemberToken, parseAppSessionTokenDetailed, parseDesignerCompanyNameFromAffiliation } from '../_shared/request-board-auth.ts';
import { verifySessionGeneration } from '../_shared/session-generation.ts';
import { hashPassword, signupCodeHash, toBase64 } from '../_shared/password-hash.ts';
import { sendSignupSms } from '../_shared/signup-sms.ts';
import { processPasswordResetChallenge } from '../_shared/password-reset-challenge.ts';
import { getKoreanYmd } from '../_shared/exam-payment-proof.ts';
import { resolveManagerAffiliation } from '../_shared/manager-affiliation.ts';
import { createRequestBoardAccountRetirementAssertion, sha256Hex } from '../_shared/request-board-auth.ts';
import { drainAccountDeletionCleanup } from '../_shared/account-deletion-cleanup.ts';
import { drainMessengerAttachmentCleanup } from '../_shared/messenger-attachment-service.ts';

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(supabaseUrl,serviceKey);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ['insurance','care','telecom','rental','car','hospital'];
const termsVersion = '2026-10-12';
const insuranceConsentVersion = 'insurance-additional-info-v1';
// Affiliate services whose referrer can be registered today. Each keeps its own referrer.
const referralServices = ['care'];
const serviceReferralCode = (value:unknown) => typeof value==='string' && /^[A-Za-z0-9]{8,12}$/.test(value.trim());
const json = (body: object,status=200) => new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',...referralCorsHeaders()},
});
const fail = (code:string,message:string,status=400) => json({ok:false,code,message},status);
const hospitalProvinces:Record<string,string>={'11':'서울','26':'부산','27':'대구','28':'인천','29':'광주','30':'대전','31':'울산','36':'세종','41':'경기','43':'충북','44':'충남','46':'전남','47':'경북','48':'경남','50':'제주','51':'강원','52':'전북'};
const hospitalEventTypes=['impression','detail','phone','directions'];
const hospitalPlacements=['regional_list','regional_featured'];
const ymd=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

// Short-lived receipts authorize only anonymous measurement admission. They do
// not grant member/admin access and are signed with a distinct purpose string.
async function hospitalSignature(value:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(serviceKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`hospital-measurement-v1:${value}`)));
  return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function hospitalReceipt(hospital:Record<string,unknown>) {
  const data=btoa(JSON.stringify({id:hospital.id,revision:hospital.revision,placement:hospital.adPlacement,expires:Math.floor(Date.now()/1000)+900}));
  return `${data}.${await hospitalSignature(data)}`;
}
async function verifyHospitalReceipt(token:unknown,id:string) {
  if(typeof token!=='string' || token.length>700) return null;
  const parts=token.split('.');
  if(parts.length!==2 || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  const expected=await hospitalSignature(parts[0]);
  let different=0; for(let i=0;i<expected.length;i++) different|=expected.charCodeAt(i)^parts[1].charCodeAt(i);
  if(different) return null;
  try {
    const receipt=JSON.parse(atob(parts[0]));
    return receipt.id===id && Number.isSafeInteger(receipt.revision) && receipt.revision>=0
      && hospitalPlacements.includes(receipt.placement) && Number.isFinite(receipt.expires)
      && receipt.expires>Math.floor(Date.now()/1000) ? receipt : null;
  } catch {return null;}
}

// Privileged database reach ends here: callers never receive service-role keys,
// credential columns, raw graph descendants, or another member's applications.
async function rpc(name:string,args:Record<string,unknown>) {
  const {data,error} = await db.rpc(name,args);
  if (error) throw new Error(error.code === '23505' ? 'already_exists' :
    error.code?.startsWith('22') || error.code==='23514' ? 'invalid_input' :
    ['revision_conflict','idempotency_conflict','settled_cancellation_requires_reconciliation','invalid_details',
       'invalid_settlement','application_unavailable','partner_unavailable','partner_service_conflict','forbidden','invalid_transfer','invalid_partner','report_range_too_large',
       'invalid_referral','consent_required','common_membership_withdrawn','referral_already_bound']
      .includes(error.message) ? error.message : 'database_error');
  return data;
}
async function legacyMember(phone:string) {
  const {data,error} = await db.from('platform_members').select('*').eq('phone',phone).eq('active',true).maybeSingle();
  if(error) throw new Error('database_error');
  return data;
}

type WithdrawalJob = { operation_id: string; member_id: string; source_fc_id: string | null;
  local_erased: boolean; completed: boolean; cleanup_receipt: unknown;
  pending_reason?: 'affiliate_identity_unbound'|'affiliate_unavailable'|'cleanup_pending'|null;
  preserved_company_role: 'admin'|'manager'|'designer'|'developer'|null };
function withdrawalJob(value: unknown): WithdrawalJob | null {
  if(value===null) return null;
  if(!value || typeof value!=='object') throw new Error('withdrawal_receipt_unverified');
  const row=value as WithdrawalJob;
  if(!uuid.test(row.operation_id) || !uuid.test(row.member_id)
    || (row.source_fc_id!==null && !uuid.test(row.source_fc_id))
    || typeof row.local_erased!=='boolean' || typeof row.completed!=='boolean'
    || (row.completed && !row.local_erased)
    || (row.preserved_company_role!==null && !['admin','manager','designer','developer'].includes(row.preserved_company_role)))
    throw new Error('withdrawal_receipt_unverified');
  return row;
}
function withdrawalResponse(job: WithdrawalJob, reason=job.pending_reason) {
  if(reason!=null && !['affiliate_identity_unbound','affiliate_unavailable','cleanup_pending'].includes(reason))
    throw new Error('withdrawal_receipt_unverified');
  return {ok:true,operationId:job.operation_id,status:job.completed ? 'completed' : 'pending',
    deleted:job.completed,cleanupPending:!job.completed,
    ...(!job.completed && reason ? {reason} : {}),
    ...(job.preserved_company_role ? {preservedCompanyAccount:job.preserved_company_role} : {})};
}
async function getWithdrawal(request: Request) {
  const token=request.headers.get('x-app-session-token') ?? '';
  if(!token.trim() || token.length>8192) throw new Error('invalid_session');
  const job=withdrawalJob(await rpc('get_platform_withdrawal_v1',{
    p_operation_id:null,p_session_digest:await sha256Hex(token)}));
  return json({ok:true,withdrawal:job ? withdrawalResponse(job) : null});
}
async function withdrawMember(request: Request, body: Record<string,unknown>) {
  if(body.confirmed!==true || body.scope!=='all_affiliates' || body.policyVersion!=='2026-10-14'
    || typeof body.idempotencyKey!=='string' || !uuid.test(body.idempotencyKey))
    return fail('invalid_input','전체 제휴 서비스 탈퇴 안내를 확인해 주세요.');
  const operationId=body.idempotencyKey.toLowerCase();
  const token=request.headers.get('x-app-session-token') ?? '';
  if(!token || token.length>8192) throw new Error('invalid_session');
  const digest=await sha256Hex(token);
  // An exact operation/session digest is a resume-only capability. It cannot
  // start another withdrawal or restore the login authority already revoked.
  let job=withdrawalJob(await rpc('get_platform_withdrawal_v1',{p_operation_id:operationId,p_session_digest:digest}));
  if(!job) {
    const current=await actor(request,false);
    job=withdrawalJob(await rpc('begin_platform_withdrawal_v1',{
      p_member_id:current.member.id,p_operation_id:operationId,p_session_digest:digest}));
  }
  if(!job || job.operation_id!==operationId) throw new Error('withdrawal_receipt_unverified');
  return await finishWithdrawal(job,digest);
}
async function finishWithdrawal(job: WithdrawalJob,digest: string) {
  const operationId=job.operation_id;
  const result=async(completed: boolean,reason?: string)=>{
    if(!completed) {
      const retry=await rpc('record_platform_withdrawal_retry_v1',{p_operation_id:operationId,p_session_digest:digest,p_reason:reason});
      if(retry?.completed===true) {
        const current=withdrawalJob(await rpc('get_platform_withdrawal_v1',{p_operation_id:operationId,p_session_digest:digest}));
        if(!current?.completed) throw new Error('withdrawal_receipt_unverified');
        job=current; completed=true;
      }
    }
    return json(withdrawalResponse({...job,completed},reason as WithdrawalJob['pending_reason']));
  };
  if(job.completed) return result(true);
  if(!job.local_erased) {
    let affiliateState='not_applicable';
    let preservedRole: string|null=null;
    if(job.source_fc_id) {
      const syncUrl=getEnv('REQUEST_BOARD_PASSWORD_SYNC_URL')?.trim() ?? '';
      const bridgeSecret=getEnv('REQUEST_BOARD_PASSWORD_SYNC_TOKEN')?.trim() ?? '';
      const assertion=await createRequestBoardAccountRetirementAssertion(job.source_fc_id,operationId);
      if(!syncUrl || !bridgeSecret || !assertion) return result(false,'affiliate_unavailable');
      try {
        const endpoint=new URL(syncUrl);
        if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password) return result(false,'affiliate_unavailable');
        endpoint.pathname='/api/auth/retire-affiliate-account'; endpoint.search=''; endpoint.hash='';
        const response=await fetch(endpoint,{method:'POST',redirect:'error',
          headers:{'Content-Type':'application/json','x-request-bridge-token':bridgeSecret},
          body:JSON.stringify({authAssertion:assertion}),signal:AbortSignal.timeout(10000)});
        const receipt=await response.json();
        if(response.status===409 && ['AFFILIATE_IDENTITY_UNBOUND','AFFILIATE_COMPANY_IDENTITY_REVIEW_REQUIRED'].includes(receipt?.code))
          return result(false,'affiliate_identity_unbound');
        const data=receipt?.data;
        if(!response.ok || receipt?.success!==true || data?.operationId!==operationId
          || data?.upstreamAccountId!==job.source_fc_id || data?.policyVersion!=='2026-10-14'
          || typeof data?.alreadyApplied!=='boolean') return result(false,'affiliate_unavailable');
        if(data.accountErased===true && data.runtimeRevoked===true
          && data.runtimeRevocationScope==='persisted_auth_and_local_runtime'
          && data.remoteSocketRevalidationIntervalMs===5000) affiliateState='erased';
        else if(data.status==='company_account_preserved' && data.accountErased===false && data.runtimeRevoked===false
          && data.preservedRole==='designer' && data.independentLoginAvailable===true) {
          affiliateState='company_account_preserved'; preservedRole=data.preservedRole;
        } else return result(false,'affiliate_unavailable');
      } catch { return result(false,'affiliate_unavailable'); }
    }
    job=withdrawalJob(await rpc('erase_platform_withdrawal_v1',{p_operation_id:operationId,p_session_digest:digest,
      p_affiliate_state:affiliateState,p_preserved_company_role:preservedRole}));
    if(!job || !job.local_erased) throw new Error('withdrawal_receipt_unverified');
  }
  if(job.cleanup_receipt && await drainAccountDeletionCleanup(db,job.cleanup_receipt)) return result(false,'cleanup_pending');
  const pending=await rpc('get_platform_withdrawal_cleanup_v1',{p_operation_id:operationId,p_session_digest:digest});
  if(!pending || !Array.isArray(pending.batch_ids) || pending.batch_ids.length>25
    || pending.batch_ids.some((id:unknown)=>typeof id!=='string' || !uuid.test(id))
    || typeof pending.pending!=='boolean') throw new Error('withdrawal_receipt_unverified');
  for(const batchId of pending.batch_ids) {
    try {
      const drained=await drainMessengerAttachmentCleanup({supabase:db,batchId,limit:100});
      if(drained.claimFailed || drained.completionFailed) return result(false,'cleanup_pending');
    } catch { return result(false,'cleanup_pending'); }
  }
  const checked=await rpc('get_platform_withdrawal_cleanup_v1',{p_operation_id:operationId,p_session_digest:digest});
  if(checked?.pending!==false) return result(false,'cleanup_pending');
  job=withdrawalJob(await rpc('complete_platform_withdrawal_v1',{p_operation_id:operationId,p_session_digest:digest}));
  if(!job?.completed) throw new Error('withdrawal_receipt_unverified');
  return result(true);
}
async function drainWithdrawals(request: Request) {
  if(!serviceKey || request.headers.get('apikey')!==serviceKey
    || request.headers.get('Authorization')!==`Bearer ${serviceKey}`)
    return fail('forbidden','허용되지 않은 요청입니다.',403);
  const jobs=await rpc('list_due_platform_withdrawals_v1',{});
  if(!Array.isArray(jobs) || jobs.length>3) throw new Error('withdrawal_receipt_unverified');
  let completed=0; let pending=0;
  for(const value of jobs) {
    const job=withdrawalJob(value);
    const digest=(value as {session_digest?:unknown})?.session_digest;
    if(!job || job.completed || typeof digest!=='string' || !/^[0-9a-f]{64}$/.test(digest))
      throw new Error('withdrawal_receipt_unverified');
    const response=await finishWithdrawal(job,digest);
    const result=await response.json();
    if(result.status==='completed' && result.deleted===true && result.cleanupPending===false) completed++;
    else if(result.status==='pending' && result.deleted===false && result.cleanupPending===true) pending++;
    else throw new Error('withdrawal_receipt_unverified');
  }
  return json({ok:true,processed:jobs.length,completed,pending});
}

async function actor(request:Request,requireConsent=true) {
  const token = request.headers.get('x-app-session-token') ?? '';
  const platform = await parsePlatformMemberToken(token);
  if(platform) {
    const {data:member,error} = await db.from('platform_members').select('*')
      .eq('id',platform.memberId).eq('phone',platform.phone).eq('active',true).maybeSingle();
    if(error) throw new Error('session_unavailable');
    if(!member) throw new Error('invalid_session');
    if(platform.source) {
      if(platform.source.accountKind==='fc' ? member.fc_id!==platform.source.accountId
        : member.staff_account_kind!==platform.source.accountKind || member.staff_account_id!==platform.source.accountId)
        throw new Error('invalid_session');
      const current = await verifySessionGeneration({...platform.source,phone:platform.phone,sessionVersion:platform.sessionVersion},'app',
        {supabaseUrl,serviceRoleKey:serviceKey});
      if(current.ok===false) throw new Error(current.reason === 'unavailable' ? 'session_unavailable' : 'invalid_session');
    } else {
      const {data:credential,error:credentialError} = await db.from('platform_member_credentials')
        .select('session_version').eq('member_id',member.id).maybeSingle();
      if(credentialError) throw new Error('session_unavailable');
      if(!credential || Number(credential.session_version)!==platform.sessionVersion) throw new Error('invalid_session');
    }
      if(requireConsent && (member.terms_version!==termsVersion
        || (!member.terms_accepted_at && !(member.terms_basis==='company_attested_import' && member.terms_recorded_at)))) throw new Error('consent_required');
    return {member,adminId:null,generalMember:!platform.source,sessionVersion:platform.sessionVersion};
  }
  const legacy = await parseAppSessionTokenDetailed(token);
  if(legacy.ok===false) throw new Error(legacy.code==='session_verification_unavailable' ? 'session_unavailable' : 'invalid_session');
  const signed = legacy.payload;
  let member = await legacyMember(signed.phone);
  if(member && (signed.accountKind==='fc' ? member.fc_id && member.fc_id!==signed.accountId
    : member.staff_account_id && (member.staff_account_kind!==signed.accountKind || member.staff_account_id!==signed.accountId)))
    throw new Error('enrollment_required');
  if(requireConsent && (!member || member.terms_version!==termsVersion
    || (!member.terms_accepted_at && !(member.terms_basis==='company_attested_import' && member.terms_recorded_at)))) {
    const imported=await rpc('import_platform_legacy_member_v1',{
      p_phone:signed.phone,p_account_kind:signed.accountKind,p_account_id:signed.accountId});
    if(!imported.ok) throw new Error(imported.code);
    member=await legacyMember(signed.phone);
  }
  if(!member || (signed.accountKind==='fc' ? member.fc_id!==signed.accountId
    : member.staff_account_kind!==signed.accountKind || member.staff_account_id!==signed.accountId)) throw new Error('enrollment_required');
  if(requireConsent && (member.terms_version!==termsVersion
    || (!member.terms_accepted_at && !(member.terms_basis==='company_attested_import' && member.terms_recorded_at)))) throw new Error('consent_required');
  let adminId:null|string=null;
  if(signed.role==='admin' && signed.staffType==='admin') {
    const {data:current,error}=await db.from('admin_accounts').select('id').eq('id',signed.accountId)
      .eq('active',true).eq('staff_type','admin').maybeSingle();
    if(error) throw new Error('session_unavailable');
    adminId=current?.id ?? null;
  }
  return {member,adminId,generalMember:false,sessionVersion:signed.sessionVersion};
}
async function authResponse(member:{id:string;name:string;phone:string},version:number,source?:Parameters<typeof createPlatformMemberToken>[3],insuranceSession?:Record<string,unknown>) {
  const token = await createPlatformMemberToken(member.phone,member.id,version,source);
  if(!token) return fail('server_misconfigured','로그인 설정을 확인해 주세요.',503);
  return json({ok:true,role:'member',memberId:member.id,displayName:member.name,residentId:member.phone,appSessionToken:token,
    ...(insuranceSession ? {insuranceSession} : {})});
}

/** Mint only from the same current canonical account checked by legacy login. */
async function insuranceSession(member:Record<string,any>,expectedVersion?:number) {
  const kind=member.fc_id ? 'fc' : member.staff_account_kind;
  const id=member.fc_id ?? member.staff_account_id;
  if(!id || !['fc','admin','manager'].includes(kind)) throw new Error('enrollment_required');
  const table=kind==='fc' ? 'fc_profiles' : kind==='admin' ? 'admin_accounts' : 'manager_accounts';
  const {data:sourceProfile,error}=await db.from(table).select(kind==='fc'
    ? 'id,name,phone,affiliation,signup_completed,is_manager_referral_shadow'
    : 'id,name,phone,active,session_version,password_set_at'+(kind==='admin' ? ',staff_type' : ''))
    .eq('id',id).eq('phone',member.phone).maybeSingle();
  if(error) throw new Error('session_unavailable');
  const profile=sourceProfile as unknown as {name:string;affiliation?:string;signup_completed?:boolean;
    is_manager_referral_shadow?:boolean;active?:boolean;password_set_at?:string;session_version?:number;staff_type?:string}|null;
  if(!profile || (kind==='fc' ? !profile.signup_completed || profile.is_manager_referral_shadow
    : !profile.active || !profile.password_set_at)) throw new Error('invalid_session');
  let version=profile.session_version;
  if(kind==='fc') {
    const {data:credential,error:credentialError}=await db.from('fc_credentials')
      .select('session_version,password_set_at,must_change_password').eq('fc_id',id).maybeSingle();
    if(credentialError) throw new Error('session_unavailable');
    if(!credential?.password_set_at || credential.must_change_password) throw new Error('invalid_session');
    version=credential.session_version;
  }
  if(!Number.isSafeInteger(Number(version)) || Number(version)<0) throw new Error('session_unavailable');
  if(expectedVersion!==undefined && Number(version)!==expectedVersion) throw new Error('invalid_session');
  const generation={accountKind:kind as 'fc'|'admin'|'manager',accountId:id,sessionVersion:Number(version)};
  const role=kind as 'fc'|'admin'|'manager';
  const staffType=kind==='admin' ? profile.staff_type==='developer' ? 'developer' : 'admin' : undefined;
  const designer=kind==='fc' && parseDesignerCompanyNameFromAffiliation(profile.affiliation);
  const requestBoardRole=kind==='admin' && staffType==='admin' ? null : designer ? 'designer' : 'fc';
  const bridgeRole=kind==='manager' ? 'manager' : kind==='admin' && staffType==='admin' ? 'admin' : requestBoardRole ?? 'fc';
  const token=await createAppSessionToken(member.phone,role,staffType,kind==='fc' ? id : undefined,generation);
  const bridge=await createRequestBoardBridgeToken(member.phone,bridgeRole,
    kind==='manager' ? resolveManagerAffiliation(profile.name) : kind==='fc' && !designer ? profile.affiliation : undefined,generation);
  if(!token || !profile.name?.trim()) throw new Error('session_unavailable');
  return {ok:true,role,residentId:member.phone,displayName:profile.name,appSessionToken:token,
    ...(staffType ? {staffType} : {}),requestBoardRole,readOnly:kind==='manager',
    ...(bridge ? {requestBoardBridgeToken:bridge} : {})};
}

async function insuranceEnrollment(request:Request,body:Record<string,any>) {
  const token=request.headers.get('x-app-session-token') ?? '';
  const platform=await parsePlatformMemberToken(token);
  // A valid source-backed session can reopen the existing service without
  // rewriting its profile, workflow, recruiter or historical consent.
  if(!platform || platform.source) {
    const current=await actor(request);
    return json({ok:true,insuranceSession:await insuranceSession(current.member,current.sessionVersion),alreadyApplied:true});
  }
  if(body.confirmed!==true || body.consentAccepted!==true || body.consentVersion!==insuranceConsentVersion
    || !uuid.test(body.idempotencyKey ?? '') || typeof body.affiliation!=='string'
    || body.affiliation.length>120 || body.affiliation.includes('설계매니저') || typeof body.email!=='string'
    || body.email.length>254 || typeof body.carrier!=='string' || !Array.isArray(body.licenseStatuses)
    || body.licenseStatuses.length>4 || body.licenseStatuses.some((value:unknown)=>typeof value!=='string')
    || typeof body.referralCode!=='string' || body.referralCode.length>64 || !uuid.test(body.referralInviterFcId ?? ''))
    return fail('invalid_input','추가 정보, 추천인과 서비스 등록 동의를 확인해 주세요.');
  const {data:member,error}=await db.from('platform_members').select('*')
    .eq('id',platform.memberId).eq('phone',platform.phone).eq('active',true).maybeSingle();
  if(error) throw new Error('session_unavailable');
  if(!member || member.staff_account_id) throw new Error('invalid_session');
  if(!member.fc_id) await actor(request);
  else {
    // Only this exact recorded conversion may recover a lost response. An old
    // common token gains no general FC/common authorization after handoff.
    if(member.insurance_enrollment_key!==body.idempotencyKey
      || Number(member.insurance_enrollment_member_version)!==platform.sessionVersion) throw new Error('invalid_session');
    const generation=await verifySessionGeneration({accountKind:'fc',accountId:member.fc_id,phone:platform.phone,
      role:'fc',sessionVersion:Number(member.insurance_enrollment_fc_version)},'app',{supabaseUrl,serviceRoleKey:serviceKey});
    if(generation.ok===false) throw new Error(generation.reason==='unavailable' ? 'session_unavailable' : 'invalid_session');
  }
  const canonical=JSON.stringify({affiliation:body.affiliation.trim(),email:body.email.trim().toLowerCase(),carrier:body.carrier,
    licenseStatuses:[...new Set(body.licenseStatuses.map((value:string)=>value.trim()))].sort(),
    referralCode:body.referralCode.trim().toUpperCase(),referralInviterFcId:body.referralInviterFcId,
    consentVersion:insuranceConsentVersion});
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
  const fingerprint=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  const result=await rpc('enroll_platform_insurance_v1',{p_member_id:platform.memberId,p_phone:platform.phone,
    p_member_session_version:platform.sessionVersion,p_idempotency_key:body.idempotencyKey,p_request_fingerprint:fingerprint,
    p_consent_version:insuranceConsentVersion,p_affiliation:body.affiliation.trim(),p_email:body.email.trim().toLowerCase(),
    p_carrier:body.carrier,p_license_statuses:body.licenseStatuses,p_referral_code:body.referralCode.trim().toUpperCase(),
    p_referral_inviter_fc_id:body.referralInviterFcId});
  if(result.ok!==true || !uuid.test(result.fcId ?? '') || !Number.isSafeInteger(result.sessionVersion)) throw new Error('database_error');
  const refreshed=await legacyMember(platform.phone);
  if(!refreshed || refreshed.id!==platform.memberId || refreshed.fc_id!==result.fcId) throw new Error('session_unavailable');
  const session=await insuranceSession(refreshed,result.sessionVersion);
  const checked=await parseAppSessionTokenDetailed(session.appSessionToken);
  if(!checked.ok || checked.payload.accountId!==result.fcId || checked.payload.sessionVersion!==result.sessionVersion)
    throw new Error('invalid_session');
  return json({ok:true,insuranceSession:session,alreadyApplied:result.alreadyApplied===true});
}

serveWithConfiguredCors(async request => {
  if(request.method!=='POST') return fail('method_not_allowed','허용되지 않은 요청입니다.',405);
  let action='';
  try {
    const body = await request.json();
    if(!body || typeof body!=='object' || Array.isArray(body)) return fail('invalid_input','요청을 확인해 주세요.');
    action = typeof body.action==='string' ? body.action : '';
    if(['list_hospitals','get_hospital','get_hospital_regions'].includes(action)) {
      const today=getKoreanYmd();
      if(action==='get_hospital' && !uuid.test(body.hospitalId ?? '')) return fail('invalid_input','병원 정보를 확인해 주세요.');
      if((body.provinceCode && !Object.hasOwn(hospitalProvinces,body.provinceCode))
        || ['district','search','specialty'].some(field=>body[field]!=null && (typeof body[field]!=='string' || body[field].length>100))
        || (body.district && !body.provinceCode) || (body.offset!=null && (!Number.isInteger(body.offset) || body.offset<0 || body.offset>10000))
        || (body.limit!=null && (!Number.isInteger(body.limit) || body.limit<1 || body.limit>50)))
        return fail('invalid_input','지역과 검색 조건을 확인해 주세요.');
      const result=await rpc('get_platform_hospitals',{p_today:today,p_filters:action==='get_hospital_regions' ? {} :
        action==='get_hospital' ? {hospitalId:body.hospitalId,limit:1} : {provinceCode:body.provinceCode || '',district:body.district || '',
          search:body.search?.trim() || '',specialty:body.specialty || '',offset:body.offset ?? 0,limit:body.limit ?? 20,
          rotationBucket:String(Math.floor(Date.now()/900000))}});
      if(action==='get_hospital_regions') return json({ok:true,regions:Object.entries(hospitalProvinces).map(([provinceCode,provinceName])=>({
        provinceCode,provinceName,districts:result.regions?.find((region:{provinceCode:string})=>region.provinceCode===provinceCode)?.districts ?? [],
      })),specialties:result.specialties ?? []});
      const withReceipt=async(hospital:Record<string,unknown>)=>({...hospital,provinceName:hospitalProvinces[String(hospital.provinceCode)],measurementToken:await hospitalReceipt(hospital)});
      if(action==='get_hospital') return result.hospitals.length ? json({ok:true,hospital:await withReceipt(result.hospitals[0])})
        : fail('hospital_not_found','현재 안내 가능한 제휴병원이 아닙니다.',404);
      return json({ok:true,hospitals:await Promise.all(result.hospitals.map(withReceipt)),featured:await Promise.all(result.featured.map(withReceipt)),hasMore:result.hasMore,nextOffset:result.nextOffset});
    }
    if(action==='record_hospital_event') {
      if(!uuid.test(body.hospitalId ?? '') || !uuid.test(body.eventId ?? '') || !uuid.test(body.sessionId ?? '')
        || !hospitalEventTypes.includes(body.eventType)) return fail('invalid_input','이용 기록을 확인해 주세요.');
      const receipt=await verifyHospitalReceipt(body.measurementToken,body.hospitalId);
      if(!receipt) return fail('invalid_measurement','이용 기록의 유효 시간이 지났습니다.');
      const placement=body.placement ?? receipt.placement;
      if(!hospitalPlacements.includes(placement) || (placement==='regional_featured' && receipt.placement!=='regional_featured'))
        return fail('invalid_measurement','광고 노출 위치를 확인해 주세요.');
      // Gateway-derived address is used only for a keyed daily digest; raw
      // addresses are not persisted or returned. This is best-effort abuse
      // limiting, not identity verification or billable impression proof.
      const source=(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').slice(0,256).split(',')[0].trim();
      return json(await rpc('record_platform_hospital_event',{p_partner_id:body.hospitalId,p_revision:receipt.revision,p_placement:placement,
        p_event_id:body.eventId,p_event_type:body.eventType,p_session_digest:await hospitalSignature(`session:${getKoreanYmd()}:${body.sessionId}`),
        p_source_digest:await hospitalSignature(`source:${getKoreanYmd()}:${source}`)}));
    }
    if(['request_otp','signup','login','request_password_reset','reset_password'].includes(action)) {
      const phone = typeof body.phone==='string' ? body.phone.replace(/\D/g,'') : '';
      if(!/^\d{11}$/.test(phone)) return fail('invalid_phone','휴대폰 번호 11자리를 입력해 주세요.');
      if(action==='request_password_reset' || action==='reset_password') {
        const {data:member,error}=await db.from('platform_members').select('id,fc_id,staff_account_id')
          .eq('phone',phone).eq('active',true).maybeSingle();
        if(error) throw new Error('database_error');
        const credential=member && !member.fc_id && !member.staff_account_id
          ? await db.from('platform_member_credentials').select('password_salt').eq('member_id',member.id).maybeSingle() : null;
        if(credential?.error) throw new Error('database_error');
        if(!credential?.data) {
          const response=await fetch(`${supabaseUrl}/functions/v1/${action==='request_password_reset' ? 'request-password-reset' : 'reset-password'}`,{
            method:'POST',headers:{'Content-Type':'application/json',apikey:getEnv('SUPABASE_ANON_KEY') ?? '',
              Authorization:`Bearer ${getEnv('SUPABASE_ANON_KEY') ?? ''}`},body:JSON.stringify({phone,
              ...(action==='reset_password' ? {code:body.code,password:body.password,confirm:body.password} : {})}),
            signal:AbortSignal.timeout(10000)});
          const result=await response.json();
          if(!result || typeof result!=='object' || typeof result.ok!=='boolean') throw new Error('database_error');
          return result.ok===true ? json({ok:true,...(action==='request_password_reset' ? {sent:true} : {})})
            : json({ok:false,code:typeof result.code==='string' ? result.code : 'account_unavailable',
              message:typeof result.message==='string' ? result.message : '계정 정보를 확인해 주세요.'},response.ok ? 400 : response.status);
        }
      }
      if(action==='request_otp' || action==='request_password_reset') {
        const local = (getEnv('TEST_SMS_MODE') ?? '').toLowerCase()==='true';
        // Reject known test codes before persisting a challenge in any hosted
        // runtime. The shared SMS transport repeats this check before delivery.
        if(local && (getEnv('DENO_DEPLOYMENT_ID') || ['NODE_ENV','DENO_ENV','APP_ENV','ENVIRONMENT','SUPABASE_ENV','VERCEL_ENV']
          .some(name=>['prod','production'].includes((getEnv(name) ?? '').trim().toLowerCase()))))
          return fail('server_misconfigured','SMS 설정을 확인해 주세요.',503);
        const code = local ? (getEnv('TEST_SMS_CODE') ?? '') : String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
        if(!/^\d{6}$/.test(code)) return fail('server_misconfigured','SMS 설정을 확인해 주세요.',503);
        const recovery=action==='request_password_reset';
        const challengeHash=await signupCodeHash(code,recovery ? `reset:${phone}` : phone);
        let signupDeliveryId:string|null=null;
        let recoveryAccount:{kind:'member';id:string;phone:string}|null=null;
        if(recovery) {
          const {data:member,error}=await db.from('platform_members').select('id').eq('phone',phone).eq('active',true).is('fc_id',null).maybeSingle();
          if(error) throw new Error('database_error');
          if(!member) return fail('account_unavailable','일반 회원 계정을 확인해 주세요. 보험 계정은 보험 로그인에서 변경해 주세요.');
          recoveryAccount={kind:'member',id:member.id,phone};
          const result=await processPasswordResetChallenge(db,recoveryAccount,{action:'issue',tokenHash:challengeHash});
          if(result.ok===false) { const {status,...failure}=result;return json(failure,status); }
        } else {
          const result = await rpc('issue_platform_signup_otp',{p_phone:phone,p_code_hash:challengeHash});
          if(!result.ok) {
            const status=result.code==='already_exists' ? 409 : 429;
            const message=result.code==='already_exists' ? '이미 가입된 번호입니다. 로그인해 주세요.'
              : result.code==='locked' ? '여러 번 틀려 잠시 잠겼습니다. 10분 뒤 다시 시도해 주세요.'
              : '인증번호를 보낸 뒤 60초가 지나면 다시 요청할 수 있습니다.';
            return fail(result.code,message,status);
          }
          if(typeof result.deliveryId!=='string' || !uuid.test(result.deliveryId)) throw new Error('database_error');
          signupDeliveryId=result.deliveryId;
        }
        const sent = await sendSignupSms(phone,code,recovery ? `[모두온] 비밀번호 변경 코드: ${code} (15분 유효)`
          : `[모두온] 회원가입 인증 코드: ${code} (5분 유효)`,local);
        if(recoveryAccount && !sent.ok && sent.deliveryState==='rejected') {
          const compensation=await processPasswordResetChallenge(db,recoveryAccount,{action:'cancel',tokenHash:challengeHash});
          if(compensation.ok===false) return fail('sms_delivery_unknown','문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.',503);
        }
        if(signupDeliveryId) {
          let finalized:Record<string,unknown>;
          try {
            finalized=await rpc('finalize_platform_signup_otp_delivery',{
              p_phone:phone,p_delivery_id:signupDeliveryId,
              p_state:sent.ok ? 'accepted' : sent.deliveryState,
              p_provider_request_id:sent.providerRequestId,
              p_provider_status_code:sent.providerStatusCode,
              p_failure_reason:sent.ok === false ? sent.reason : null,
            });
          } catch {
            return fail('sms_delivery_unknown','문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.',503);
          }
          if(finalized.ok!==true)
            return fail('sms_delivery_unknown','문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.',503);
        }
        if(sent.ok) return json({ok:true,sent:true});
        return sent.deliveryState==='unknown'
          ? fail('sms_delivery_unknown','문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.',503)
          : fail('sms_send_failed','인증 문자를 보내지 못했습니다. 바로 다시 요청해 주세요.',503);
      }
      const password = typeof body.password==='string' ? body.password : '';
      if(!password || password.length>128) return fail('invalid_password','비밀번호를 확인해 주세요.');
      if(action==='reset_password') {
        if(typeof body.code!=='string' || !/^\d{6}$/.test(body.code)
          || password.length<8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password))
          return fail('invalid_input','인증번호와 비밀번호를 확인해 주세요.');
        const {data:member,error}=await db.from('platform_members').select('id').eq('phone',phone).eq('active',true).is('fc_id',null).maybeSingle();
        if(error) throw new Error('database_error');
        if(!member) return fail('account_unavailable','일반 회원 계정을 확인해 주세요.');
        const salt=toBase64(crypto.getRandomValues(new Uint8Array(16)));
        const result=await processPasswordResetChallenge(db,{kind:'member',id:member.id,phone},{action:'consume',
          tokenHash:await signupCodeHash(body.code,`reset:${phone}`),passwordHash:await hashPassword(password,salt),passwordSalt:salt});
        if(result.ok===false) { const {status,...failure}=result;return json(failure,status); }
        return json({ok:true});
      }
      if(action==='signup') {
        if(body.termsAccepted!==true || body.termsVersion!==termsVersion || typeof body.name!=='string' || !body.name.trim() || body.name.length>80
          || typeof body.code!=='string' || !/^\d{6}$/.test(body.code)
          || password.length<8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password))
          return fail('invalid_input','이름, 인증번호, 약관 동의와 비밀번호를 확인해 주세요.');
        const {data:existing,error:existingError}=await db.from('platform_members').select('id').eq('phone',phone).eq('active',true).is('fc_id',null).maybeSingle();
        if(existingError) throw new Error('database_error');
        const credential=existing ? await db.from('platform_member_credentials').select('password_salt').eq('member_id',existing.id).maybeSingle() : null;
        if(credential?.error) throw new Error('database_error');
        const salt=credential?.data?.password_salt ?? toBase64(crypto.getRandomValues(new Uint8Array(16)));
        // A service invitation binds that service's referrer with the account.
        // Older apps may still send a common referralCode; it stays history only.
        const invitation=body.serviceReferral;
        if(invitation!=null && (body.referralCode || typeof invitation!=='object' || Array.isArray(invitation)
          || !referralServices.includes(invitation.serviceKey) || !serviceReferralCode(invitation.code)))
          return fail('invalid_input','추천 코드를 확인해 주세요.');
        const registration={p_phone:phone,p_code_hash:await signupCodeHash(body.code,phone),
          p_name:body.name.trim(),p_password_hash:await hashPassword(password,salt),p_password_salt:salt};
        let result;
        try {
          result=invitation ? await rpc('register_platform_member_v2',{...registration,
            p_service_key:invitation.serviceKey,p_service_referral_code:invitation.code.trim().toUpperCase()})
            : await rpc('register_platform_member',{...registration,p_referral_code:body.referralCode || null});
        } catch(error) {
          if(error instanceof Error && error.message==='invalid_referral')
            return fail('invalid_referral','가족간병 추천 코드를 확인해 주세요. 추천 연결 없이 가입할 수도 있어요.');
          throw error;
        }
        if(!result.ok) return fail(result.code,result.code==='invalid_referral' ? '추천 코드를 확인해 주세요.' : '인증번호 또는 가입 정보를 확인해 주세요.');
        return authResponse({id:result.memberId,name:result.displayName,phone},result.sessionVersion);
      }
      const {data:member,error}=await db.from('platform_members').select('id,name,phone').eq('phone',phone).eq('active',true).maybeSingle();
      if(error) throw new Error('database_error');
      const {data:credential,error:credentialError}=member ? await db.from('platform_member_credentials')
        .select('password_salt').eq('member_id',member.id).maybeSingle() : {data:null,error:null};
      if(credentialError) throw new Error('database_error');
      if(member && credential) {
        const result=await rpc('platform_login_attempt',{p_member_id:member.id,p_password_hash:await hashPassword(password,credential.password_salt)});
        return result.ok ? authResponse(member,result.sessionVersion) : fail(result.code,'로그인 정보를 확인해 주세요.',401);
      }
      // Reuse FC/admin password validation and lockout. Never accept a client
      // claim that a consumer is an FC, and never synthesize a bridge token.
      const response = await fetch(`${supabaseUrl}/functions/v1/login-with-password`,{
        method:'POST',headers:{'Content-Type':'application/json',apikey:getEnv('SUPABASE_ANON_KEY') ?? '',
          Authorization:`Bearer ${getEnv('SUPABASE_ANON_KEY') ?? ''}`},body:JSON.stringify({phone,password}),signal:AbortSignal.timeout(10000),
      });
      if(!response.ok) return fail('login_unavailable','로그인을 처리하지 못했습니다.',503);
      const legacy = await response.json();
      if(!legacy.ok || !legacy.appSessionToken) return json({ok:false,code:legacy.code ?? 'invalid_password',
        message:legacy.message ?? '로그인 정보를 확인해 주세요.',
        ...(['fc','admin','manager'].includes(legacy.role) ? {role:legacy.role} : {}),
        ...(['admin','developer'].includes(legacy.staffType) ? {staffType:legacy.staffType} : {}),
        ...(legacy.code==='password_change_required' && typeof legacy.passwordChangeToken==='string'
          ? {passwordChangeToken:legacy.passwordChangeToken,passwordChangeExpiresAt:legacy.passwordChangeExpiresAt} : {}),
      },401);
      const checked = await parseAppSessionTokenDetailed(legacy.appSessionToken);
      if(!checked.ok) throw new Error('invalid_session');
      let mapped=await legacyMember(checked.payload.phone);
      const {accountKind,accountId,sessionVersion,role}=checked.payload;
      if(!mapped || mapped.terms_version!==termsVersion
        || (!mapped.terms_accepted_at && !(mapped.terms_basis==='company_attested_import' && mapped.terms_recorded_at))) {
        const imported=await rpc('import_platform_legacy_member_v1',{
          p_phone:checked.payload.phone,p_account_kind:accountKind,p_account_id:accountId});
        if(imported.ok!==true) return json({ok:true,insuranceSession:legacy,commonMembershipCode:imported.code});
        mapped=await legacyMember(checked.payload.phone);
      }
      if(!mapped || (accountKind==='fc' ? mapped.fc_id!==accountId : mapped.staff_account_kind!==accountKind || mapped.staff_account_id!==accountId))
        return json({ok:true,insuranceSession:legacy,commonMembershipCode:'common_membership_unavailable'});
      return authResponse(mapped,sessionVersion,{accountKind,accountId,role},legacy);
    }
    if(action==='enroll_insurance') return await insuranceEnrollment(request,body);
    if(action==='search_insurance_referral' || action==='validate_insurance_referral') {
      const current=await actor(request);
      if(action==='validate_insurance_referral') {
        if(typeof body.referralCode!=='string' || body.referralCode.length>64) return fail('invalid_referral','추천 코드를 확인해 주세요.');
        const result=await rpc('validate_platform_insurance_referral_v1',{
          p_phone:current.member.phone,p_code:body.referralCode});
        return result.ok===true ? json(result) : fail('invalid_referral','유효한 보험 추천인을 선택해 주세요.');
      }
      if(typeof body.query!=='string' || body.query.trim().length>80) return fail('invalid_input','추천인 이름을 확인해 주세요.');
      if(body.query.trim().length<2) return json({ok:true,results:[]});
      const response=await fetch(`${supabaseUrl}/functions/v1/search-signup-referral`,{
        method:'POST',headers:{'Content-Type':'application/json',apikey:getEnv('SUPABASE_ANON_KEY') ?? '',
          Authorization:`Bearer ${getEnv('SUPABASE_ANON_KEY') ?? ''}`},
        body:JSON.stringify({query:body.query.trim()}),signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error('database_error');
      const result=await response.json();
      if(result.ok!==true || !Array.isArray(result.results) || result.results.length>10
        || result.results.some((entry:Record<string,unknown>)=>!entry || !uuid.test(String(entry.fcId ?? ''))
          || typeof entry.name!=='string' || typeof entry.affiliation!=='string' || typeof entry.code!=='string'))
        throw new Error('database_error');
      return json({ok:true,results:result.results.map((entry:Record<string,unknown>)=>({
        fcId:entry.fcId,name:entry.name,affiliation:entry.affiliation,code:entry.code}))});
    }
    if(action==='accept_terms') {
      if(body.termsAccepted!==true || body.termsVersion!==termsVersion) return fail('invalid_input','약관 내용을 확인하고 동의해 주세요.');
      const token=request.headers.get('x-app-session-token') ?? '';
      const platform=await parsePlatformMemberToken(token);
      if(platform) {
        const current=await actor(request,false);
        const now=new Date().toISOString();
        const {error}=await db.from('platform_members').update({terms_accepted_at:current.member.terms_accepted_at ?? now,
          terms_version:termsVersion,terms_basis:'user_acceptance',terms_recorded_at:now}).eq('id',current.member.id);
        if(error) throw new Error('database_error');
        return json({ok:true});
      }
      const checked=await parseAppSessionTokenDetailed(token);
      if(checked.ok===false) throw new Error(checked.code==='session_verification_unavailable' ? 'session_unavailable' : 'invalid_session');
      const signed=checked.payload;
      const table=signed.accountKind==='fc' ? 'fc_profiles' : signed.accountKind==='admin' ? 'admin_accounts' : 'manager_accounts';
      const {data:profile,error}=await db.from(table).select('name').eq('id',signed.accountId).eq('phone',signed.phone).maybeSingle();
      if(error) throw new Error('database_error');
      if(!profile) throw new Error('invalid_session');
      return json(await rpc('enroll_platform_legacy_member',{p_phone:signed.phone,p_name:profile.name || '회원',
        p_fc_id:signed.accountKind==='fc' ? signed.accountId : null,p_terms_version:termsVersion,
        p_account_kind:signed.accountKind,p_account_id:signed.accountId}));
    }
    if(action==='delete_member') {
      // Old clients confirmed a different scope (their FC account was kept).
      return fail('upgrade_required','전체 제휴 서비스 탈퇴 안내를 확인하려면 앱을 업데이트해 주세요.',409);
    }
    if(action==='withdraw_member') return await withdrawMember(request,body);
    if(action==='get_withdrawal') return await getWithdrawal(request);
    if(action==='withdrawal_cleanup_drain') return await drainWithdrawals(request);
    const signed = await actor(request);
    if(action==='apply') {
      if(!uuid.test(body.idempotencyKey ?? '')) return fail('invalid_input','신청 정보를 확인해 주세요.');
      return json(await rpc('create_platform_application',{p_member_id:signed.member.id,p_service_key:body.serviceKey,
        p_details:body.details,p_idempotency_key:body.idempotencyKey}));
    }
    if(action==='cancel_application') {
      if(!uuid.test(body.applicationId ?? '')) return fail('invalid_input','신청 정보를 확인해 주세요.');
      return json(await rpc('cancel_platform_application',{p_member_id:signed.member.id,p_application_id:body.applicationId}));
    }
    if(['get_service_referral','preview_service_referral','bind_service_referral'].includes(action)) {
      if(!referralServices.includes(body.serviceKey)) return fail('invalid_input','서비스를 확인해 주세요.');
      if(action==='get_service_referral') {
        if(body.issueCode===true) await rpc('ensure_platform_service_referral_code_v1',{p_member_id:signed.member.id,p_service_key:body.serviceKey});
        return json(await rpc('get_platform_service_referral_v1',{p_member_id:signed.member.id,p_service_key:body.serviceKey}));
      }
      if(!serviceReferralCode(body.referralCode)) return fail('invalid_referral','추천 코드를 확인해 주세요.');
      const code=body.referralCode.trim().toUpperCase();
      if(action==='preview_service_referral') {
        const preview=await rpc('preview_platform_service_referral_v1',{p_member_id:signed.member.id,p_service_key:body.serviceKey,p_code:code});
        return preview.ok===true ? json(preview) : fail('invalid_referral','추천 코드를 확인해 주세요.');
      }
      if(!['invite_confirmed','manual'].includes(body.source)) return fail('invalid_input','추천인 등록 방법을 확인해 주세요.');
      const bound=await rpc('bind_platform_service_referral_v1',{p_member_id:signed.member.id,p_service_key:body.serviceKey,
        p_code:code,p_source:body.source});
      if(bound.ok===true) return json(bound);
      return bound.code==='referral_already_bound'
        ? fail('referral_already_bound','이미 등록된 가족간병 추천인은 앱에서 바꿀 수 없어요.',409)
        : fail('invalid_referral','추천 코드를 확인해 주세요.');
    }
    if(action==='get_account' || action==='verify') {
      const [applications,benefits] = await Promise.all([
        db.from('platform_service_applications').select('id,service_key,status,created_at').eq('member_id',signed.member.id).order('created_at',{ascending:false}).limit(100),
        db.from('platform_member_benefits').select('id,service_key,kind,amount,due_at,status').eq('member_id',signed.member.id).order('due_at',{ascending:false}).limit(100),
      ]);
      if(applications.error || benefits.error) throw new Error('database_error');
      return json({ok:true,member:{id:signed.member.id,name:signed.member.name,referralCode:signed.member.referral_code,
        referrerId:signed.member.referrer_id,createdAt:signed.member.created_at,
        termsAccepted:signed.member.terms_version===termsVersion && Boolean(signed.member.terms_accepted_at
          || (signed.member.terms_basis==='company_attested_import' && signed.member.terms_recorded_at)),termsVersion:signed.member.terms_version,
        insuranceEnrolled:Boolean(signed.member.fc_id || signed.member.staff_account_id),
        insuranceConsentAccepted:Boolean(signed.member.insurance_consent_version===insuranceConsentVersion
          && signed.member.insurance_consent_recorded_at)},
        applications:(applications.data ?? []).map(row=>({id:row.id,serviceKey:row.service_key,status:row.status,createdAt:row.created_at})),
        benefits:(benefits.data ?? []).map(row=>({id:row.id,serviceKey:row.service_key,kind:row.kind,amount:row.amount,dueAt:row.due_at,status:row.status}))});
    }
    if(!signed.adminId) return fail('forbidden','관리자만 처리할 수 있습니다.',403);
    if(action==='get_hospital_report') {
      if(!ymd(body.from) || !ymd(body.to) || body.to<body.from || (Date.parse(body.to)-Date.parse(body.from))/86400000>92
        || (body.partnerId!=null && !uuid.test(body.partnerId))) return fail('invalid_input','조회 기간과 제휴병원을 확인해 주세요.');
      return json(await rpc('get_platform_hospital_report',{p_admin_id:signed.adminId,p_from:body.from,p_to:body.to,p_partner_id:body.partnerId || null}));
    }
    if(action==='get_admin') {
      const results = await Promise.all([
        db.from('platform_partners').select('*').order('updated_at',{ascending:false}).limit(100),
        db.from('platform_service_applications').select('*').order('created_at',{ascending:false}).limit(100),
        db.from('platform_partner_settlements').select('*').order('created_at',{ascending:false}).limit(100),
        db.from('platform_member_benefits').select('*').order('due_at',{ascending:false}).limit(100),
      ]);
      if(results.some(result=>result.error)) throw new Error('database_error');
      return json({ok:true,partners:results[0].data,applications:results[1].data,settlements:results[2].data,benefits:results[3].data});
    }
    if(action==='save_partner') {
      if(!keys.includes(body.serviceKey) || typeof body.name!=='string' || !body.name.trim() || body.name.length>100
        || typeof body.region!=='string' || !body.region.trim() || body.region.length>50
        || typeof body.active!=='boolean' || !Number.isFinite(body.consumerRate) || !Number.isFinite(body.referrerRate)
        || !['commission','after_consumer'].includes(body.referrerBasis)
        || body.consumerRate<0 || body.referrerRate<0 || body.consumerRate>1 || body.referrerRate>1
        || (body.referrerBasis==='commission' && body.consumerRate+body.referrerRate>1)
        || (['hospital','insurance'].includes(body.serviceKey) && (body.consumerRate!==0 || body.referrerRate!==0))
        || !uuid.test(body.id ?? '') || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0)
        return fail('invalid_input','제휴사 정보와 지급 비율을 확인해 주세요.');
      if(body.websiteUrl && (typeof body.websiteUrl!=='string' || !/^https?:\/\//.test(body.websiteUrl) || body.websiteUrl.length>500))
        return fail('invalid_url','홈페이지 주소를 확인해 주세요.');
      if(body.serviceKey==='hospital' && (
        (body.address!=null && (typeof body.address!=='string' || body.address.length>500))
        || (body.phone!=null && (typeof body.phone!=='string' || body.phone.length>40))
        || (body.provinceCode!=null && !Object.hasOwn(hospitalProvinces,body.provinceCode))
        || typeof body.district!=='string' || body.district.length>50
        || !Array.isArray(body.specialties) || body.specialties.length>10 || body.specialties.some((s:unknown)=>typeof s!=='string' || !s.trim() || s.length>30)
        || typeof body.description!=='string' || body.description.length>2000 || typeof body.openingHours!=='string' || body.openingHours.length>500
        || typeof body.photoUrl!=='string' || body.photoUrl.length>500 || (body.photoUrl && !/^https:\/\/\S+$/.test(body.photoUrl))
        || typeof body.materialApproved!=='boolean' || ![true,false,null].includes(body.reviewRequired)
        || (body.reviewNumber!=null && (typeof body.reviewNumber!=='string' || body.reviewNumber.length>100))
        || (body.verifiedAt!=null && !ymd(body.verifiedAt)) || (body.reviewExpiresAt!=null && !ymd(body.reviewExpiresAt))
        || (body.active && (!body.provinceCode || !body.district.trim() || !body.address?.trim() || !body.materialApproved || body.reviewRequired===null
          || !ymd(body.verifiedAt) || body.verifiedAt>getKoreanYmd() || !hospitalPlacements.includes(body.adPlacement)
          || !ymd(body.adPeriodStart) || !ymd(body.adPeriodEnd) || body.adPeriodEnd<body.adPeriodStart
          || (body.reviewRequired && (!body.reviewNumber?.trim() || !ymd(body.reviewExpiresAt) || body.reviewExpiresAt<getKoreanYmd()))))))
        return fail('invalid_partner','지역, 광고 소재 확인과 게시 기간을 확인해 주세요.');
      return json(await rpc('save_platform_partner',{p_admin_id:signed.adminId,p_partner:{
        id:body.id || null,serviceKey:body.serviceKey,name:body.name,region:body.region,address:body.address || '',
        websiteUrl:body.websiteUrl || '',phone:body.phone || '',active:body.active,consumerRate:body.consumerRate,
        referrerRate:body.referrerRate,referrerBasis:body.referrerBasis,adPeriodStart:body.adPeriodStart || null,
        adPeriodEnd:body.adPeriodEnd || null,adPlacement:body.adPlacement || null,adFee:body.adFee ?? null,
        ...(body.serviceKey==='hospital' ? {provinceCode:body.provinceCode || null,district:body.district,specialties:body.specialties,
          description:body.description,photoUrl:body.photoUrl,openingHours:body.openingHours,verifiedAt:body.verifiedAt || null,
          materialApproved:body.materialApproved,reviewRequired:body.reviewRequired,reviewNumber:body.reviewNumber || null,reviewExpiresAt:body.reviewExpiresAt || null} : {}),
      },p_expected_revision:body.expectedRevision}));
    }
    if(action==='settle_application') {
      if(body.confirmedCompleted!==true || !uuid.test(body.applicationId ?? '') || !uuid.test(body.partnerId ?? '')
        || !uuid.test(body.idempotencyKey ?? '') || !Number.isSafeInteger(body.commissionAmount) || body.commissionAmount<0
        || typeof body.transactionReference!=='string' || !body.transactionReference.trim() || body.transactionReference.length>120
        || typeof body.settlementEvidenceReference!=='string' || !body.settlementEvidenceReference.trim() || body.settlementEvidenceReference.length>200
        || typeof body.settledAt!=='string' || !Number.isFinite(Date.parse(body.settledAt))) return fail('invalid_settlement','실제 거래와 제휴사 정산 증빙을 확인해 주세요.');
      return json(await rpc('settle_platform_application',{p_admin_id:signed.adminId,p_application_id:body.applicationId,p_partner_id:body.partnerId,
        p_commission_amount:body.commissionAmount,p_settled_at:body.settledAt,p_idempotency_key:body.idempotencyKey,
        p_transaction_reference:body.transactionReference,p_evidence_reference:body.settlementEvidenceReference}));
    }
    if(action==='mark_paid') {
      if(!uuid.test(body.benefitId ?? '') || typeof body.transferReference!=='string' || !body.transferReference.trim()
        || body.transferReference.length>120 || typeof body.paidAt!=='string' || !Number.isFinite(Date.parse(body.paidAt)))
        return fail('invalid_transfer','실제 이체 내역을 확인해 주세요.');
      return json(await rpc('mark_platform_benefit_paid',{p_admin_id:signed.adminId,p_benefit_id:body.benefitId,
        p_paid_at:body.paidAt,p_transfer_reference:body.transferReference}));
    }
    return fail('unknown_action','요청을 확인해 주세요.');
  } catch(error) {
    const message=error instanceof Error ? error.message : '';
    if(message==='invalid_session') return fail('invalid_app_session','로그인이 필요합니다.',401);
    if(action==='get_account' && ['common_membership_withdrawn','company_attestation_unavailable','common_membership_unavailable'].includes(message))
      return fail('enrollment_required',message==='common_membership_withdrawn'
        ? '탈퇴한 공통회원 계정은 자동으로 다시 등록하지 않습니다. 다시 가입하려면 공통 서비스 이용에 새로 동의해 주세요.'
        : '공통 서비스 이용에 새로 동의한 뒤 계속해 주세요.',409);
    if(message==='consent_required' || message==='enrollment_required') return fail(message,'모두온 공통 서비스 약관에 동의한 뒤 이용해 주세요.',409);
    if(message==='session_unavailable') return fail('session_verification_unavailable','로그인을 확인하지 못했습니다. 다시 시도해 주세요.',503);
    if(message==='common_membership_withdrawn') return fail(message,
      '탈퇴한 공통회원 계정은 자동으로 다시 등록하지 않습니다. 다시 가입하려면 공통 서비스 이용에 새로 동의해 주세요.',409);
    if(message==='invalid_referral') return fail(message,'유효한 보험 추천인을 선택해 주세요.');
    if(message==='already_exists') return fail('already_exists','이미 가입된 번호입니다. 로그인해 주세요.');
    if(message==='revision_conflict') return fail('revision_conflict','다른 관리자가 수정했습니다. 새로 불러온 뒤 다시 저장해 주세요.',409);
    if(message==='idempotency_conflict') return fail('idempotency_conflict','이미 처리된 요청과 내용이 다릅니다. 처리 내역을 확인해 주세요.',409);
    if(message==='settled_cancellation_requires_reconciliation') return fail(message,'정산된 거래는 별도 환불 정산이 필요합니다.',409);
    if(message==='report_range_too_large') return fail(message,'조회 기간을 줄이거나 특정 병원을 선택해 주세요.');
    if(message==='forbidden') return fail(message,'관리자만 처리할 수 있습니다.',403);
    if(['invalid_input','invalid_details','invalid_partner','invalid_settlement','application_unavailable','partner_unavailable','partner_service_conflict','invalid_transfer'].includes(message))
      return fail(message,'입력 정보와 현재 처리 상태를 확인해 주세요.');
    return fail('request_failed','요청을 처리하지 못했습니다. 입력을 확인한 뒤 다시 시도해 주세요.',503);
  }
},referralCorsHeaders());
