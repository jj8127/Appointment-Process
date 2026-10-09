import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../../../', import.meta.url);
async function extract(file, name, context) {
  const source = await readFile(new URL(file, root), 'utf8');
  const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(ast)===name) expression=node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast)===name) {
      const init = node.initializer;
      expression = ts.isCallExpression(init) && init.expression.getText(ast)==='useCallback' ? init.arguments[0].getText(ast) : init.getText(ast);
    }
    ts.forEachChild(node,visit);
  }
  visit(ast); assert.ok(expression,`${file}:${name} exists`);
  const compiled=ts.transpileModule(`globalThis.run = ${expression}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const scope=vm.createContext({ ...context, Date, Map, Set, Promise, String, Boolean, Array, Number, console: {warn(){}} });
  vm.runInContext(compiled,scope); return scope.run;
}
async function calendar() {
  const source=await readFile(new URL('lib/calendar-date.ts',root),'utf8');
  const module={exports:{}}; vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports});
  return module.exports;
}
test('exam pending counts exclude latest cancelled/rejected applications while retaining valid applied results', async()=>{
  const rows=[['a','applied',false],['b','cancelled',false],['c','rejected',false],['d','confirmed',true],['e','applied',false],['e','cancelled',false]].map(([resident_id,status,is_confirmed])=>({resident_id,status,is_confirmed,exam_rounds:{exam_type:'life'}}));
  const run=await extract('app/index.tsx','fetchExamStats',{supabase:{from(table){return table==='exam_registrations'?{select(){return this;},order(field){return field==='created_at'?Promise.resolve({data:rows,error:null}):this;}}:{select(){return this;},in(){return Promise.resolve({data:['a','b','c','d','e'].map(phone=>({phone})),error:null});}};}}});
  const result=await run(); assert.equal(result.lifeTotal,5);assert.equal(result.lifePending,1);assert.equal(result.nonlifePending,0);
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

test('cleanup actor revalidation stops before Storage when the current FC facts are rejected', async()=>{
  let checked;
  const run=await extract('supabase/functions/admin-action/index.ts','assertDocumentCleanupScope',{supabase:{rpc:async(name,args)=>{checked={name,args};return {error:new Error('synthetic actor rejected')};}}});
  await assert.rejects(run('00000000002','fc','synthetic'),/actor rejected/);
  assert.equal(checked.name,'assert_ux_mutation_actor_v1');assert.equal(checked.args.p_fc_id,'synthetic');
});

test('draft navigation keeps cancel and busy exits local; explicit discard and successful save dispatch once', async()=>{
  const source=await readFile(new URL('hooks/use-draft-exit-guard.ts',root),'utf8');
  function run(dirty,busy,os='android') {
    let callback,buttons,hardware,beforeUnload;const dispatch=[],effects=[];
    const navigation={dispatch:x=>dispatch.push(x),canGoBack:()=>true,goBack(){callback({data:{action:'back'}});}};
    const modules={ '@react-navigation/native':{useNavigation:()=>navigation,usePreventRemove(_enabled,fn){callback=fn;}},react:{useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)},'react-native':{Alert:{alert(_title,_text,next){buttons=next;}},BackHandler:{addEventListener(_event,fn){hardware=fn;return {remove(){}};}},Platform:{OS:os}} };
    const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports,module,require:name=>modules[name],window:{addEventListener(_event,fn){beforeUnload=fn;},removeEventListener(){}}});
    const allow=module.exports.useDraftExitGuard(dirty,busy);effects.forEach(fn=>fn());
    return {dispatch,allow,exit(){callback({data:{action:'leave'}});},get buttons(){return buttons;},hardware,event:()=>beforeUnload};
  }
  const dirty=run(true,false);dirty.exit();assert.equal(dirty.dispatch.length,0);assert.equal(dirty.buttons[0].style,'cancel');dirty.buttons[1].onPress();assert.deepEqual(dirty.dispatch,['leave']);
  const busy=run(false,true);busy.hardware();assert.equal(busy.dispatch.length,0);assert.equal(busy.buttons,undefined);
  const saved=run(true,true);saved.allow();saved.exit();assert.deepEqual(saved.dispatch,['leave']);
  let prevented=0;const web=run(true,false,'web');web.event()({preventDefault(){prevented++;},returnValue:null});assert.equal(prevented,1);
});
test('failed consent refresh preserves known approval, date, profile identity and temporary ID', async()=>{
  const changes=[];
  const run=await extract('app/consent.tsx','loadProfile',{residentId:'00000000002',beginRead:()=>()=>true,supabase:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:new Error('synthetic')})},setProfileLoadState:x=>changes.push(['load',x]),setProfileId:x=>changes.push(['id',x]),setTempId:x=>changes.push(['temp',x]),setSelectedDate:x=>changes.push(['date',x]),setCareerType(){},setRejectReason(){},setIsApproved:x=>changes.push(['approved',x])});
  await run(); assert.deepEqual(changes,[['load','loading'],['load','error']]);
});
test('consent ignores a stale response after its read owner is invalidated', async()=>{
  const changes=[];
  const run=await extract('app/consent.tsx','loadProfile',{residentId:'00000000002',beginRead:()=>()=>false,supabase:{from(){return this;},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'synthetic'},error:null})},setProfileLoadState:x=>changes.push(x)});
  await run();assert.deepEqual(changes,[]);
});
test('dirty basic information refresh does not issue a query or overwrite input', async()=>{
  let calls=0,alerts=0;
  const run=await extract('app/fc/new.tsx','loadExisting',{phoneFromSession:'00000000002',normalizePhone:x=>x,beginRead:()=>()=>true,draftDirtyRef:{current:true},Alert:{alert(){alerts++;}},invokeAdminAction:async()=>{calls++;}});
  await run();assert.equal(calls,0);assert.equal(alerts,1);
});
test('editing basic information while its read is pending ignores the returned reset values', async()=>{
  const dirty={current:false};let resets=0;
  const run=await extract('app/fc/new.tsx','loadExisting',{phoneFromSession:'00000000002',normalizePhone:x=>x,beginRead:()=>()=>true,draftDirtyRef:dirty,Alert:{alert(){}},setProfileLoadState(){},invokeAdminAction:async()=>{dirty.current=true;return {profile:{id:'synthetic'}};},reset(){resets++;}});
  await run();assert.equal(resets,0);
});
test('document deletion cancel performs zero writes; confirmation runs one in-flight mutation and keeps approved guard', async()=>{
  let buttons, calls=0; const busy={current:false};
  const context={fc:{id:'synthetic'},docs:[{type:'required',status:'pending'}],deletingRef:busy,beginMutation:()=>()=>true,uploadingType:null,profileLoadState:'success',residentId:'00000000002',isAdmin:false,
    Alert:{alert(_title,_text,next){buttons=next;}},setDeletingType(){},setDocs(){},setFc(){},setCleanupPending(){},loadData:async()=>{},DOC_WORKFLOW_RESET_FIELDS:{},
    invokeAdminAction:async()=>{calls++;return {cleanupPending:false};}};
  const run=await extract('app/docs-upload.tsx','handleDelete',context);
  run('required','path');assert.equal(calls,0);assert.equal(buttons[0].style,'cancel');
  const first=buttons[1].onPress();const second=buttons[1].onPress();await Promise.all([first,second]);assert.equal(calls,1);
  context.docs[0].status='approved';await (await extract('app/docs-upload.tsx','handleDelete',context))('required','path');assert.equal(calls,1);
});

test('unmounted read ownership cannot be revived by an old continuation', async()=>{
  const source=await readFile(new URL('lib/use-read-attempt.ts',root),'utf8');let cleanup;
  const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports,module,require:()=>({useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>{cleanup=fn();}})});
  const begin=module.exports.useReadAttempt();const before=begin();assert.equal(before(),true);cleanup();assert.equal(before(),false);assert.equal(begin()(),false);
});

test('old basic-information save cannot restore an account after its owner changes', async()=>{
  let active=true,logins=0,notifications=0,calls=0;const mutex={current:false};
  const values={name:'synthetic-new',affiliation:'branch',email:'synthetic@example.invalid',carrier:'carrier',address:'same',addressDetail:'same',residentFront:'',residentBack:''};
  const run=await extract('app/fc/new.tsx','onSubmit',{
    submittingRef:mutex,beginSubmit:()=>()=>active,profileLoadState:'ready',existingProfile:{id:'synthetic-profile',...values},existingAddress:'same',existingAddressDetail:'same',existingResidentMasked:'synthetic-masked',
    phoneFromSession:'00000000002',normalizePhone:x=>x,role:'fc',canOpenFcProfileRegistration:()=>true,setSubmitting(){},buildFcBasicInformationPatch:()=>({name:'synthetic-new'}),
    invokeAdminAction:async()=>{calls++;active=false;return {profile:{id:'synthetic-profile'}};},loginAs(){logins++;},sendNotificationAndPush(){notifications++;},Alert:{alert(){throw new Error('obsolete alert');}},logger:{warn(){}},
  });
  await run(values);assert.equal(calls,1);assert.equal(logins,0);assert.equal(notifications,0);
});

test('cleanup retry has one in-flight owner and ignores a route target change', async()=>{
  let active=true,finish,calls=0;const pending=[],mutex={current:false};
  const run=await extract('app/docs-upload.tsx','retryCleanup',{
    fc:{id:'synthetic-first'},deletingRef:mutex,beginMutation:()=>()=>active,residentId:'00000000001',isAdmin:true,setDeletingType(){},
    invokeAdminAction:async()=>{calls++;return new Promise(resolve=>{finish=()=>resolve({cleanupPending:false});});},
    setCleanupPending:x=>pending.push(x),setCleanupStatusError(){},Alert:{alert(){throw new Error('obsolete alert');}},
  });
  const first=run();await run();assert.equal(calls,1);active=false;finish();await first;assert.deepEqual(pending,[]);
});
test('postcode script failure and timeout emit one safe bridge error; success cancels timeout', async()=>{
  const source=await readFile(new URL('components/DaumPostcode.tsx',root),'utf8');
  const html=/const DAUM_POSTCODE_HTML = `([\s\S]*?)`;/m.exec(source)[1];
  const script=/<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html)[1];
  function scenario(mode) {
    const emitted=[];let timeout,external;const context={window:{ReactNativeWebView:{postMessage:x=>emitted.push(x)}},document:{getElementById:()=>({innerHTML:'',style:{}}),createElement:()=>external={},getElementsByTagName:()=>[{parentNode:{insertBefore(){}}}]},setTimeout:fn=>(timeout=fn,1),clearTimeout(){timeout=null;},daum:{Postcode:function(){return {embed(){}};}}};
    vm.createContext(context);vm.runInContext(script,context);context.initOnReady({});
    if(mode==='error'){external.onerror();external.onerror();}else if(mode==='timeout'){timeout();}else{external.onload();external.onload();assert.equal(timeout,null);}
    return emitted;
  }
  assert.deepEqual(scenario('error'),['__postcode_state__:error']);assert.deepEqual(scenario('timeout'),['__postcode_state__:error']);assert.deepEqual(scenario('ready'),['__postcode_state__:ready']);
});
test('quick accept confirms the saved action before a separate refresh failure', async()=>{
  const alerts=[];
  const run=await extract('app/request-board.tsx','handleDesignerAccept',{getActionableAssignment:()=>({id:1,designer_id:2,status:'pending'}),setDesignerActionKey(){},rbAcceptRequest:async()=>({success:true}),getRequestBoardNotificationFeedback:()=>null,Alert:{alert:(...x)=>alerts.push(x)},fetchData:async()=>{},logger:{warn(){}},toRequestBoardSessionErrorMessage:()=>''});
  await run({id:1});assert.equal(alerts.length,1);assert.equal(alerts[0][0],'수락 완료');
});
test('date-only selected values remain local calendar values through the actual parser',async()=>{
  const {parseCalendarDate}=await calendar();const value=parseCalendarDate('2026-10-09');assert.equal(value.getDate(),9);assert.equal(value.getMonth(),9);assert.equal(value.getFullYear(),2026);
});

test('failed message send restores its original draft beside newly typed input and blocks duplicate writes', async()=>{
  let input='sent draft',files=[{uri:'synthetic-old'}],calls=0,finish;const alerts=[];
  const busy={current:false};const conv={id:'synthetic-conversation',primaryConversationId:1,type:'direct'};
  const run=await extract('app/request-board-messenger.tsx','handleSend',{
    activeConv:conv,inputText:input,pendingFiles:files,sendingRef:busy,beginSend:()=>()=>true,
    accountReadScope:{current:{matches:()=>true}},sessionReadKey:'synthetic-session',activeConversationRef:{current:conv.id},
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
    invokeAdminAction:async(_actor,action,payload)=>{assert.equal(action,'getDocumentCleanupStatus');assert.equal(payload.fcId,'synthetic-profile');return {cleanupPending:true};},
  });
  await run();assert.deepEqual(pending,[true]);
});
