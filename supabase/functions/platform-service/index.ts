import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serveWithConfiguredCors, referralCorsHeaders } from '../_shared/serve-with-cors.ts';
import { createPlatformMemberToken, getEnv, parsePlatformMemberToken, parseAppSessionTokenDetailed } from '../_shared/request-board-auth.ts';
import { verifySessionGeneration } from '../_shared/session-generation.ts';
import { hashPassword, signupCodeHash, toBase64 } from '../_shared/password-hash.ts';
import { sendSignupSms } from '../_shared/signup-sms.ts';
import { processPasswordResetChallenge } from '../_shared/password-reset-challenge.ts';
import { getKoreanYmd } from '../_shared/exam-payment-proof.ts';

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(supabaseUrl,serviceKey);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ['insurance','care','telecom','rental','car','hospital'];
const termsVersion = '2026-10-12';
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
      'invalid_settlement','application_unavailable','partner_unavailable','partner_service_conflict','forbidden','invalid_transfer','invalid_partner','report_range_too_large']
      .includes(error.message) ? error.message : 'database_error');
  return data;
}
async function legacyMember(phone:string) {
  const {data,error} = await db.from('platform_members').select('*').eq('phone',phone).eq('active',true).maybeSingle();
  if(error) throw new Error('database_error');
  return data;
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
    if(requireConsent && (member.terms_version!==termsVersion || !member.terms_accepted_at)) throw new Error('consent_required');
    return {member,adminId:null,generalMember:!platform.source};
  }
  const legacy = await parseAppSessionTokenDetailed(token);
  if(legacy.ok===false) throw new Error(legacy.code==='session_verification_unavailable' ? 'session_unavailable' : 'invalid_session');
  const signed = legacy.payload;
  const member = await legacyMember(signed.phone);
  if(!member || (signed.accountKind==='fc' ? member.fc_id!==signed.accountId
    : member.staff_account_kind!==signed.accountKind || member.staff_account_id!==signed.accountId)) throw new Error('enrollment_required');
  if(requireConsent && (member.terms_version!==termsVersion || !member.terms_accepted_at)) throw new Error('consent_required');
  let adminId:null|string=null;
  if(signed.role==='admin' && signed.staffType==='admin') {
    const {data:current,error}=await db.from('admin_accounts').select('id').eq('id',signed.accountId)
      .eq('active',true).eq('staff_type','admin').maybeSingle();
    if(error) throw new Error('session_unavailable');
    adminId=current?.id ?? null;
  }
  return {member,adminId,generalMember:false};
}
async function authResponse(member:{id:string;name:string;phone:string},version:number,source?:Parameters<typeof createPlatformMemberToken>[3],insuranceSession?:Record<string,unknown>) {
  const token = await createPlatformMemberToken(member.phone,member.id,version,source);
  if(!token) return fail('server_misconfigured','로그인 설정을 확인해 주세요.',503);
  return json({ok:true,role:'member',memberId:member.id,displayName:member.name,residentId:member.phone,appSessionToken:token,
    ...(insuranceSession ? {insuranceSession} : {})});
}

serveWithConfiguredCors(async request => {
  if(request.method!=='POST') return fail('method_not_allowed','허용되지 않은 요청입니다.',405);
  try {
    const body = await request.json();
    if(!body || typeof body!=='object' || Array.isArray(body)) return fail('invalid_input','요청을 확인해 주세요.');
    const action = body.action;
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
        if(recovery) {
          const {data:member,error}=await db.from('platform_members').select('id').eq('phone',phone).eq('active',true).is('fc_id',null).maybeSingle();
          if(error) throw new Error('database_error');
          if(!member) return fail('account_unavailable','일반 회원 계정을 확인해 주세요. 보험 계정은 보험 로그인에서 변경해 주세요.');
          const result=await processPasswordResetChallenge(db,{kind:'member',id:member.id,phone},
            {action:'issue',tokenHash:await signupCodeHash(code,`reset:${phone}`)});
          if(result.ok===false) { const {status,...failure}=result;return json(failure,status); }
        } else {
          const result = await rpc('issue_platform_signup_otp',{p_phone:phone,p_code_hash:await signupCodeHash(code,phone)});
          if(!result.ok) return fail(result.code,result.code==='already_exists' ? '이미 가입된 번호입니다. 로그인해 주세요.' : '잠시 후 다시 인증을 요청해 주세요.',429);
        }
        const sent = await sendSignupSms(phone,code,recovery ? `[모두온] 비밀번호 변경 코드: ${code} (15분 유효)`
          : `[모두온] 회원가입 인증 코드: ${code} (5분 유효)`,local);
        return sent.ok ? json({ok:true,sent:true}) : fail('sms_send_failed','인증 문자를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',503);
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
        const result=await rpc('register_platform_member',{p_phone:phone,p_code_hash:await signupCodeHash(body.code,phone),
          p_name:body.name.trim(),p_password_hash:await hashPassword(password,salt),p_password_salt:salt,p_referral_code:body.referralCode || null});
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
      if(!legacy.ok || !legacy.appSessionToken) return fail(legacy.code ?? 'invalid_password',legacy.message ?? '로그인 정보를 확인해 주세요.',401);
      const checked = await parseAppSessionTokenDetailed(legacy.appSessionToken);
      if(!checked.ok) throw new Error('invalid_session');
      const mapped=await legacyMember(checked.payload.phone);
      const {accountKind,accountId,sessionVersion,role}=checked.payload;
      if(!mapped || mapped.terms_version!==termsVersion || !mapped.terms_accepted_at
        || (accountKind==='fc' ? mapped.fc_id!==accountId : mapped.staff_account_kind!==accountKind || mapped.staff_account_id!==accountId))
        return json({ok:true,insuranceSession:legacy});
      return authResponse(mapped,sessionVersion,{accountKind,accountId,role},legacy);
    }
    if(action==='accept_terms') {
      if(body.termsAccepted!==true || body.termsVersion!==termsVersion) return fail('invalid_input','약관 내용을 확인하고 동의해 주세요.');
      const token=request.headers.get('x-app-session-token') ?? '';
      const platform=await parsePlatformMemberToken(token);
      if(platform) {
        const current=await actor(request,false);
        const {error}=await db.from('platform_members').update({terms_accepted_at:new Date().toISOString(),terms_version:termsVersion}).eq('id',current.member.id);
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
    const signed = await actor(request,action!=='delete_member');
    if(action==='delete_member') {
      if(body.confirmed!==true) return fail('forbidden','공통회원 본인의 탈퇴 확인이 필요합니다.',403);
      return json(await rpc('delete_platform_member',{p_member_id:signed.member.id}));
    }
    if(action==='apply') {
      if(!uuid.test(body.idempotencyKey ?? '')) return fail('invalid_input','신청 정보를 확인해 주세요.');
      return json(await rpc('create_platform_application',{p_member_id:signed.member.id,p_service_key:body.serviceKey,
        p_details:body.details,p_idempotency_key:body.idempotencyKey}));
    }
    if(action==='cancel_application') {
      if(!uuid.test(body.applicationId ?? '')) return fail('invalid_input','신청 정보를 확인해 주세요.');
      return json(await rpc('cancel_platform_application',{p_member_id:signed.member.id,p_application_id:body.applicationId}));
    }
    if(action==='get_account' || action==='verify') {
      const [applications,benefits] = await Promise.all([
        db.from('platform_service_applications').select('id,service_key,status,created_at').eq('member_id',signed.member.id).order('created_at',{ascending:false}).limit(100),
        db.from('platform_member_benefits').select('id,service_key,kind,amount,due_at,status').eq('member_id',signed.member.id).order('due_at',{ascending:false}).limit(100),
      ]);
      if(applications.error || benefits.error) throw new Error('database_error');
      return json({ok:true,member:{id:signed.member.id,name:signed.member.name,referralCode:signed.member.referral_code,
        referrerId:signed.member.referrer_id,createdAt:signed.member.created_at,
        termsAccepted:!!signed.member.terms_accepted_at && signed.member.terms_version===termsVersion,termsVersion:signed.member.terms_version},
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
    if(message==='consent_required' || message==='enrollment_required') return fail(message,'모두온 공통 서비스 약관에 동의한 뒤 이용해 주세요.',409);
    if(message==='session_unavailable') return fail('session_verification_unavailable','로그인을 확인하지 못했습니다. 다시 시도해 주세요.',503);
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
