import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../../../', import.meta.url);

test('document writes require database receipts and admin handoff reuses the guarded action', async () => {
  const source = await readFile(new URL('app/docs-upload.tsx', root), 'utf8');
  assert.match(source, /requireMutationRowReceipt/);
  assert.match(source, /loadAllDocuments\(targetId\)/);
  assert.match(source, /collectSupabaseRows<DocumentRow>/);
  assert.match(source, /\.range\(from, to\)/);
  assert.match(source, /requireMutationRowReceipt\(documentReceipt, documentMutation\)/);
  assert.match(source, /requireMutationRowReceipt\(profileReceipt, \{ id: fc\.id, status: 'docs-pending' \}\)/);
  assert.match(source, /invokeAdminAction\(residentId \?\? '', 'updateStatus'/);
  assert.doesNotMatch(source, /const requestedDocs = allDocs \?\? \[\]/);
  assert.doesNotMatch(source, /updated \?\? \{ id:/);
});
async function extract(file, name, context) {
  const source = await readFile(new URL(file, root), 'utf8');
  const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(ast)===name) expression=node.getText(ast);
    if (name === 'handler' && ts.isCallExpression(node) && ['serve','serveWithConfiguredCors'].includes(node.expression.getText(ast))) {
      expression = node.arguments[0].getText(ast);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast)===name) {
      const init = node.initializer;
      expression = ts.isCallExpression(init) && init.expression.getText(ast)==='useCallback' ? init.arguments[0].getText(ast) : init.getText(ast);
    }
    ts.forEachChild(node,visit);
  }
  visit(ast); assert.ok(expression,`${file}:${name} exists`);
  const compiled=ts.transpileModule(`globalThis.run = ${expression.replace(/^export\s+(?:default\s+)?/,'')}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const scope=vm.createContext({ ...context, Date, Map, Set, Promise, String, Boolean, Array, Number, console: {warn(){}} });
  vm.runInContext(compiled,scope); return scope.run;
}
test('platform admin permission is rechecked from current admin facts after a signed staff downgrade',async()=>{
  for(const current of [null,{id:'synthetic-current-admin'}]) {
    const calls=[];
    const run=await extract('supabase/functions/platform-service/index.ts','actor',{
      parsePlatformMemberToken:async()=>null,
      parseAppSessionTokenDetailed:async()=>({ok:true,payload:{phone:'00000000001',role:'admin',staffType:'admin',accountKind:'admin',accountId:'synthetic-current-admin'}}),
      legacyMember:async()=>({id:'synthetic-member',staff_account_kind:'admin',staff_account_id:'synthetic-current-admin',terms_version:'2026-10-12',terms_accepted_at:'2026-10-12T00:00:00Z'}),termsVersion:'2026-10-12',
      db:{from(table){calls.push(['table',table]);return this;},select(){return this;},
        eq(field,value){calls.push([field,value]);return this;},maybeSingle:async()=>({data:current,error:null})},
    });
    const result=await run(new Request('https://synthetic.invalid',{headers:{'x-app-session-token':'synthetic-signed'}}));
    assert.equal(result.adminId,current?.id ?? null);
    assert.ok(calls.some(([field,value])=>field==='staff_type' && value==='admin'));
    assert.ok(calls.some(([field,value])=>field==='active' && value===true));
  }
});

test('platform consumer token resolves its bound member and rejects revoked credentials',async()=>{
  for(const version of [3,4,null]) {
    const filters=[];
    let table;
    const run=await extract('supabase/functions/platform-service/index.ts','actor',{
      parsePlatformMemberToken:async()=>({memberId:'signed-member-id',phone:'00000000011',sessionVersion:4}),
      termsVersion:'2026-10-12',
      db:{from(value){table=value;return this;},select(){return this;},eq(field,value){filters.push([field,value]);return this;},
        maybeSingle:async()=>({data:table==='platform_members' ? {id:'signed-member-id',terms_version:'2026-10-12',terms_accepted_at:'2026-10-12T00:00:00Z'} : version===null ? null : {session_version:version},error:null})},
    });
    const request=new Request('https://synthetic.invalid',{headers:{'x-app-session-token':'synthetic-token'}});
    if(version===4) assert.equal((await run(request)).member.id,'signed-member-id');
    else await assert.rejects(run(request),/invalid_session/);
    assert.ok(filters.some(([field,value])=>field==='id' && value==='signed-member-id'));
  }
});

test('hospital advertising date filters use the same Korean calendar date at midnight boundaries',async()=>{
  const koreanDate=await extract('supabase/functions/_shared/exam-payment-proof.ts','getKoreanYmd',{Intl});
  for(const [instant,expected] of [['2026-10-10T14:59:59Z','2026-10-10'],['2026-10-10T15:00:00Z','2026-10-11']]) {
    const calls=[];
    const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
      getKoreanYmd:()=>koreanDate(new Date(instant)),hospitalProvinces:{'11':'서울'},
      rpc:async(name,args)=>{calls.push({name,args});return {hospitals:[],featured:[],hasMore:false,nextOffset:null};},
      json:(body,status=200)=>new Response(JSON.stringify(body),{status}),fail:()=>{throw new Error('unexpected failure');},
    });
    const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'list_hospitals',rotationBucket:'client-owned-attempt'})}));
    assert.equal(response.status,200);assert.equal(calls[0].name,'get_platform_hospitals');assert.equal(calls[0].args.p_today,expected);
    assert.match(calls[0].args.p_filters.rotationBucket,/^\d+$/);assert.notEqual(calls[0].args.p_filters.rotationBucket,'client-owned-attempt');
  }
});

test('platform consent blocks common reads without enrolling legacy accounts and can be explicitly accepted',async()=>{
  const member={id:'signed-member-id',terms_version:null,terms_accepted_at:null};
  let table;
  const context={termsVersion:'2026-10-12',parsePlatformMemberToken:async()=>({memberId:member.id,phone:'00000000011',sessionVersion:4}),
    db:{from(value){table=value;return this;},select(){return this;},eq(){return this;},
      maybeSingle:async()=>({data:table==='platform_members' ? member : {session_version:4},error:null})}};
  const current=await extract('supabase/functions/platform-service/index.ts','actor',context);
  const request=new Request('https://synthetic.invalid',{headers:{'x-app-session-token':'synthetic-token'}});
  await assert.rejects(current(request),/consent_required/);
  assert.equal((await current(request,false)).member.id,member.id);
  const calls=[];
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    termsVersion:'2026-10-12',parsePlatformMemberToken:async()=>null,
    parseAppSessionTokenDetailed:async()=>({ok:true,payload:{accountKind:'fc',accountId:'signed-fc-id',phone:'00000000002'}}),
    db:{from(value){calls.push(value);return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{name:'Synthetic FC'},error:null})},
    rpc:async(name,args)=>{calls.push({name,args});return {ok:true};},
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  const accepted=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-app-session-token':'signed-fc'},
    body:JSON.stringify({action:'accept_terms',termsAccepted:true,termsVersion:'2026-10-12',phone:'00000000099',fcId:'client-owned'})}));
  assert.equal(accepted.status,200);assert.equal(calls[1].name,'enroll_platform_legacy_member');
  assert.equal(calls[1].args.p_phone,'00000000002');assert.equal(calls[1].args.p_fc_id,'signed-fc-id');
  assert.equal(calls[1].args.p_account_kind,'fc');assert.equal(calls[1].args.p_account_id,'signed-fc-id');
});

test('insurance registration uses only the signed common owner and requires explicit confirmation before any write',async()=>{
  const memberId='20000000-0000-4000-8000-000000000001',fcId='10000000-0000-4000-8000-000000000001';
  const key='30000000-0000-4000-8000-000000000001',phone='00000000011';
  const body={confirmed:true,consentAccepted:true,consentVersion:'insurance-additional-info-v1',idempotencyKey:key,
    affiliation:'가람',email:'synthetic@example.invalid',carrier:'KT',licenseStatuses:['life'],referralCode:'synthetic',
    referralInviterFcId:fcId,memberId:'client-spoof',phone:'00000000099',name:'Client Spoof'};
  const calls=[];let linked=false;let unavailable=false;
  const run=await extract('supabase/functions/platform-service/index.ts','insuranceEnrollment',{
    crypto:webcrypto,TextEncoder,insuranceConsentVersion:'insurance-additional-info-v1',supabaseUrl:'https://synthetic.invalid',serviceKey:'synthetic-service',
    uuid:/^[0-9a-f-]{36}$/i,
    parsePlatformMemberToken:async()=>({memberId,phone,sessionVersion:3}),
    actor:async()=>{calls.push('verified-current-common-owner');return {member:{id:memberId,phone}};},
    db:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:memberId,phone,
      fc_id:linked ? fcId : null,insurance_enrollment_key:key,insurance_enrollment_member_version:3,insurance_enrollment_fc_version:4},error:null})},
    verifySessionGeneration:async()=>unavailable ? {ok:false,reason:'invalid'} : {ok:true},
    rpc:async(name,args)=>{calls.push({name,args});linked=true;return {ok:true,fcId,sessionVersion:4,alreadyApplied:false};},
    legacyMember:async()=>({id:memberId,phone,fc_id:fcId}),insuranceSession:async()=>({ok:true,appSessionToken:'signed-insurance'}),
    parseAppSessionTokenDetailed:async()=>({ok:true,payload:{accountId:fcId,sessionVersion:4}}),
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  const request=new Request('https://synthetic.invalid',{headers:{'x-app-session-token':'signed-common'}});
  assert.equal((await run(request,{...body,confirmed:false})).status,400);assert.deepEqual(calls,[]);
  const response=await run(request,body);assert.equal(response.status,200);
  assert.equal(calls[0],'verified-current-common-owner');assert.equal(calls[1].name,'enroll_platform_insurance_v1');
  assert.equal(calls[1].args.p_member_id,memberId);assert.equal(calls[1].args.p_phone,phone);
  assert.equal(calls[1].args.p_member_session_version,3);assert.equal('p_name' in calls[1].args,false);
  assert.match(calls[1].args.p_request_fingerprint,/^[a-f0-9]{64}$/);
  calls.length=0;await run(request,body);assert.equal(calls.length,1);
  unavailable=true;calls.length=0;await assert.rejects(run(request,body),/invalid_session/);assert.deepEqual(calls,[]);
});

test('existing insurance session preserves ordinary admin, developer, manager and linked designer role contracts',async()=>{
  for(const [kind,staffType,affiliation,expectedRole] of [
    ['admin','admin',null,null],['admin','developer',null,'fc'],['manager',null,null,'fc'],['fc',null,'Synthetic 설계매니저','designer'],['fc',null,'가람','fc']]) {
    const calls=[];let table;
    const run=await extract('supabase/functions/platform-service/index.ts','insuranceSession',{
      db:{from(value){table=value;return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='fc_credentials'
        ? {session_version:4,password_set_at:'2026-01-01',must_change_password:false}
        : {id:'source-id',name:'Synthetic Name',phone:'00000000011',active:true,signup_completed:true,
          is_manager_referral_shadow:false,password_set_at:'2026-01-01',session_version:4,staff_type:staffType,affiliation},error:null})},
      parseDesignerCompanyNameFromAffiliation:value=>value?.includes('설계매니저') ? 'Synthetic' : null,
      resolveManagerAffiliation:()=> 'Synthetic Canonical Manager',
      createAppSessionToken:async(...args)=>{calls.push(['app',...args]);return 'synthetic-app';},
      createRequestBoardBridgeToken:async(...args)=>{calls.push(['bridge',...args]);return 'synthetic-bridge';},
    });
    const member={phone:'00000000011',...(kind==='fc' ? {fc_id:'source-id'} : {staff_account_kind:kind,staff_account_id:'source-id'})};
    const session=await run(member,4);assert.equal(session.requestBoardRole,expectedRole);
    assert.equal(session.role,kind);assert.equal(session.readOnly,kind==='manager');
    if(kind==='manager') assert.equal(calls[1][3],'Synthetic Canonical Manager');
    if(kind==='admin' && staffType==='admin') assert.equal(calls[1][2],'admin');
    await assert.rejects(run(member,3),/invalid_session/);
  }
});

test('common insurance referral search authenticates first, forwards only explicit query and strips extra identity fields',async()=>{
  const calls=[];
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    supabaseUrl:'https://synthetic.invalid',getEnv:()=> 'synthetic-anon',uuid:/^[0-9a-f-]{36}$/i,AbortSignal,
    actor:async()=>{calls.push('authenticated');return {member:{id:'signed-member',phone:'00000000011'}};},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true,
      results:[{fcId:'10000000-0000-4000-8000-000000000001',name:'Synthetic Recruiter',affiliation:'가람',code:'SYNTHETIC',phone:'00000000099'}]}));},
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),fail:()=>{throw new Error('unexpected failure');},
  });
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'search_insurance_referral',query:'Synthetic',phone:'client-spoof'})}));
  assert.equal(calls[0],'authenticated');assert.deepEqual(calls[1].body,{query:'Synthetic'});
  const data=await response.json();assert.deepEqual(Object.keys(data.results[0]),['fcId','name','affiliation','code']);
});

test('common login keeps legacy temporary-password recovery metadata without accepting role claims from the caller',async()=>{
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    supabaseUrl:'https://synthetic.invalid',getEnv:()=> 'synthetic-anon',AbortSignal,
    db:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})},
    fetch:async()=>new Response(JSON.stringify({ok:false,code:'password_change_required',message:'Synthetic Recovery',role:'fc',
      passwordChangeToken:'synthetic-change-proof',passwordChangeExpiresAt:'2026-10-14T12:00:00Z'})),
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'login',phone:'00000000011',password:'Synthetic!123',role:'admin'})}));
  assert.equal(response.status,401);const body=await response.json();
  assert.equal(body.role,'fc');assert.equal(body.passwordChangeToken,'synthetic-change-proof');assert.equal(body.code,'password_change_required');
});

test('one common recovery UI delegates insurance/staff accounts to their existing OTP reset boundary',async()=>{
  for(const [action,kind] of [['request_password_reset','fc'],['reset_password','manager']]) {
    const calls=[];
    const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
      supabaseUrl:'https://synthetic.invalid',getEnv:()=> 'synthetic-anon',AbortSignal,
      db:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'synthetic-member',
        ...(kind==='fc' ? {fc_id:'synthetic-fc'} : {staff_account_id:'synthetic-manager'})},error:null})},
      fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true,sent:true}));},
      json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
      fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
    });
    const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action,phone:'00000000011',
      code:'123456',password:'Synthetic!123',kind:'client-spoof',fcId:'client-spoof'})}));
    assert.equal(response.status,200);assert.equal(calls.length,1);
    assert.equal(calls[0].url,`https://synthetic.invalid/functions/v1/${action==='request_password_reset' ? 'request-password-reset' : 'reset-password'}`);
    assert.deepEqual(calls[0].body,action==='request_password_reset' ? {phone:'00000000011'}
      : {phone:'00000000011',code:'123456',password:'Synthetic!123',confirm:'Synthetic!123'});
  }
});

async function extractIfBranch(file, condition, context) {
  const source = await readFile(new URL(file, root), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let statement;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === condition) {
      statement = node.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(statement, `${file}:${condition} exists`);
  const compiled = ts.transpileModule(`globalThis.run = async () => { ${statement} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const scope = vm.createContext({
    ...context,
    Date,
    Map,
    Set,
    Promise,
    String,
    Boolean,
    Array,
    Number,
  });
  vm.runInContext(compiled, scope);
  return scope.run;
}
async function loadUxMutationContract() {
  const source = await readFile(new URL('supabase/functions/_shared/ux-mutation-contract.ts', root), 'utf8');
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports });
  return module.exports;
}
async function calendar() {
  const source=await readFile(new URL('lib/calendar-date.ts',root),'utf8');
  const module={exports:{}}; vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports});
  return module.exports;
}
async function examDisplay() {
  const validationSource = await readFile(new URL('lib/validation.ts', root), 'utf8');
  const validationModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(validationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module: validationModule, exports: validationModule.exports },
  );
  const source = await readFile(new URL('lib/exam-display.ts', root), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name === '@/lib/validation') return validationModule.exports;
        throw new Error(`Unexpected exam-display dependency: ${name}`);
      },
    },
  );
  return module.exports;
}

test('shared mutation receipts reject null, partial, mismatched, and malformed database success values', async () => {
  const {
    mutationRowReceiptMatches,
    requireAccountDeletionReceipt,
    requireExamTransitionReceipt,
    requireMutationRowReceipt,
  } = await loadUxMutationContract();
  const registrationId = '00000000-0000-4000-8000-000000000001';
  const transition = {
    registration_id: registrationId,
    status: 'confirmed',
    proof_path: null,
    target_resident_id: '01000000001',
    exam_type: 'life',
    notification_id: '00000000-0000-4000-8000-000000000002',
    recipient_actor_id: '00000000-0000-4000-8000-000000000003',
  };
  assert.equal(requireExamTransitionReceipt([transition], registrationId, 'confirm').status, 'confirmed');
  for (const value of [
    null,
    [],
    [transition, transition],
    { ...transition, registration_id: '00000000-0000-4000-8000-000000000004' },
    { ...transition, status: 'rejected' },
    { ...transition, exam_type: 'unknown' },
    { ...transition, notification_id: undefined },
  ]) {
    assert.throws(() => requireExamTransitionReceipt(value, registrationId, 'confirm'), /mutation_receipt_unverified/);
  }

  const deletion = {
    deleted: true,
    cleanup_outbox_id: '00000000-0000-4000-8000-000000000005',
    proof_paths: [],
    document_paths: ['fc/document.pdf'],
    board_attachment_paths: [],
    chat_file_urls: [],
    auth_user_ids: ['00000000-0000-4000-8000-000000000006'],
  };
  assert.equal(requireAccountDeletionReceipt(deletion).deleted, true);
  for (const value of [
    null,
    { ...deletion, deleted: false },
    { ...deletion, cleanup_outbox_id: 'invalid' },
    { ...deletion, proof_paths: null },
    { ...deletion, document_paths: [''] },
    { ...deletion, auth_user_ids: ['invalid'] },
  ]) {
    assert.throws(() => requireAccountDeletionReceipt(value), /mutation_receipt_unverified/);
  }

  assert.equal(
    requireMutationRowReceipt(
      { id: registrationId, status: 'saved', updated_at: '2026-10-13T09:00:00.000+09:00' },
      { id: registrationId, status: 'saved', updated_at: '2026-10-13T00:00:00.000Z' },
    ).status,
    'saved',
  );
  assert.equal(
    mutationRowReceiptMatches(
      { read_at: '2026-10-13T00:00:00.000+00:00', dismissed_at: null },
      { read_at: '2026-10-13T00:00:00.000Z', dismissed_at: null },
    ),
    true,
  );
  assert.throws(
    () => requireMutationRowReceipt(null, { id: registrationId }),
    /mutation_receipt_unverified/,
  );
  assert.throws(
    () => requireMutationRowReceipt({ id: registrationId, status: 'old' }, { id: registrationId, status: 'saved' }),
    /mutation_receipt_unverified/,
  );
  assert.equal(mutationRowReceiptMatches(
    { id: registrationId, status: 'saved' },
    { id: registrationId, status: 'saved' },
  ), true);
  assert.equal(mutationRowReceiptMatches(null, { id: registrationId }), false);
  assert.equal(mutationRowReceiptMatches(
    { id: registrationId, status: 'old' },
    { id: registrationId, status: 'saved' },
  ), false);
});

test('all account deletion entrypoints verify the complete receipt before cleanup side effects', async () => {
  for (const [file, cleanupMarker] of [
    ['supabase/functions/admin-action/index.ts', "supabase.storage.from('exam-payment-proofs').remove"],
    ['supabase/functions/delete-account/index.ts', 'drainAccountDeletionCleanup('],
    ['web/src/app/api/fc-delete/route.ts', 'removeStorageObjects('],
  ]) {
    const source = await readFile(new URL(file, root), 'utf8');
    const receipt = source.indexOf('requireAccountDeletionReceipt(data)');
    const cleanup = source.indexOf(cleanupMarker, receipt);
    assert.ok(receipt >= 0, `${file} validates the account deletion receipt`);
    assert.ok(cleanup > receipt, `${file} validates before cleanup`);
  }
});

test('privileged Edge handlers do not expose raw RPC or thrown error messages', async () => {
  const adminAction = await readFile(new URL('supabase/functions/admin-action/index.ts', root), 'utf8');
  const deleteAccount = await readFile(new URL('supabase/functions/delete-account/index.ts', root), 'utf8');
  assert.doesNotMatch(adminAction, /fail\(error\.message/);
  assert.doesNotMatch(adminAction, /err\?\.message/);
  assert.doesNotMatch(deleteAccount, /err\(error\.message/);
});

test('admin action row mutations reject zero-row success before downstream effects', async () => {
  const { requireMutationRowReceipt } = await loadUxMutationContract();
  const fcId = '00000000-0000-4000-8000-000000000001';

  let profileReceipt = null;
  const profileQuery = {
    update() { return this; },
    eq() { return this; },
    select() { return this; },
    maybeSingle: async () => ({ data: profileReceipt, error: null }),
  };
  const updateProfile = await extractIfBranch(
    'supabase/functions/admin-action/index.ts',
    "action === 'updateProfile'",
    {
      action: 'updateProfile',
      payload: { fcId, data: { career_type: '경력' } },
      supabase: { from: () => profileQuery },
      fail: (message, status = 400) => ({ ok: false, message, status }),
      json: (body) => body,
      requireMutationRowReceipt,
    },
  );
  await assert.rejects(updateProfile(), /mutation_receipt_unverified/);
  profileReceipt = { id: fcId, career_type: '신입' };
  await assert.rejects(updateProfile(), /mutation_receipt_unverified/);
  profileReceipt = { id: fcId, career_type: '경력' };
  assert.equal((await updateProfile()).ok, true);

  let workflowCalls = 0;
  const updateDocument = await extractIfBranch(
    'supabase/functions/admin-action/index.ts',
    "action === 'updateDocStatus'",
    {
      action: 'updateDocStatus',
      payload: { fcId, docType: 'proof', status: 'approved' },
      supabase: {
        from() {
          let operation = 'read';
          return {
            select() { return this; },
            update() { operation = 'update'; return this; },
            eq() { return this; },
            maybeSingle: async () => operation === 'read'
              ? { data: { storage_path: 'proof.pdf' }, error: null }
              : { data: null, error: null },
          };
        },
      },
      fail: (message, status = 400) => ({ ok: false, message, status }),
      json: (body) => body,
      requireMutationRowReceipt,
      syncProfileAfterDocMutation: async () => { workflowCalls += 1; return { allApproved: true }; },
    },
  );
  await assert.rejects(updateDocument(), /mutation_receipt_unverified/);
  assert.equal(workflowCalls, 0);
});

test('admin exam round saves require a UUID receipt matching an updated round', async () => {
  const { requireCreationReceipt } = await loadUxMutationContract();
  const roundId = '00000000-0000-4000-8000-000000000001';
  let rpcReceipt = 'not-a-uuid';
  const save = await extractIfBranch(
    'supabase/functions/admin-action/index.ts',
    "action === 'upsertExamRound'",
    {
      action: 'upsertExamRound',
      payload: {
        roundId,
        data: {
          exam_type: 'life',
          exam_date: '2026-10-20',
          exam_month: '2026-10-01',
          registration_deadline: '2026-10-15',
          round_label: 'Synthetic round',
        },
        locations: [{ location_name: 'Seoul', sort_order: 0 }],
      },
      supabase: { rpc: async () => ({ data: rpcReceipt, error: null }) },
      trimOrNull: (value) => String(value ?? '').trim() || null,
      isCanonicalYmd: () => true,
      isCanonicalMonthStart: () => true,
      examMonthFromDate: () => '2026-10-01',
      fail: (message, status = 400) => ({ ok: false, message, status }),
      json: (body) => body,
      requireCreationReceipt,
    },
  );
  assert.equal((await save()).status, 500);
  rpcReceipt = '00000000-0000-4000-8000-000000000002';
  assert.equal((await save()).status, 500);
  rpcReceipt = roundId;
  assert.equal(JSON.stringify(await save()), JSON.stringify({ ok: true, roundId }));
});
test('exam pending counts exclude latest cancelled/rejected applications while retaining valid applied results', async()=>{
  const phones=['01000000001','01000000002','01000000003','01000000004','01000000005'];
  const rows=[[phones[0],'applied',false],[phones[1],'cancelled',false],[phones[2],'rejected',false],[phones[3],'confirmed',true],[phones[4],'applied',false],[phones[4],'cancelled',false]].map(([resident_id,status,is_confirmed])=>({resident_id,status,is_confirmed,exam_rounds:{exam_type:'life'}}));
  const collectSupabaseRows=async({fetchPage})=>{const result=await fetchPage(0,499);if(result.error)throw result.error;if(!Array.isArray(result.data))throw new Error('query_contract_invalid');return result.data;};
  const { buildExamPhoneCandidates, normalizeExamSingle } = await examDisplay();
  const run=await extract('app/index.tsx','fetchExamStats',{
    buildExamPhoneCandidates,
    collectSupabaseRows,
    chunkSupabaseFilterValues:(values)=>[values],
    isExamStatsRegistrationRow:()=>true,
    isExamStatsProfileRow:()=>true,
    normalizeExamSingle,
    supabase:{from(table){return table==='exam_registrations'
      ?{select(){return this;},order(){return this;},range(){return Promise.resolve({data:rows,error:null});}}
      :{select(){return this;},in(){return this;},order(){return this;},range(){return Promise.resolve({data:phones.map((phone,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,phone})),error:null});}};}},
  });
  const result=await run(); assert.equal(result.lifeTotal,5);assert.equal(result.lifePending,1);assert.equal(result.nonlifePending,0);
});

test('old common withdrawal confirmation refuses the changed scope without any mutation or actor lookup',async()=>{
  const calls=[];
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    actor:async()=>{calls.push('actor');throw new Error('must not resolve old scope');},
    rpc:async()=>{calls.push('rpc');throw new Error('must not mutate old scope');},
    fail:(code,message,status)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  for(const confirmed of [false,true]) {
    const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'delete_member',confirmed})}));
    assert.equal(response.status,409);assert.equal((await response.json()).code,'upgrade_required');
  }
  assert.deepEqual(calls,[]);
});

async function withdrawalFixture(options={}) {
  const operation='00000000-0000-4000-8000-00000000000a',member='00000000-0000-4000-8000-000000000002';
  const fc='00000000-0000-4000-8000-000000000003',batch='00000000-0000-4000-8000-000000000004',digest='a'.repeat(64);
  const calls=[];
  const initial={operation_id:operation,member_id:member,source_fc_id:options.fc ? fc : null,
    session_digest:digest,local_erased:false,completed:false,cleanup_receipt:null,preserved_company_role:null};
  let job=options.resume ? {...initial,local_erased:true,cleanup_receipt:options.cleanupReceipt ?? null} : null;
  let messengerPending=Boolean(options.messengerPending);
  const context={
    Error,URL,AbortSignal,uuid:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    actor:async(_request,requireConsent)=>{calls.push(['actor',requireConsent]);if(options.resume)throw new Error('revoked session');return {member:{id:member}};},
    sha256Hex:async()=>digest,
    db:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{phone:options.sourcePhone ?? '01000000000'},error:null})})})})},getEnv:(name)=>name==='REQUEST_BOARD_PASSWORD_SYNC_URL' ? 'https://synthetic.invalid/api/auth/sync-password' : 'synthetic-secret',
    createRequestBoardAccountRetirementAssertion:async(upstream,id,phone)=>{calls.push(['assertion',upstream,id,phone]);return 'synthetic-domain-assertion';},
    fetch:async(url,init)=>{
      calls.push(['fetch',String(url),JSON.parse(init.body)]);
      const data={operationId:operation,upstreamAccountId:fc,policyVersion:'2026-10-14',accountErased:true,runtimeRevoked:true,
        runtimeRevocationScope:'persisted_auth_and_local_runtime',remoteSocketRevalidationIntervalMs:5000,alreadyApplied:false,...options.remote};
      return new Response(JSON.stringify(options.unbound ? {success:false,code:'AFFILIATE_IDENTITY_UNBOUND'} : {success:true,data}),{status:options.unbound ? 409 : 200});
    },
    drainAccountDeletionCleanup:async()=>{calls.push(['account-cleanup']);return Boolean(options.cleanupPending);},
    drainMessengerAttachmentCleanup:async(input)=>{calls.push(['messenger-cleanup',input.batchId]);if(options.messengerCompletes)messengerPending=false;return {claimFailed:false,completionFailed:false};},
    rpc:async(name,args)=>{
      calls.push([name,args]);
      if(name==='get_platform_withdrawal_v1')return job;
      if(name==='begin_platform_withdrawal_v1'){assert.equal(args.p_member_id,member);job={...initial};return job;}
      if(name==='erase_platform_withdrawal_v1'){job={...job,local_erased:true,cleanup_receipt:options.cleanupReceipt ?? null,preserved_company_role:args.p_preserved_company_role};return job;}
      if(name==='get_platform_withdrawal_cleanup_v1')return {batch_ids:messengerPending ? [batch] : [],pending:messengerPending};
      if(name==='complete_platform_withdrawal_v1'){job={...job,completed:true};return job;}
      if(name==='record_platform_withdrawal_retry_v1'){
        if(options.completeDuringPending){job={...job,local_erased:true,completed:true};return {recorded:false,completed:true};}
        return {recorded:true,completed:false};
      }
      throw new Error('unexpected RPC');
    },
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  };
  context.withdrawalJob=await extract('supabase/functions/platform-service/index.ts','withdrawalJob',context);
  context.withdrawalResponse=await extract('supabase/functions/platform-service/index.ts','withdrawalResponse',context);
  context.finishWithdrawal=await extract('supabase/functions/platform-service/index.ts','finishWithdrawal',context);
  const withdraw=await extract('supabase/functions/platform-service/index.ts','withdrawMember',context);
  const get=await extract('supabase/functions/platform-service/index.ts','getWithdrawal',context);
  return {calls,operation,member,fc,withdraw,get,request:new Request('https://synthetic.invalid',{headers:{'x-app-session-token':'synthetic-session'}}),
    body:{confirmed:true,scope:'all_affiliates',policyVersion:'2026-10-14',idempotencyKey:operation,memberId:'body-selector-is-not-authority'}};
}

test('new withdrawal requires explicit scope/version, uses signed identity and canonicalizes uppercase UUID before freezing credentials',async()=>{
  const fixture=await withdrawalFixture();
  for(const change of [{confirmed:false},{scope:'member_only'},{policyVersion:'old'},{idempotencyKey:'bad'}]) {
    const response=await fixture.withdraw(fixture.request,{...fixture.body,...change});
    assert.equal(response.status,400);assert.deepEqual(fixture.calls,[]);
  }
  const response=await fixture.withdraw(fixture.request,{...fixture.body,idempotencyKey:fixture.operation.toUpperCase()});
  assert.deepEqual(await response.json(),{ok:true,operationId:fixture.operation,status:'completed',deleted:true,cleanupPending:false});
  assert.deepEqual(fixture.calls[1],['actor',false]);
  const begins=fixture.calls.filter(([name])=>name==='begin_platform_withdrawal_v1');
  assert.deepEqual(JSON.parse(JSON.stringify(begins[0][1])),{p_member_id:fixture.member,p_operation_id:fixture.operation,p_session_digest:'a'.repeat(64)});
  const before=fixture.calls.length;
  assert.equal((await (await fixture.withdraw(fixture.request,fixture.body)).json()).status,'completed');
  assert.equal(fixture.calls.length,before+1);
});

test('withdrawal read resumes only an original session digest without actor authority or mutation',async()=>{
  const fixture=await withdrawalFixture({resume:true});
  assert.deepEqual(await (await fixture.get(fixture.request)).json(),{ok:true,withdrawal:{ok:true,
    operationId:fixture.operation,status:'pending',deleted:false,cleanupPending:true}});
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)),[['get_platform_withdrawal_v1',{p_operation_id:null,p_session_digest:'a'.repeat(64)}]]);
  for(const token of ['', ' '.repeat(2), 'x'.repeat(8193)])
    await assert.rejects(fixture.get(new Request('https://synthetic.invalid',{headers:{'x-app-session-token':token}})),/invalid_session/);
  assert.equal(fixture.calls.length,1);
  const empty=await withdrawalFixture();
  assert.deepEqual(await (await empty.get(empty.request)).json(),{ok:true,withdrawal:null});
});

test('affiliate retirement accepts only exact ordinary-account or authoritative company-preservation receipts',async()=>{
  for(const [remote,expected] of [
    [{},'completed'],[{operationId:'another-operation'},'pending'],[{upstreamAccountId:'another-source'},'pending'],
    [{policyVersion:'old'},'pending'],[{runtimeRevocationScope:undefined},'pending'],[{remoteSocketRevalidationIntervalMs:10000},'pending'],
    [{accountErased:false},'pending'],
    [{status:'no_affiliate_account',accountErased:false,runtimeRevoked:false},'completed'],
    [{status:'no_affiliate_account',accountErased:false,runtimeRevoked:true},'pending'],
    [{status:'company_account_preserved',preservedRole:'designer',independentLoginAvailable:true,accountErased:false,runtimeRevoked:false},'completed'],
    [{status:'company_account_preserved',preservedRole:'designer',accountErased:false,runtimeRevoked:false},'pending'],
    [{status:'company_account_preserved',preservedRole:'manager',independentLoginAvailable:true,accountErased:false,runtimeRevoked:false},'pending'],
    [{status:'company_account_preserved',preservedRole:'fc',accountErased:false,runtimeRevoked:false},'pending'],
  ]) {
    const fixture=await withdrawalFixture({fc:true,remote});
    const result=await (await fixture.withdraw(fixture.request,fixture.body)).json();
    assert.equal(result.status,expected);assert.equal(result.deleted,expected==='completed');assert.equal(result.cleanupPending,expected!=='completed');
    assert.equal(fixture.calls.some(([name])=>name==='erase_platform_withdrawal_v1'),expected==='completed');
    assert.equal(fixture.calls.some(([name])=>name==='complete_platform_withdrawal_v1'),expected==='completed');
  }
  const fixture=await withdrawalFixture({fc:true,unbound:true});
  assert.equal((await (await fixture.withdraw(fixture.request,fixture.body)).json()).reason,'affiliate_identity_unbound');
  assert.equal(fixture.calls.some(([name])=>name==='erase_platform_withdrawal_v1'),false);
});

test('withdrawal resumes a lost-response operation without reviving sessions and waits for both cleanup phases',async()=>{
  for(const options of [
    {resume:true,cleanupReceipt:{synthetic:true},cleanupPending:true},
    {resume:true,messengerPending:true},
    {resume:true,messengerPending:true,messengerCompletes:true},
  ]) {
    const fixture=await withdrawalFixture(options);
    const result=await (await fixture.withdraw(fixture.request,fixture.body)).json();
    assert.equal(fixture.calls.some(([name])=>name==='actor'||name==='begin_platform_withdrawal_v1'||name==='erase_platform_withdrawal_v1'),false);
    assert.equal(result.status,options.messengerCompletes ? 'completed' : 'pending');
    if(options.messengerPending)assert.equal(fixture.calls.filter(([name])=>name==='messenger-cleanup').length,1);
  }
  const raced=await withdrawalFixture({fc:true,unbound:true,completeDuringPending:true});
  assert.deepEqual(await (await raced.withdraw(raced.request,raced.body)).json(),
    {ok:true,operationId:raced.operation,status:'completed',deleted:true,cleanupPending:false});
});

test('service-only withdrawal drain requires both exact service credentials and returns bounded counts, not identities',async()=>{
  const calls=[];const serviceKey='synthetic-service-key';
  const row={operation_id:'00000000-0000-4000-8000-000000000001',member_id:'00000000-0000-4000-8000-000000000002',
    source_fc_id:null,session_digest:'a'.repeat(64),local_erased:false,completed:false,cleanup_receipt:null,preserved_company_role:null};
  const context={serviceKey,Error,withdrawalJob:value=>value,rpc:async()=>{calls.push('list');return [row];},
    finishWithdrawal:async(job,digest)=>{calls.push([job.operation_id,digest]);return new Response(JSON.stringify({status:'pending',deleted:false,cleanupPending:true}));},
    json:body=>new Response(JSON.stringify(body)),fail:(code,message,status)=>new Response(JSON.stringify({code,message}),{status})};
  const run=await extract('supabase/functions/platform-service/index.ts','drainWithdrawals',context);
  for(const headers of [{},{apikey:serviceKey},{Authorization:`Bearer ${serviceKey}`},{apikey:'wrong',Authorization:`Bearer ${serviceKey}`}]) {
    assert.equal((await run(new Request('https://synthetic.invalid',{headers}))).status,403);assert.deepEqual(calls,[]);
  }
  const response=await run(new Request('https://synthetic.invalid',{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}));
  assert.deepEqual(await response.json(),{ok:true,processed:1,completed:0,pending:1});
  assert.deepEqual(calls,['list',[row.operation_id,row.session_digest]]);
});

test('shared deletion cleanup resumes post-commit failures, validates completion and accepts only confirmed Auth user absence',async()=>{
  const {requireAccountDeletionReceipt}=await loadUxMutationContract();
  const receipt={deleted:true,cleanup_outbox_id:'00000000-0000-4000-8000-000000000001',
    proof_paths:['synthetic-proof'],document_paths:[],board_attachment_paths:[],chat_file_urls:[],
    auth_user_ids:['00000000-0000-4000-8000-000000000002']};
  for(const [authError,expectPending] of [[null,false],[{code:'user_not_found'},false],[{status:404},true],[{code:'upstream_error',status:404},true]]) {
    const calls=[];
    const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{status:'pending'},error:null})}),
      storage:{from:()=>({remove:async paths=>{calls.push(['storage',paths]);return {error:null};}})},
      auth:{admin:{deleteUser:async id=>{calls.push(['auth',id]);return {error:authError};}}},
      rpc:async(_name,args)=>{calls.push(['record',args.p_succeeded]);return {data:[{status:args.p_succeeded ? 'completed' : 'pending'}],error:null};}};
    const run=await extract('supabase/functions/_shared/account-deletion-cleanup.ts','drainAccountDeletionCleanup',{
      requireAccountDeletionReceipt,reportEdgeDiagnostic:()=>{},Set});
    assert.equal(await run(db,receipt),expectPending);
    assert.deepEqual(calls.map(([kind])=>kind),['storage','auth','record']);
    assert.equal(calls[2][1],!expectPending);
    calls.length=0;
    db.from=()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{status:'completed'},error:null})});
    assert.equal(await run(db,receipt),false);assert.deepEqual(calls,[]);
    await assert.rejects(run(db,{...receipt,auth_user_ids:['not-an-auth-uuid']}),/mutation_receipt_unverified/);
  }
  const run=await extract('supabase/functions/_shared/account-deletion-cleanup.ts','drainAccountDeletionCleanup',{
    requireAccountDeletionReceipt,reportEdgeDiagnostic:()=>{},Set});
  const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{status:'pending'},error:null})}),
    storage:{from:()=>({remove:async()=>{throw new Error('synthetic-storage-network-error');}})},
    auth:{admin:{deleteUser:async()=>({error:null})}},rpc:async()=>({data:[{status:'pending'}],error:null})};
  assert.equal(await run(db,receipt),true);
  db.storage.from=()=>({remove:async()=>({error:null})});db.rpc=async()=>({data:null,error:null});
  assert.equal(await run(db,receipt),true);
});


test('unavailable company import uses the old enrollment-required surface without automatic revival or attestation',async()=>{
  for(const deniedCode of ['common_membership_withdrawn','company_attestation_unavailable','common_membership_unavailable']) {
  const calls=[];
  const context={Error,termsVersion:'2026-10-12',parsePlatformMemberToken:async()=>null,
    legacyMember:async()=>null,
    parseAppSessionTokenDetailed:async()=>({ok:true,payload:{accountKind:'fc',accountId:'signed-fc-id',phone:'00000000002',sessionVersion:0}}),
    rpc:async(name,args)=>{calls.push({name,args});return {ok:false,code:deniedCode};},
  };
  const actor=await extract('supabase/functions/platform-service/index.ts','actor',context);
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    Error,actor,json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-app-session-token':'signed-original-fc'},
    body:JSON.stringify({action:'get_account',memberId:'client-spoof'})}));
  assert.equal(response.status,409);const body=await response.json();
  assert.equal(body.code,'enrollment_required');assert.match(body.message,/새로 동의/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'import_platform_legacy_member_v1',args:{p_phone:'00000000002',p_account_kind:'fc',p_account_id:'signed-fc-id'}}]);
  }
});

test('valid legacy common login keeps its original insurance session when automatic company attestation is unavailable',async()=>{
  const calls=[];
  const legacy={ok:true,role:'fc',residentId:'00000000002',displayName:'Synthetic FC',appSessionToken:'signed-original-fc',
    requestBoardRole:'fc',requestBoardBridgeToken:'signed-original-bridge'};
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    supabaseUrl:'https://synthetic.invalid',getEnv:()=> 'synthetic-anon',AbortSignal,
    db:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})},
    fetch:async()=>new Response(JSON.stringify(legacy)),
    parseAppSessionTokenDetailed:async()=>({ok:true,payload:{role:'fc',accountKind:'fc',accountId:'signed-fc-id',phone:'00000000002',sessionVersion:0}}),
    legacyMember:async()=>null,
    rpc:async(name,args)=>{calls.push({name,args});return {ok:false,code:'company_attestation_unavailable'};},
    authResponse:()=>{throw new Error('must not mint an attested common session');},
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'login',phone:'00000000002',password:'Synthetic!123',role:'admin'})}));
  assert.equal(response.status,200);const body=await response.json();
  assert.deepEqual(body.insuranceSession,legacy);assert.equal(body.commonMembershipCode,'company_attestation_unavailable');
  assert.equal('memberId' in body,false);assert.equal('appSessionToken' in body,false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'import_platform_legacy_member_v1',args:{p_phone:'00000000002',p_account_kind:'fc',p_account_id:'signed-fc-id'}}]);
});

test('platform recovery separates signup codes and refuses hosted test SMS before challenge writes',async()=>{
  const calls=[];
  const context={getEnv:()=>undefined,crypto:globalThis.crypto,toBase64:btoa,hashPassword:async()=> 'synthetic-hash',
    signupCodeHash:async(code,phone)=>{calls.push(['hash',code,phone]);return 'synthetic-digest';},
    processPasswordResetChallenge:async(_db,account,input)=>{calls.push(['challenge',account,input]);return {ok:true};},
    sendSignupSms:async()=>{calls.push(['sms']);return {ok:true};},
    db:{from(){return this;},select(){return this;},eq(){return this;},is(){return this;},maybeSingle:async()=>({data:{id:'signed-member-id'},error:null})},
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  };
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',context);
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'request_password_reset',phone:'00000000011'})}));
  assert.equal(response.status,200);assert.equal(calls[0][2],'reset:00000000011');assert.equal(calls[1][1].kind,'member');assert.equal(calls[1][2].action,'issue');
  calls.length=0;
  const hosted=await extract('supabase/functions/platform-service/index.ts','handler',{...context,
    getEnv:name=>name==='TEST_SMS_MODE' ? 'true' : name==='DENO_DEPLOYMENT_ID' ? 'synthetic-hosted' : undefined});
  const refused=await hosted(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'request_otp',phone:'00000000011'})}));
  assert.equal(refused.status,503);assert.equal((await refused.json()).code,'server_misconfigured');assert.deepEqual(calls,[]);
});

test('hospital directory distinguishes unavailable transport from an unavailable individual contract',async()=>{
  for(const unavailable of [false,true]) {
    const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
      getKoreanYmd:()=> '2026-10-11',hospitalProvinces:{'11':'서울'},uuid:/^[0-9a-f-]{36}$/,
      rpc:async()=>{if(unavailable) throw new Error('database_error');return {hospitals:[],featured:[]};},
      json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
      fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
    });
    const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'get_hospital',hospitalId:'90000000-0000-4000-8000-000000000001'})}));
    assert.equal(response.status,unavailable ? 503 : 404);
    assert.equal((await response.json()).code,unavailable ? 'request_failed' : 'hospital_not_found');
  }
});

test('hospital receipt expiry, tamper and wrong-contract checks precede admission',async()=>{
  const context={crypto:globalThis.crypto,TextEncoder,serviceKey:'synthetic-only-hospital-signing-key',btoa,atob,hospitalPlacements:['regional_list','regional_featured']};
  context.hospitalSignature=await extract('supabase/functions/platform-service/index.ts','hospitalSignature',context);
  const mint=await extract('supabase/functions/platform-service/index.ts','hospitalReceipt',context);
  const verify=await extract('supabase/functions/platform-service/index.ts','verifyHospitalReceipt',context);
  const hospital={id:'synthetic-hospital',revision:2,adPlacement:'regional_list'};
  const token=await mint(hospital);
  assert.equal((await verify(token,hospital.id)).revision,2);
  assert.equal(await verify(token,'different-hospital'),null);
  assert.equal(await verify(`${token.slice(0,-1)}${token.endsWith('0')?'1':'0'}`,hospital.id),null);
  const data=btoa(JSON.stringify({id:hospital.id,revision:2,placement:'regional_list',expires:Math.floor(Date.now()/1000)-1}));
  assert.equal(await verify(`${data}.${await context.hospitalSignature(data)}`,hospital.id),null);
});

test('basic hospital exposure receipts cannot promote events and nonadmins cannot read performance',async()=>{
  const calls=[];
  const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
    hospitalEventTypes:['impression','detail','phone','directions'],hospitalPlacements:['regional_list','regional_featured'],uuid:/^[0-9a-f-]{36}$/,
    verifyHospitalReceipt:async()=>({revision:0,placement:'regional_list'}),actor:async()=>({member:{id:'synthetic-member'},adminId:null}),
    rpc:async(name,args)=>{calls.push({name,args});return {};},
    json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
  });
  for(const body of [
    {action:'record_hospital_event',hospitalId:'90000000-0000-4000-8000-000000000001',eventId:'90000000-0000-4000-8000-000000000002',sessionId:'90000000-0000-4000-8000-000000000003',eventType:'impression',placement:'regional_featured'},
    {action:'get_hospital_report',from:'2026-10-11',to:'2026-10-11'},
  ]) {
    const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(body)}));
    assert.equal(response.status,body.action==='get_hospital_report' ? 403 : 400);
  }
  assert.equal(calls.length,0);
});
test('cleanup status fails on unknown counts; post-commit drain stays pending for unknown/error', async()=>{
  for (const count of [null,undefined,NaN,-1,1.5]) {
    const supabase={from(){return this;},select(){return this;},eq(){return Promise.resolve({count,error:null});}};
    const read=await extract('supabase/functions/admin-action/index.ts','getDocumentCleanupPending',{supabase});
    await assert.rejects(read('synthetic'),/cleanup_state_unverified/);
  }
  for (const [count,error,expected] of [[0,null,false],[1,null,true],[null,null,true],[0,new Error('synthetic'),true]]) {
    const supabase={from(){return this;},select(_field,options){this.head=options?.head;return this;},eq(){return this.head?Promise.resolve({count,error}):this;},limit:async()=>({data:[],error:null})};
    assert.equal(await (await extract('supabase/functions/admin-action/index.ts','drainDocumentCleanup',{supabase}))('synthetic'),expected);
  }
});

test('document workflow sync rejects malformed successful document lists before changing status', async()=>{
  for (const data of [null, { unexpected: true }]) {
    let profileUpdates=0;
    const supabase={
      from(table){
        if(table==='fc_documents') return {select(){return this;},eq(){return Promise.resolve({data,error:null});}};
        if(table==='fc_profiles') return {update(){profileUpdates++;return this;},eq(){return Promise.resolve({error:null});}};
        throw new Error(`unexpected table ${table}`);
      },
    };
    const sync=await extract('supabase/functions/admin-action/index.ts','syncProfileAfterDocMutation',{
      supabase,
      buildWorkflowResetPayload:()=>({}),
    });
    await assert.rejects(sync('synthetic'),/fc_document_query_contract_invalid/);
    assert.equal(profileUpdates,0);
  }
});

test('cleanup actor revalidation stops before Storage when the current FC facts are rejected', async()=>{
  let checked;
  const run=await extract('supabase/functions/admin-action/index.ts','assertDocumentCleanupScope',{supabase:{rpc:async(name,args)=>{checked={name,args};return {error:new Error('synthetic actor rejected')};}}});
  await assert.rejects(run('00000000002','fc','synthetic'),/actor rejected/);
  assert.equal(checked.name,'assert_ux_mutation_actor_v1');assert.equal(checked.args.p_fc_id,'synthetic');
});

async function bridgeSyncFixture({ role = 'fc', data, error = null, parsed, token = 'synthetic-bridge' } = {}) {
  const file = 'supabase/functions/sync-request-board-session/index.ts';
  const scope = { Request, Response, corsHeaders: {}, calls: [], issued: [] };
  scope.json = await extract(file, 'json', scope);
  scope.fail = await extract(file, 'fail', scope);
  scope.cleanPhone = await extract(file, 'cleanPhone', scope);
  scope.parseAppSessionTokenDetailed = async () => parsed ?? { ok: true, payload: {
    phone: '000-0000-0002', role, accountKind: role,
    accountId: '00000000-0000-4000-8000-000000000002', sessionVersion: 11,
  } };
  scope.supabase = { from(table) {
    const query = { table };
    scope.calls.push(query);
    return { select(fields) { query.fields = fields; return this; },
      eq(field, value) { query.filter = [field, value]; return this; },
      async maybeSingle() { return { data, error }; } };
  } };
  scope.parseDesignerCompanyNameFromAffiliation = affiliation => affiliation === 'synthetic-designer' ? 'synthetic-company' : null;
  scope.resolveManagerAffiliation = name => `synthetic-affiliation:${name}`;
  scope.createRequestBoardBridgeToken = async (...args) => { scope.issued.push(args); return token; };
  const handler = await extract(file, 'handler', scope);
  const response = await handler(new Request('https://synthetic.invalid/sync', {
    method: 'POST', body: JSON.stringify({ sessionToken: 'synthetic-app', role: 'admin', phone: '00000000009' }),
  }));
  return { ...scope, status: response.status, body: await response.json() };
}

test('bridge sync preserves verified actor, role mapping, affiliation and session generations', async () => {
  const rows = [
    ['admin', { active: true, staff_type: 'developer' }, 'admin_accounts', 'phone,active,name,staff_type', 'fc', undefined],
    ['manager', { active: true }, 'manager_accounts', 'phone,active,name', 'manager', 'synthetic-affiliation:synthetic-name'],
    ['fc', { signup_completed: true, affiliation: 'synthetic-affiliation' }, 'fc_profiles', 'phone,name,signup_completed,affiliation', 'fc', 'synthetic-affiliation'],
    ['fc', { signup_completed: true, affiliation: 'synthetic-designer' }, 'fc_profiles', 'phone,name,signup_completed,affiliation', 'designer', undefined],
  ];
  for (const [role, fields, table, selected, bridgeRole, affiliation] of rows) {
    const result = await bridgeSyncFixture({ role, data: { phone: '00000000002', name: 'synthetic-name', ...fields } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.calls, [{ table, fields: selected, filter: ['phone', '00000000002'] }]);
    assert.equal(result.issued.length, 1);
    assert.deepEqual(result.issued[0].slice(0, 3), ['00000000002', bridgeRole, affiliation]);
    assert.equal(result.issued[0][3].accountKind, role);
    assert.equal(result.issued[0][3].accountId, '00000000-0000-4000-8000-000000000002');
    assert.equal(result.issued[0][3].sessionVersion, 11);
    assert.deepEqual(result.body, { ok: true, requestBoardBridgeToken: 'synthetic-bridge',
      requestBoardRole: bridgeRole === 'manager' ? 'fc' : bridgeRole, displayName: 'synthetic-name' });
  }
});

test('bridge sync keeps unavailable, permission and issuance failures without issuing a token', async () => {
  for (const status of [401, 503]) {
    const result = await bridgeSyncFixture({ parsed: { ok: false, code: 'synthetic-session-error', message: 'synthetic-error', status } });
    assert.equal(result.status, status);
    assert.equal(result.body.code, 'synthetic-session-error');
    assert.equal(result.calls.length, 0);
    assert.equal(result.issued.length, 0);
  }
  for (const [options, status, code] of [
    [{ error: { message: 'synthetic-db-error' } }, 500, 'db_error'],
    [{ data: null }, 404, 'not_found'],
    [{ role: 'admin', data: { phone: '00000000002', active: false } }, 403, 'inactive_account'],
    [{ role: 'manager', data: { phone: '00000000002', active: false } }, 403, 'inactive_account'],
    [{ role: 'admin', data: { phone: '00000000002', active: true, staff_type: 'admin' } }, 403, 'request_board_not_applicable'],
    [{ data: { phone: '00000000002', signup_completed: false } }, 403, 'not_completed'],
  ]) {
    const result = await bridgeSyncFixture(options);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.issued.length, 0);
  }
  const result = await bridgeSyncFixture({ data: { phone: '00000000002', signup_completed: true }, token: null });
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'bridge_secret_missing');
  assert.equal(result.issued.length, 1);
});

test('failed message send restores its original draft beside newly typed input and blocks duplicate writes', async()=>{
  let input='sent draft',files=[{uri:'synthetic-old'}],calls=0,finish;const alerts=[];
  const busy={current:false};const conv={id:'synthetic-conversation',primaryConversationId:1,type:'direct'};
  const run=await extract('app/request-board-messenger.tsx','handleSend',{
    activeConv:conv,inputText:input,pendingFiles:files,sendingRef:busy,beginSend:()=>()=>true,canWriteRequestBoard:true,
    accountReadScope:{current:{captureOwner:()=>()=>true}},messageReadScope:{current:{captureOwner:()=>()=>true}},sessionReadKey:'synthetic-session',activeConversationRef:{current:conv.id},
    conversations:[],setInputText:x=>{input=typeof x==='function'?x(input):x;},setPendingFiles:x=>{files=typeof x==='function'?x(files):x;},setSending(){},
    rbUploadAttachments:async()=>({success:true,data:[]}),rbSendDmMessage:async()=>{calls++;input='next draft';return new Promise(resolve=>{finish=()=>resolve({success:false});});},
    rbUser:{id:1},setMessages(){},setConversations(){},fmtRelative:()=>'',Alert:{alert:(...x)=>alerts.push(x)},
  });
  const first=run();await new Promise(resolve=>setTimeout(resolve,0));await run();assert.equal(calls,1);finish();await first;
  assert.equal(input,'sent draft\nnext draft');assert.equal(files.length,1);assert.equal(alerts[0][0],'전송 확인 필요');assert.equal(busy.current,false);
});

test('document screen restores durable cleanup status on re-entry without exposing queue rows', async()=>{
  const pending=[];const query={from(){return this;},select(fields){this.fields=fields;return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'synthetic-profile'},error:null}),then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
  const run=await extract('app/docs-upload.tsx','loadData',{
    beginRead:()=>()=>true,hasInvalidUserRoute:false,isAdmin:true,routeUserId:'synthetic-profile',residentId:'00000000001',supabase:query,
    setProfileLoadState(){},setFc(){},setDocs(){},setCleanupStatusError(){},setCleanupPending:x=>pending.push(x),
    loadAllDocuments:async()=>[],Alert:{alert(){}},
    invokeAdminAction:async(_actor,action,payload)=>{assert.equal(action,'getDocumentCleanupStatus');assert.equal(payload.fcId,'synthetic-profile');return {cleanupPending:true};},
  });
  await run();assert.deepEqual(pending,[true]);
});
