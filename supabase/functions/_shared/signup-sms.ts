import { getEnv } from './request-board-auth.ts';

/** Shared NCP transport. Only local, non-hosted test environments may skip SMS. */
export async function sendSignupSms(phone: string, code: string, content: string, localTest = false) {
  if (localTest) {
    if (getEnv('DENO_DEPLOYMENT_ID') || ['NODE_ENV','DENO_ENV','APP_ENV','ENVIRONMENT','SUPABASE_ENV','VERCEL_ENV'].map(getEnv)
      .some(value => ['prod','production'].includes((value ?? '').toLowerCase()))) throw new Error('Unsafe test SMS mode');
    return { ok: true, status: 200 };
  }
  const access = getEnv('NCP_SENS_ACCESS_KEY') ?? getEnv('NCP_ACCESS_KEY');
  const secret = getEnv('NCP_SENS_SECRET_KEY') ?? getEnv('NCP_SECRET_KEY');
  const service = getEnv('NCP_SENS_SERVICE_ID') ?? getEnv('NCP_SMS_SERVICE_ID');
  const from = getEnv('NCP_SENS_SMS_FROM') ?? getEnv('NCP_SMS_SENDER');
  if (!access || !secret || !service || !from) return { ok: false, status: 503, message: 'SMS 설정이 필요합니다.' };
  const timestamp = Date.now().toString();
  const path = `/sms/v2/services/${service}/messages`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('HMAC',key,encoder.encode(`POST ${path}\n${timestamp}\n${access}`));
  const response = await fetch(`https://sens.apigw.ntruss.com${path}`, {
    method:'POST', headers:{'Content-Type':'application/json','x-ncp-apigw-timestamp':timestamp,
      'x-ncp-iam-access-key':access,'x-ncp-apigw-signature-v2':btoa(String.fromCharCode(...new Uint8Array(signature)))},
    body:JSON.stringify({type:'SMS',contentType:'COMM',countryCode:'82',from,content,messages:[{to:phone}]}),
    signal:AbortSignal.timeout(10000),
  });
  return response.ok ? {ok:true,status:200} : {ok:false,status:503,message:'SMS 전송에 실패했습니다.'};
}
