import { getEnv } from './request-board-auth.ts';

const NCP_SEND_TIMEOUT_MS = 10_000;
const NCP_REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export type SignupSmsResult =
  | {
      ok: true;
      deliveryState: 'accepted';
      status: 200;
      providerRequestId: string | null;
      providerStatusCode: '202' | 'simulated';
    }
  | {
      ok: false;
      deliveryState: 'rejected' | 'unknown';
      status: 502 | 503;
      reason: 'missing_configuration' | 'request_build_failed' | 'provider_rejected' | 'invalid_provider_response' | 'network_error' | 'timeout';
      providerRequestId: string | null;
      providerStatusCode: string | null;
      message: string;
    };

function safeProviderValue(value: unknown, maxLength = 40) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= maxLength ? value : null;
}

/**
 * NCP only documents a request as accepted when both the HTTP status and the
 * response body say 202/success and a request id is present. A documented
 * statusName=fail or non-202 body status is a definite rejection. Other
 * incomplete HTTP 202 responses remain unknown so compensation cannot erase
 * an OTP that the provider may already have accepted.
 */
export function classifyNcpSendResponse(httpStatus: number, body: unknown): SignupSmsResult {
  if (httpStatus >= 400 && httpStatus < 500) {
    return {
      ok: false,
      deliveryState: 'rejected',
      status: 502,
      reason: 'provider_rejected',
      providerRequestId: null,
      providerStatusCode: body && typeof body === 'object' ? safeProviderValue((body as Record<string, unknown>).statusCode) : null,
      message: 'SMS 전송에 실패했습니다.',
    };
  }
  if (httpStatus !== 202) {
    return {
      ok: false,
      deliveryState: 'unknown',
      status: 503,
      reason: 'invalid_provider_response',
      providerRequestId: null,
      providerStatusCode: body && typeof body === 'object' ? safeProviderValue((body as Record<string, unknown>).statusCode) : null,
      message: 'SMS 접수 결과를 확인하지 못했습니다.',
    };
  }
  const response = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const requestId = response && typeof response.requestId === 'string' && NCP_REQUEST_ID.test(response.requestId)
    ? response.requestId
    : null;
  if (response?.statusCode === '202' && response.statusName === 'success' && requestId) {
    return { ok: true, deliveryState: 'accepted', status: 200, providerRequestId: requestId, providerStatusCode: '202' };
  }
  const providerStatusCode = response ? safeProviderValue(response.statusCode) : null;
  if (response?.statusName === 'fail' || (providerStatusCode !== null && providerStatusCode !== '202')) {
    return {
      ok: false,
      deliveryState: 'rejected',
      status: 502,
      reason: 'provider_rejected',
      providerRequestId: null,
      providerStatusCode,
      message: 'SMS 전송에 실패했습니다.',
    };
  }
  return {
    ok: false,
    deliveryState: 'unknown',
    status: 503,
    reason: 'invalid_provider_response',
    providerRequestId: requestId,
    providerStatusCode,
    message: 'SMS 접수 결과를 확인하지 못했습니다.',
  };
}

/** Shared NCP transport. Only local, non-hosted test environments may skip SMS. */
export async function sendSignupSms(phone: string, code: string, content: string, localTest = false): Promise<SignupSmsResult> {
  if (localTest) {
    if (getEnv('DENO_DEPLOYMENT_ID') || ['NODE_ENV','DENO_ENV','APP_ENV','ENVIRONMENT','SUPABASE_ENV','VERCEL_ENV'].map(getEnv)
      .some(value => ['prod','production'].includes((value ?? '').toLowerCase()))) throw new Error('Unsafe test SMS mode');
    return { ok: true, deliveryState: 'accepted', status: 200, providerRequestId: null, providerStatusCode: 'simulated' };
  }
  const access = getEnv('NCP_SENS_ACCESS_KEY') ?? getEnv('NCP_ACCESS_KEY');
  const secret = getEnv('NCP_SENS_SECRET_KEY') ?? getEnv('NCP_SECRET_KEY');
  const service = getEnv('NCP_SENS_SERVICE_ID') ?? getEnv('NCP_SMS_SERVICE_ID');
  const from = getEnv('NCP_SENS_SMS_FROM') ?? getEnv('NCP_SMS_SENDER');
  if (!access || !secret || !service || !from) {
    return {
      ok: false, deliveryState: 'rejected', status: 503, reason: 'missing_configuration',
      providerRequestId: null, providerStatusCode: null, message: 'SMS 설정이 필요합니다.',
    };
  }
  const timestamp = Date.now().toString();
  const path = `/sms/v2/services/${service}/messages`;
  const encoder = new TextEncoder();
  let encodedSignature: string;
  let timeoutSignal: AbortSignal;
  try {
    const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature = await crypto.subtle.sign('HMAC',key,encoder.encode(`POST ${path}\n${timestamp}\n${access}`));
    encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    timeoutSignal = AbortSignal.timeout(NCP_SEND_TIMEOUT_MS);
  } catch {
    return {
      ok: false, deliveryState: 'rejected', status: 503, reason: 'request_build_failed',
      providerRequestId: null, providerStatusCode: null, message: 'SMS 요청을 만들지 못했습니다.',
    };
  }
  try {
    const response = await fetch(`https://sens.apigw.ntruss.com${path}`, {
      method:'POST', headers:{'Content-Type':'application/json','x-ncp-apigw-timestamp':timestamp,
        'x-ncp-iam-access-key':access,'x-ncp-apigw-signature-v2':encodedSignature},
      body:JSON.stringify({type:'SMS',contentType:'COMM',countryCode:'82',from,content,messages:[{to:phone}]}),
      signal:timeoutSignal,
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* A non-readable response is not evidence of rejection. */ }
    return classifyNcpSendResponse(response.status, body);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      ok: false,
      deliveryState: 'unknown',
      status: 503,
      reason: timedOut ? 'timeout' : 'network_error',
      providerRequestId: null,
      providerStatusCode: null,
      message: 'SMS 접수 결과를 확인하지 못했습니다.',
    };
  }
}
