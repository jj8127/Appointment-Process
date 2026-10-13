import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
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
    ['supabase/functions/delete-account/index.ts', 'removeStorageObjects('],
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

test('common withdrawal uses the signed member and stays available without renewing consent',async()=>{
  for(const generalMember of [true,false]) {
    const calls=[];
    const handler=await extract('supabase/functions/platform-service/index.ts','handler',{
      actor:async(_request,requireConsent)=>{calls.push({requireConsent});return {member:{id:'signed-member-id'},generalMember};},
      rpc:async(name,args)=>{calls.push({name,args});return {ok:true,deleted:true};},
      json:(body,status=200)=>new Response(JSON.stringify(body),{status}),fail:(code,message,status=400)=>new Response(JSON.stringify({ok:false,code,message}),{status}),
    });
    for(const confirmed of [false,true]) {
      calls.length=0;
      const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'delete_member',confirmed,memberId:'client-owned'})}));
      assert.equal(response.status,confirmed ? 200 : 403);assert.equal(calls[0].requireConsent,false);
      assert.equal(calls.length,confirmed ? 2 : 1);
      if(confirmed) assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),{name:'delete_platform_member',args:{p_member_id:'signed-member-id'}});
    }
  }
  for(const [member,expected] of [[null,'enrollment_required'],[{id:'existing',fc_id:'signed-fc-id'},'consent_required'],[{id:'wrong',fc_id:'different-fc-id'},'enrollment_required']]) {
    const actor=await extract('supabase/functions/platform-service/index.ts','actor',{
      parsePlatformMemberToken:async()=>null,termsVersion:'2026-10-12',legacyMember:async()=>member,
      parseAppSessionTokenDetailed:async()=>({ok:true,payload:{accountKind:'fc',accountId:'signed-fc-id',phone:'00000000002'}}),
    });
    const request=new Request('https://synthetic.invalid');
    await assert.rejects(actor(request),new RegExp(expected));
    if(expected==='consent_required') assert.equal((await actor(request,false)).member.id,'existing');
    else await assert.rejects(actor(request,false),new RegExp(expected));
  }
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
