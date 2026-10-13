import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../../../', import.meta.url);

async function extract(file, name, context = {}) {
  const source = await readFile(new URL(file, root), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(ast) === name) {
      expression = node.getText(ast);
    }
    if (name === 'handler' && ts.isCallExpression(node) && node.expression.getText(ast) === 'serve') {
      expression = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `${file}:${name} exists`);
  const compiled = ts.transpileModule(
    `globalThis.run = ${expression.replace(/^export\s+(?:default\s+)?/, '')}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const scope = vm.createContext({
    ...context,
    Array,
    Date,
    Number,
    Promise,
    Request,
    Response,
    String,
  });
  vm.runInContext(compiled, scope);
  return scope.run;
}

async function sharedAuth(overrides = {}) {
  const file = 'supabase/functions/_shared/fc-self-service-auth.ts';
  const cleanFcPhone = await extract(file, 'cleanFcPhone');
  return extract(file, 'requireFcSelfServiceActor', {
    cleanFcPhone,
    requireAppSessionFromRequest: async () => overrides.ok === false ? overrides : ({
      ok: true,
      session: overrides.session ?? {
        role: 'fc',
        accountKind: 'fc',
        accountId: 'signed-fc-id',
        fcId: 'signed-fc-id',
        phone: '010-0000-0001',
      },
    }),
  });
}

async function sharedValidators() {
  const file = 'supabase/functions/_shared/fc-self-service-auth.ts';
  return {
    hasMismatchedClaimedPhone: await extract(file, 'hasMismatchedClaimedPhone', {
      cleanFcPhone: await extract(file, 'cleanFcPhone'),
    }),
    isExactYmd: await extract(file, 'isExactYmd'),
  };
}

function mutationDb({ readRow = null, updateRow = null, readError = null, updateError = null } = {}) {
  const calls = [];
  const db = {
    from(table) {
      const call = { table, filters: [], payload: null, selected: null, mode: 'read' };
      calls.push(call);
      const query = {
        select(fields) { call.selected = fields; return query; },
        update(payload) { call.mode = 'update'; call.payload = payload; return query; },
        eq(field, value) { call.filters.push(['eq', field, value]); return query; },
        neq(field, value) { call.filters.push(['neq', field, value]); return query; },
        not(field, operator, value) { call.filters.push(['not', field, operator, value]); return query; },
        in(field, values) { call.filters.push(['in', field, [...values]]); return query; },
        or(expression) { call.filters.push(['or', expression]); return query; },
        async maybeSingle() {
          return call.mode === 'update'
            ? { data: updateRow, error: updateError }
            : { data: readRow, error: readError };
        },
      };
      return query;
    },
  };
  return { db, calls };
}

async function edgeHandler(file, { auth, database, koreanToday = '2026-10-13' } = {}) {
  const { hasMismatchedClaimedPhone, isExactYmd } = await sharedValidators();
  const mutationReceiptFile = 'supabase/functions/_shared/ux-mutation-contract.ts';
  const record = await extract(mutationReceiptFile, 'record');
  const context = {
    supabaseUrl: 'https://synthetic.invalid',
    serviceKey: 'synthetic-service-key',
    corsHeaders: {},
    supabase: database,
    requireFcSelfServiceActor: auth,
    hasMismatchedClaimedPhone,
    isExactYmd,
    getKoreanYmd: () => koreanToday,
    requireMutationRowReceipt: await extract(mutationReceiptFile, 'requireMutationRowReceipt', { record }),
    canSubmitInsuranceCommission: profile => Boolean(profile && (
      ['appointment-completed', 'final-link-sent'].includes(profile.status) ||
      (profile.status === 'hanwha-commission-approved' && profile.hanwha_commission_pdf_path && profile.hanwha_commission_pdf_name)
    )),
  };
  context.json = await extract(file, 'json', context);
  context.fail = await extract(file, 'fail', context).catch(() => undefined);
  context.getExpectedDateField = await extract(file, 'getExpectedDateField', context).catch(() => undefined);
  context.trimOrNull = await extract(file, 'trimOrNull', context).catch(() => undefined);
  return extract(file, 'handler', context);
}

test('FC self-service actor requires a current signed FC account binding', async () => {
  const request = new Request('https://synthetic.invalid/self-service', { method: 'POST' });

  for (const failure of [
    { ok: false, code: 'missing_app_session', message: '다시 로그인해주세요.', status: 401 },
    { ok: false, code: 'invalid_app_session', message: '다시 로그인해주세요.', status: 401 },
  ]) {
    const requireActor = await sharedAuth(failure);
    assert.deepEqual(await requireActor(request), failure);
  }

  for (const session of [
    { role: 'admin', accountKind: 'admin', accountId: 'admin-id', phone: '01000000001' },
    { role: 'fc', accountKind: 'manager', accountId: 'manager-id', phone: '01000000001' },
    { role: 'fc', accountKind: 'fc', accountId: 'signed-fc-id', fcId: 'other-fc-id', phone: '01000000001' },
  ]) {
    const requireActor = await sharedAuth({ session });
    assert.deepEqual(JSON.parse(JSON.stringify(await requireActor(request))), {
      ok: false,
      code: 'forbidden',
      message: 'FC 본인 계정으로 다시 로그인해주세요.',
      status: 403,
    });
  }

  const requireActor = await sharedAuth();
  assert.deepEqual(JSON.parse(JSON.stringify(await requireActor(request))), {
    ok: true,
    actor: { id: 'signed-fc-id', phone: '01000000001' },
  });
});

test('consent rejects unauthenticated and foreign-phone requests before any database operation', async () => {
  const file = 'supabase/functions/fc-consent/index.ts';
  for (const authResult of [
    { ok: false, code: 'missing_app_session', message: '다시 로그인해주세요.', status: 401 },
    { ok: false, code: 'invalid_app_session', message: '다시 로그인해주세요.', status: 401 },
    { ok: false, code: 'forbidden', message: 'FC 본인 계정이 필요합니다.', status: 403 },
  ]) {
    const fixture = mutationDb();
    const handler = await edgeHandler(file, { auth: async () => authResult, database: fixture.db });
    const response = await handler(new Request('https://synthetic.invalid/consent', {
      method: 'POST',
      body: JSON.stringify({ allowance_date: '2026-10-13' }),
    }));
    assert.equal(response.status, authResult.status);
    assert.equal(fixture.calls.length, 0);
  }

  const fixture = mutationDb();
  const handler = await edgeHandler(file, {
    auth: async () => ({ ok: true, actor: { id: 'signed-fc-id', phone: '01000000001' } }),
    database: fixture.db,
  });
  const response = await handler(new Request('https://synthetic.invalid/consent', {
    method: 'POST',
    body: JSON.stringify({ phone: '01099999999', allowance_date: '2026-10-13' }),
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'actor_mismatch');
  assert.equal(fixture.calls.length, 0);
});

test('consent writes only the signed self with temp-id and mutable-status predicates', async () => {
  const file = 'supabase/functions/fc-consent/index.ts';
  const actor = { ok: true, actor: { id: 'signed-fc-id', phone: '01000000001' } };
  const success = mutationDb({ updateRow: { id: 'signed-fc-id', name: '합성 FC' } });
  const handler = await edgeHandler(file, { auth: async () => actor, database: success.db });
  const response = await handler(new Request('https://synthetic.invalid/consent', {
    method: 'POST',
    body: JSON.stringify({ allowance_date: '2026-10-13' }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, profile: { id: 'signed-fc-id', name: '합성 FC' } });
  assert.deepEqual(JSON.parse(JSON.stringify(success.calls)), [{
    table: 'fc_profiles',
    mode: 'update',
    payload: {
      allowance_date: '2026-10-13', allowance_prescreen_requested_at: null,
      status: 'allowance-pending', allowance_reject_reason: null,
    },
    selected: 'id,name',
    filters: [
      ['eq', 'id', 'signed-fc-id'],
      ['eq', 'phone', '01000000001'],
      ['not', 'temp_id', 'is', null],
      ['neq', 'temp_id', ''],
      ['or', 'status.is.null,status.in.(draft,temp-id-issued,allowance-pending)'],
    ],
  }]);

  const locked = mutationDb({ updateRow: null });
  const lockedHandler = await edgeHandler(file, { auth: async () => actor, database: locked.db });
  const lockedResponse = await lockedHandler(new Request('https://synthetic.invalid/consent', {
    method: 'POST',
    body: JSON.stringify({ allowance_date: '2026-10-13' }),
  }));
  assert.equal(lockedResponse.status, 409);
  assert.equal((await lockedResponse.json()).code, 'consent_locked_or_prerequisite_missing');
  assert.ok(!locked.calls[0].filters[4][1].includes('allowance-consented'));
});

test('consent rejects impossible and future calendar dates before querying', async () => {
  const file = 'supabase/functions/fc-consent/index.ts';
  for (const allowanceDate of ['2026-02-29', '2026-02-31', '2026-10-14', '2026-2-01']) {
    const fixture = mutationDb();
    const handler = await edgeHandler(file, {
      auth: async () => ({ ok: true, actor: { id: 'signed-fc-id', phone: '01000000001' } }),
      database: fixture.db,
    });
    const response = await handler(new Request('https://synthetic.invalid/consent', {
      method: 'POST',
      body: JSON.stringify({ allowance_date: allowanceDate }),
    }));
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.length, 0);
  }
});

test('appointment and Hanwha mutations bind both profile id and phone to the signed actor', async () => {
  const actor = { ok: true, actor: { id: 'signed-fc-id', phone: '01000000001' } };
  const cases = [
    {
      file: 'supabase/functions/fc-submit-appointment/index.ts',
      body: { type: 'life', date_field: 'appointment_date_life_sub', date_value: '2026-10-13' },
      readRow: {
        id: 'signed-fc-id', status: 'hanwha-commission-approved',
        hanwha_commission_pdf_path: 'synthetic.pdf', hanwha_commission_pdf_name: 'synthetic.pdf',
      },
      updateRow: { id: 'signed-fc-id', name: '합성 FC' },
    },
    {
      file: 'supabase/functions/fc-submit-hanwha-commission/index.ts',
      body: { hanwha_commission_date_sub: '2026-10-13' },
      readRow: { id: 'signed-fc-id', name: '합성 FC', status: 'docs-approved' },
      updateRow: {
        id: 'signed-fc-id',
        name: '합성 FC',
        status: 'hanwha-commission-review',
        hanwha_commission_date_sub: '2026-10-13',
        hanwha_commission_pdf_path: null,
        hanwha_commission_pdf_name: null,
      },
    },
  ];

  for (const current of cases) {
    const fixture = mutationDb({
      readRow: current.readRow,
      updateRow: current.updateRow,
    });
    const handler = await edgeHandler(current.file, { auth: async () => actor, database: fixture.db });
    const response = await handler(new Request('https://synthetic.invalid/mutate', {
      method: 'POST', body: JSON.stringify(current.body),
    }));
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.length, 2);
    for (const call of fixture.calls) {
      assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'id' && filter[2] === 'signed-fc-id'));
      assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'phone' && filter[2] === '01000000001'));
    }
  }

  const invalidReceipt = mutationDb({
    readRow: { id: 'signed-fc-id', name: '합성 FC', status: 'docs-approved' },
    updateRow: { id: 'signed-fc-id', status: 'docs-approved' },
  });
  const invalidReceiptHandler = await edgeHandler('supabase/functions/fc-submit-hanwha-commission/index.ts', {
    auth: async () => actor,
    database: invalidReceipt.db,
  });
  const invalidReceiptResponse = await invalidReceiptHandler(new Request('https://synthetic.invalid/mutate', {
    method: 'POST',
    body: JSON.stringify({ hanwha_commission_date_sub: '2026-10-13' }),
  }));
  assert.equal(invalidReceiptResponse.status, 502);
  assert.equal((await invalidReceiptResponse.json()).code, 'mutation_receipt_unverified');
});

test('mobile self-service callers send the signed session header and no actor selector', async () => {
  for (const file of ['app/consent.tsx', 'app/appointment.tsx', 'app/hanwha-commission.tsx']) {
    const source = await readFile(new URL(file, root), 'utf8');
    assert.match(source, /appSessionToken/);
    assert.match(source, /headers:\s*\{\s*'x-app-session-token': appSessionToken\s*\}/);
    assert.doesNotMatch(source, /\n\s+phone:\s*cleanPhone,/);
  }
  const consent = await readFile(new URL('app/consent.tsx', root), 'utf8');
  assert.doesNotMatch(consent, /body:\s*\{\s*phone,/);
  assert.match(consent, /maximumDate=\{new Date\(\)\}/);
});
