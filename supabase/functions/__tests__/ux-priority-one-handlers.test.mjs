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
    if (name === 'handler' && ts.isCallExpression(node) && node.expression.getText(ast) === 'serve') {
      expression = node.arguments[0].getText(ast);
    }
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
