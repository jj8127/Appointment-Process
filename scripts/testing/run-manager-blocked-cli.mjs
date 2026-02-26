import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const FC_ENV_PATH = path.join(ROOT, '.env');
const WEB_ENV_PATH = path.join(ROOT, 'web', '.env.local');
const RB_ENV_PATH = path.join(ROOT, '..', 'request_board', 'server', '.env');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'testing', 'evidence');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function ensure(value, name) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function assertTrue(condition, message, context = {}) {
  if (!condition) {
    const err = new Error(message);
    err.context = context;
    throw err;
  }
}

function normalizeRequestBoardPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function buildPhone(seed) {
  const suffix = String(seed % 100000000).padStart(8, '0');
  return `018${suffix}`;
}

function pbkdf2Base64(password, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return derived.toString('base64');
}

function randomBase64(length) {
  return crypto.randomBytes(length).toString('base64');
}

async function callFcFunction({ supabaseUrl, anonKey, fnName, payload }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function requestBoardLogin(baseUrl, phone, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function rbApi(baseUrl, token, method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  const fcEnv = parseEnvFile(FC_ENV_PATH);
  const webEnv = parseEnvFile(WEB_ENV_PATH);
  const rbEnv = parseEnvFile(RB_ENV_PATH);

  const supabaseUrl = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const fcServiceRole = ensure(webEnv.SUPABASE_SERVICE_ROLE_KEY, 'web/.env.local SUPABASE_SERVICE_ROLE_KEY');
  const rbBaseUrl = (fcEnv.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app').replace(/\/$/, '');
  const rbSupabaseUrl = ensure(rbEnv.SUPABASE_URL, 'request_board/server/.env SUPABASE_URL');
  const rbServiceRole = ensure(rbEnv.SUPABASE_SERVICE_ROLE_KEY, 'request_board/server/.env SUPABASE_SERVICE_ROLE_KEY');

  const fcAdmin = createClient(supabaseUrl, fcServiceRole);
  const rbAdmin = createClient(rbSupabaseUrl, rbServiceRole);

  const seed = Date.now();
  const managerPhone = buildPhone(seed);
  const managerPassword = `Mgr${String(seed).slice(-6)}!aA`;
  const managerName = `TC_MANAGER_${String(seed).slice(-4)}`;

  const saltBase64 = randomBase64(16);
  const hashBase64 = pbkdf2Base64(managerPassword, saltBase64);

  const evidence = {
    generatedAt: nowIso(),
    scope: ['RB-08', 'P0-02(partial-api)'],
    managerPhoneSuffix: managerPhone.slice(-4),
    steps: {},
    cleanup: null,
  };

  const { error: upsertManagerError } = await fcAdmin
    .from('manager_accounts')
    .upsert(
      {
        name: managerName,
        phone: managerPhone,
        password_hash: hashBase64,
        password_salt: saltBase64,
        password_set_at: nowIso(),
        failed_count: 0,
        locked_until: null,
        active: true,
      },
      { onConflict: 'phone' },
    );
  assertTrue(!upsertManagerError, 'manager account upsert failed', { error: upsertManagerError?.message });
  evidence.steps.managerAccountUpsert = { ok: true, at: nowIso() };

  const managerLoginRes = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'login-with-password',
    payload: { phone: managerPhone, password: managerPassword },
  });
  assertTrue(
    managerLoginRes.ok && managerLoginRes.data?.ok === true && managerLoginRes.data?.role === 'manager',
    'manager login-with-password failed',
    { status: managerLoginRes.status, body: managerLoginRes.data },
  );
  evidence.steps.managerLogin = {
    status: managerLoginRes.status,
    role: managerLoginRes.data?.role,
    at: nowIso(),
  };

  const rbLoginRes = await requestBoardLogin(rbBaseUrl, managerPhone, managerPassword);
  assertTrue(
    rbLoginRes.ok && rbLoginRes.data?.success === true && rbLoginRes.data?.data?.user?.role === 'fc',
    'request_board login for manager bridge user failed',
    { status: rbLoginRes.status, body: rbLoginRes.data },
  );
  const rbToken = rbLoginRes.data?.data?.token;
  assertTrue(typeof rbToken === 'string' && rbToken.length > 20, 'request_board token missing');
  evidence.steps.requestBoardLogin = {
    status: rbLoginRes.status,
    role: rbLoginRes.data?.data?.user?.role,
    at: nowIso(),
  };

  const companyNamesRes = await rbApi(rbBaseUrl, rbToken, 'GET', '/api/fc-codes/company-names');
  assertTrue(companyNamesRes.ok && companyNamesRes.data?.success === true, 'fc-codes company-names failed', {
    status: companyNamesRes.status,
    body: companyNamesRes.data,
  });
  const companyNames = Array.isArray(companyNamesRes.data?.data) ? companyNamesRes.data.data : [];
  const targetCompanyName = companyNames[0] || '테스트보험사';
  evidence.steps.fcCodesCompanyNames = {
    status: companyNamesRes.status,
    count: companyNames.length,
    at: nowIso(),
  };

  const createRes = await rbApi(rbBaseUrl, rbToken, 'POST', '/api/fc-codes', {
    insurerName: targetCompanyName,
    codeValue: `MGR-${String(seed).slice(-6)}`,
  });
  assertTrue(createRes.ok && createRes.data?.success === true, 'fc-codes create failed', {
    status: createRes.status,
    body: createRes.data,
  });
  const codeId = Number(createRes.data?.data?.id);
  assertTrue(Number.isFinite(codeId), 'fc-codes id missing after create', { body: createRes.data });
  evidence.steps.fcCodesCreate = {
    status: createRes.status,
    codeId,
    company: targetCompanyName,
    at: nowIso(),
  };

  const patchRes = await rbApi(rbBaseUrl, rbToken, 'PATCH', `/api/fc-codes/${codeId}`, {
    codeValue: `MGRU-${String(seed).slice(-6)}`,
  });
  assertTrue(patchRes.ok && patchRes.data?.success === true, 'fc-codes patch failed', {
    status: patchRes.status,
    body: patchRes.data,
  });
  evidence.steps.fcCodesPatch = { status: patchRes.status, at: nowIso() };

  const listRes = await rbApi(rbBaseUrl, rbToken, 'GET', '/api/fc-codes');
  assertTrue(listRes.ok && listRes.data?.success === true, 'fc-codes list failed', {
    status: listRes.status,
    body: listRes.data,
  });
  const listRows = Array.isArray(listRes.data?.data) ? listRes.data.data : [];
  const hasPatched = listRows.some((row) => Number(row.id) === codeId && String(row.code_value).startsWith('MGRU-'));
  assertTrue(hasPatched, 'fc-codes patched value not found in list', { codeId });
  evidence.steps.fcCodesListAfterPatch = { status: listRes.status, rowCount: listRows.length, at: nowIso() };

  const deleteRes = await rbApi(rbBaseUrl, rbToken, 'DELETE', `/api/fc-codes/${codeId}`);
  assertTrue(deleteRes.ok && deleteRes.data?.success === true, 'fc-codes delete failed', {
    status: deleteRes.status,
    body: deleteRes.data,
  });
  evidence.steps.fcCodesDelete = { status: deleteRes.status, at: nowIso() };

  const listAfterDeleteRes = await rbApi(rbBaseUrl, rbToken, 'GET', '/api/fc-codes');
  assertTrue(listAfterDeleteRes.ok && listAfterDeleteRes.data?.success === true, 'fc-codes list after delete failed', {
    status: listAfterDeleteRes.status,
    body: listAfterDeleteRes.data,
  });
  const listAfterDeleteRows = Array.isArray(listAfterDeleteRes.data?.data) ? listAfterDeleteRes.data.data : [];
  const stillExists = listAfterDeleteRows.some((row) => Number(row.id) === codeId);
  assertTrue(!stillExists, 'deleted fc-code still exists', { codeId });
  evidence.steps.fcCodesListAfterDelete = {
    status: listAfterDeleteRes.status,
    rowCount: listAfterDeleteRows.length,
    at: nowIso(),
  };

  const managerUnauthorizedAdminAction = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'admin-action',
    payload: {
      adminPhone: managerPhone,
      action: 'updateStatus',
      payload: { fcId: '00000000-0000-0000-0000-000000000000', status: 'draft' },
    },
  });
  assertTrue(
    managerUnauthorizedAdminAction.status === 403 && managerUnauthorizedAdminAction.data?.ok === false,
    'manager admin-action should be unauthorized',
    {
      status: managerUnauthorizedAdminAction.status,
      body: managerUnauthorizedAdminAction.data,
    },
  );
  evidence.steps.managerAdminActionUnauthorized = {
    status: managerUnauthorizedAdminAction.status,
    message: managerUnauthorizedAdminAction.data?.message ?? null,
    at: nowIso(),
  };

  const keepData = process.argv.includes('--keep-data');
  if (!keepData) {
    const { error: managerDeleteErr } = await fcAdmin
      .from('manager_accounts')
      .delete()
      .eq('phone', managerPhone);
    assertTrue(!managerDeleteErr, 'manager cleanup failed', { error: managerDeleteErr?.message });

    const rbPhone = normalizeRequestBoardPhone(managerPhone);
    const { error: rbDeleteErr } = await rbAdmin
      .from('users')
      .delete()
      .eq('phone', rbPhone);
    assertTrue(!rbDeleteErr, 'request_board cleanup failed', { error: rbDeleteErr?.message });

    evidence.cleanup = { keepData: false, at: nowIso() };
  } else {
    evidence.cleanup = { keepData: true, at: nowIso() };
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const jsonPath = path.join(EVIDENCE_DIR, `manager-blocked-cli-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `manager-blocked-cli-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');

  const lines = [];
  lines.push('# Manager Blocked Case CLI Evidence');
  lines.push('');
  lines.push(`- generatedAt: ${evidence.generatedAt}`);
  lines.push(`- scope: ${evidence.scope.join(', ')}`);
  lines.push(`- managerPhoneSuffix: ${evidence.managerPhoneSuffix}`);
  lines.push('');
  lines.push('## RB-08');
  lines.push(`- manager login-with-password: ${evidence.steps.managerLogin.status}`);
  lines.push(`- request_board login(role=fc): ${evidence.steps.requestBoardLogin.status}`);
  lines.push(`- fc-codes company-names: ${evidence.steps.fcCodesCompanyNames.status} (count=${evidence.steps.fcCodesCompanyNames.count})`);
  lines.push(`- fc-codes create: ${evidence.steps.fcCodesCreate.status} (id=${evidence.steps.fcCodesCreate.codeId})`);
  lines.push(`- fc-codes patch: ${evidence.steps.fcCodesPatch.status}`);
  lines.push(`- fc-codes list after patch: ${evidence.steps.fcCodesListAfterPatch.status}`);
  lines.push(`- fc-codes delete: ${evidence.steps.fcCodesDelete.status}`);
  lines.push(`- fc-codes list after delete: ${evidence.steps.fcCodesListAfterDelete.status}`);
  lines.push('');
  lines.push('## P0-02 (partial API)');
  lines.push(`- manager admin-action unauthorized: ${evidence.steps.managerAdminActionUnauthorized.status}`);
  lines.push('');
  lines.push('## Cleanup');
  lines.push(`- keepData: ${evidence.cleanup.keepData}`);
  lines.push(`- executedAt: ${evidence.cleanup.at}`);
  lines.push('');
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, scope: evidence.scope }, null, 2));
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        context: error?.context ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
