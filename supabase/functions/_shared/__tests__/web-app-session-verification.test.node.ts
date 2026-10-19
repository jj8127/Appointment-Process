import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createWebAppSessionVerificationHandler } from '../web-app-session-verification.ts';
import { createPlatformMemberToken, parsePlatformMemberToken, parseAppSessionTokenDetailed, parseRequestBoardBridgeTokenDetailed } from '../request-board-auth.ts';
import { checkSessionGeneration } from '../session-generation.ts';
import { classifyNcpSendResponse, sendSignupSms } from '../signup-sms.ts';

const service = 'synthetic-service-role-transport';
const currentKey = 'synthetic-current-app-session-key';
const previousKey = 'synthetic-previous-app-session-key';
const claims = { accountKind: 'admin' as const, accountId: '10000000-0000-4000-8000-000000000001', sessionVersion: 3 };
function signed(key = currentKey, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { kind: 'fc_onboarding_session', phone: '01000000000', role: 'admin',
    ...claims, iat: now, exp: now + 3600, ...overrides };
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${part}.${createHmac('sha256', key).update(part).digest('base64url')}`;
}
function request(token: string, authorization = `Bearer ${service}`, method = 'POST') {
  return new Request('https://example.invalid/verify-app-session', {
    method, headers: { authorization, 'x-app-session-token': token },
  });
}
async function withKeys(run: () => Promise<void>) {
  const names = ['FC_APP_SESSION_TOKEN_SECRET', 'FC_APP_SESSION_TOKEN_PREVIOUS_SECRET'];
  const old = names.map(name => process.env[name]);
  process.env[names[0]] = currentKey;
  process.env[names[1]] = previousKey;
  try { await run(); } finally {
    names.forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index]; });
  }
}

test('requires the exact existing server transport before token verification', async () => {
  let calls = 0;
  const handler = createWebAppSessionVerificationHandler(async () => {
    calls++; throw new Error('must not verify');
  }, () => service);
  for (const auth of ['', 'Bearer public-anon-key', `Bearer ${service}x`, `bearer ${service}`]) {
    const result = await handler(request(signed(), auth));
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { ok: false, code: 'forbidden' });
  }
  assert.equal(calls, 0);
  assert.equal((await handler(request('', `Bearer ${service}`, 'GET'))).status, 405);
  assert.equal((await createWebAppSessionVerificationHandler(undefined, () => '')(request(''))).status, 503);
});

test('verifies real current and previous signatures, then returns only fresh bound claims', async () => {
  await withKeys(async () => {
    let reads = 0;
    const handler = createWebAppSessionVerificationHandler(token => parseAppSessionTokenDetailed(token, async input => {
      reads++; return checkSessionGeneration(input, claims);
    }), () => service);
    for (const key of [currentKey, previousKey]) {
      const response = await handler(request(signed(key, { staffType: 'developer', unexpectedPrivateData: 'synthetic' })));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      const data = await response.json();
      assert.deepEqual(Object.keys(data.payload).sort(), ['accountId', 'accountKind', 'exp', 'iat', 'kind', 'phone', 'role', 'sessionVersion']);
      assert.deepEqual(data.payload.accountKind, claims.accountKind);
      assert.equal(data.payload.sessionVersion, 3);
      assert.equal(data.ok, true);
      assert.equal(JSON.stringify(data).includes('unexpectedPrivateData'), false);
      assert.equal(JSON.stringify(data).includes(key), false);
    }
    assert.equal(reads, 2);
  });
});

test('rejects malformed, forged, wrong-domain, expired and revoked sessions without granting identity', async () => {
  await withKeys(async () => {
    let reads = 0;
    const handler = createWebAppSessionVerificationHandler(token => parseAppSessionTokenDetailed(token, async input => {
      reads++; return checkSessionGeneration(input, claims);
    }), () => service);
    const tokens = ['', 'x'.repeat(8193), 'invalid', signed('synthetic-attacker-key'),
      signed(currentKey, { kind: 'request_board_bridge' }),
      signed(currentKey, { exp: 1 }), signed(currentKey, { sessionVersion: 2 }),
      signed(currentKey, { accountId: '20000000-0000-4000-8000-000000000001' })];
    for (const token of tokens) {
      const response = await handler(request(token));
      assert.equal(response.status, 401);
      assert.equal('payload' in await response.json(), false);
    }
    assert.equal(reads, 2);
  });
});

test('canonical-generation outages and unexpected verifier failures remain closed as503', async () => {
  await withKeys(async () => {
    for (const verifier of [
      (token: string) => parseAppSessionTokenDetailed(token, async () => ({ ok: false, reason: 'unavailable' })),
      async () => { throw new Error('synthetic error with private context'); },
    ]) {
      const response = await createWebAppSessionVerificationHandler(verifier, () => service)(request(signed()));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, code: 'session_verification_unavailable' });
    }
  });
});

test('real consumer signatures parse only as platform members, never as an insurance app session',async()=>{
  await withKeys(async()=>{
    const token=await createPlatformMemberToken('00000000011',claims.accountId,4);
    assert.ok(token);
    const member=await parsePlatformMemberToken(token);
    assert.equal(member?.memberId,claims.accountId);
    assert.equal(member?.sessionVersion,4);
    let legacyReads=0;
    const insurance=await parseAppSessionTokenDetailed(token,async()=>{legacyReads++;return {ok:true,claims};});
    assert.equal(insurance.ok,false);assert.equal(legacyReads,0);
    const oldBridgeSecret=process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET;
    process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET=currentKey;
    try {
      assert.equal((await parseRequestBoardBridgeTokenDetailed(token,async()=>{legacyReads++;return {ok:true,claims};})).ok,false);
      assert.equal(legacyReads,0);
    } finally {
      if(oldBridgeSecret===undefined) delete process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET;
      else process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET=oldBridgeSecret;
    }
    assert.equal(await parsePlatformMemberToken(`${token}.extra`),null);
    assert.equal(await parsePlatformMemberToken(signed()),null);
  });
});

test('the shared signup SMS test transport cannot bypass delivery in hosted or production environments',async()=>{
  for(const name of ['DENO_DEPLOYMENT_ID','VERCEL_ENV']) {
    const previous=process.env[name];
    process.env[name]=name==='VERCEL_ENV' ? 'production' : 'synthetic-hosted-deployment';
    try {await assert.rejects(sendSignupSms('00000000011','123456','synthetic message',true),/Unsafe test SMS mode/);}
    finally {if(previous===undefined) delete process.env[name];else process.env[name]=previous;}
  }
});

test('NCP send acceptance requires the documented HTTP/body result and a constrained request id',()=>{
  assert.deepEqual(classifyNcpSendResponse(202,{statusCode:'202',statusName:'success',requestId:'synthetic-request:1'}),{
    ok:true,deliveryState:'accepted',status:200,providerRequestId:'synthetic-request:1',providerStatusCode:'202',
  });
  assert.deepEqual(classifyNcpSendResponse(400,{statusCode:'400',statusName:'fail'}),{
    ok:false,deliveryState:'rejected',status:502,reason:'provider_rejected',
    providerRequestId:null,providerStatusCode:'400',message:'SMS 전송에 실패했습니다.',
  });
  for(const body of [
    {statusCode:'202',statusName:'fail',requestId:'synthetic-request:2'},
    {statusCode:'500',statusName:'success',requestId:'synthetic-request:3'},
  ]) {
    const rejected=classifyNcpSendResponse(202,body);
    assert.equal(rejected.ok,false);
    if(!rejected.ok) {
      assert.equal(rejected.deliveryState,'rejected');
      assert.equal(rejected.reason,'provider_rejected');
      assert.equal(rejected.providerRequestId,null);
    }
  }
  for(const status of [200,204,302,500]) {
    const ambiguous=classifyNcpSendResponse(status,{statusCode:String(status),statusName:'unexpected'});
    assert.equal(ambiguous.ok,false);
    if(!ambiguous.ok) assert.equal(ambiguous.deliveryState,'unknown');
  }
  const malformed=classifyNcpSendResponse(202,{statusCode:'202',statusName:'success',requestId:'invalid request id'});
  assert.equal(malformed.ok,false);
  if(!malformed.ok) {
    assert.equal(malformed.deliveryState,'unknown');
    assert.equal(malformed.reason,'invalid_provider_response');
    assert.equal(malformed.providerRequestId,null);
  }
});

test('NCP timeouts remain unknown while local configuration rejection is definite',async()=>{
  const names=['NCP_SENS_ACCESS_KEY','NCP_SENS_SECRET_KEY','NCP_SENS_SERVICE_ID','NCP_SENS_SMS_FROM'];
  const previous=names.map(name=>process.env[name]);
  const originalFetch=globalThis.fetch;
  try {
    names.forEach(name=>delete process.env[name]);
    const missing=await sendSignupSms('00000000011','123456','synthetic message');
    assert.equal(missing.ok,false);
    if(!missing.ok) assert.equal(missing.deliveryState,'rejected');

    names.forEach((name,index)=>{process.env[name]=`synthetic-${index}`;});
    globalThis.fetch=async()=>{throw new DOMException('synthetic timeout','TimeoutError');};
    const timeout=await sendSignupSms('00000000011','123456','synthetic message');
    assert.equal(timeout.ok,false);
    if(!timeout.ok) {
      assert.equal(timeout.deliveryState,'unknown');
      assert.equal(timeout.reason,'timeout');
    }
  } finally {
    globalThis.fetch=originalFetch;
    names.forEach((name,index)=>{if(previous[index]===undefined) delete process.env[name];else process.env[name]=previous[index];});
  }
});
