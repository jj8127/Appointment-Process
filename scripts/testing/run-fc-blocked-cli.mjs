import fs from 'node:fs';
import path from 'node:path';
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
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function assertTrue(condition, message, context = {}) {
  if (!condition) {
    const err = new Error(message);
    err.context = context;
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRequestBoardPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function buildPhone(seed, offset) {
  const numeric = Number(seed) + offset;
  const suffix = String(numeric % 100000000).padStart(8, '0');
  return `019${suffix}`;
}

function buildPassword(prefix, seed, offset) {
  const numeric = String((Number(seed) + offset) % 1000000).padStart(6, '0');
  return `${prefix}${numeric}!aA`;
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

async function requestBoardSyncPassword(baseUrl, token, payload) {
  const res = await fetch(`${baseUrl}/api/auth/sync-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-bridge-token': token,
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

async function run() {
  const fcEnv = parseEnvFile(FC_ENV_PATH);
  const webEnv = parseEnvFile(WEB_ENV_PATH);
  const rbEnv = parseEnvFile(RB_ENV_PATH);

  const supabaseUrl = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const fcServiceRole = ensure(webEnv.SUPABASE_SERVICE_ROLE_KEY, 'web/.env.local SUPABASE_SERVICE_ROLE_KEY');
  const rbBaseUrl = (fcEnv.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app').replace(/\/$/, '');
  const rbSyncToken = ensure(rbEnv.FC_ONBOARDING_PASSWORD_SYNC_TOKEN, 'request_board/server/.env FC_ONBOARDING_PASSWORD_SYNC_TOKEN');
  const rbSupabaseUrl = ensure(rbEnv.SUPABASE_URL, 'request_board/server/.env SUPABASE_URL');
  const rbServiceRole = ensure(rbEnv.SUPABASE_SERVICE_ROLE_KEY, 'request_board/server/.env SUPABASE_SERVICE_ROLE_KEY');

  const fcAdmin = createClient(supabaseUrl, fcServiceRole);
  const rbAdmin = createClient(rbSupabaseUrl, rbServiceRole);

  const seed = Date.now();
  const commissionMatrix = [
    { key: 'none', expectedStatus: 'draft', life: false, nonlife: false },
    { key: 'life_only', expectedStatus: 'draft', life: true, nonlife: false },
    { key: 'nonlife_only', expectedStatus: 'draft', life: false, nonlife: true },
    { key: 'both', expectedStatus: 'final-link-sent', life: true, nonlife: true },
  ];

  const evidence = {
    generatedAt: nowIso(),
    environment: {
      supabaseProject: new URL(supabaseUrl).host,
      requestBoardBaseUrl: rbBaseUrl,
    },
    scope: ['ONB-01', 'P0-11', 'P0-12', 'P0-13'],
    commissionRuns: [],
    resetSyncRun: null,
    syncRecoveryRun: null,
    cleanup: null,
  };

  const createdPhones = [];

  for (let i = 0; i < commissionMatrix.length; i += 1) {
    const scenario = commissionMatrix[i];
    const phone = buildPhone(seed, i + 1);
    const password = buildPassword('FcOnb', seed, i + 11);
    const name = `TC_FC_${scenario.key}_${String(seed).slice(-4)}`;

    const signupRes = await callFcFunction({
      supabaseUrl,
      anonKey,
      fnName: 'set-password',
      payload: {
        phone,
        password,
        confirm: password,
        name,
        affiliation: '1팀',
        recommender: 'TC',
        email: `tc_${scenario.key}_${seed}@example.com`,
        carrier: '테스트',
        commissionStatus: scenario.key,
      },
    });

    assertTrue(signupRes.ok && signupRes.data?.ok === true, 'set-password failed', {
      scenario: scenario.key,
      status: signupRes.status,
      body: signupRes.data,
    });

    const { data: profile, error: profileError } = await fcAdmin
      .from('fc_profiles')
      .select('id,phone,status,life_commission_completed,nonlife_commission_completed,signup_completed')
      .eq('phone', phone)
      .maybeSingle();

    assertTrue(!profileError, 'fc profile query failed', {
      scenario: scenario.key,
      error: profileError?.message,
    });
    assertTrue(!!profile?.id, 'fc profile not found after set-password', { scenario: scenario.key, phone });
    assertTrue(profile.status === scenario.expectedStatus, 'unexpected fc status after set-password', {
      scenario: scenario.key,
      expected: scenario.expectedStatus,
      actual: profile.status,
    });
    assertTrue(profile.life_commission_completed === scenario.life, 'unexpected life_commission_completed', {
      scenario: scenario.key,
      expected: scenario.life,
      actual: profile.life_commission_completed,
    });
    assertTrue(profile.nonlife_commission_completed === scenario.nonlife, 'unexpected nonlife_commission_completed', {
      scenario: scenario.key,
      expected: scenario.nonlife,
      actual: profile.nonlife_commission_completed,
    });
    assertTrue(profile.signup_completed === true, 'signup_completed should be true', { scenario: scenario.key });

    const fcLoginRes = await callFcFunction({
      supabaseUrl,
      anonKey,
      fnName: 'login-with-password',
      payload: { phone, password },
    });
    assertTrue(fcLoginRes.ok && fcLoginRes.data?.ok === true && fcLoginRes.data?.role === 'fc', 'fc login failed', {
      scenario: scenario.key,
      status: fcLoginRes.status,
      body: fcLoginRes.data,
    });

    const rbLoginRes = await requestBoardLogin(rbBaseUrl, phone, password);
    assertTrue(
      rbLoginRes.ok && rbLoginRes.data?.success === true && rbLoginRes.data?.data?.user?.role === 'fc',
      'request_board login failed after set-password sync',
      {
        scenario: scenario.key,
        status: rbLoginRes.status,
        body: rbLoginRes.data,
      },
    );

    createdPhones.push({ phone, password });
    evidence.commissionRuns.push({
      scenario: scenario.key,
      phoneSuffix: phone.slice(-4),
      setPasswordStatus: signupRes.status,
      fcLoginStatus: fcLoginRes.status,
      rbLoginStatus: rbLoginRes.status,
      expectedStatus: scenario.expectedStatus,
      verifiedAt: nowIso(),
    });
  }

  const target = createdPhones[0];
  const resetPassword = buildPassword('ResetFc', seed, 501);

  const resetRes = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'reset-password',
    payload: {
      phone: target.phone,
      token: '123456',
      newPassword: resetPassword,
      confirm: resetPassword,
    },
  });
  assertTrue(resetRes.ok && resetRes.data?.ok === true, 'reset-password failed', {
    status: resetRes.status,
    body: resetRes.data,
  });

  const fcLoginAfterReset = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'login-with-password',
    payload: { phone: target.phone, password: resetPassword },
  });
  assertTrue(fcLoginAfterReset.ok && fcLoginAfterReset.data?.ok === true, 'fc login after reset failed', {
    status: fcLoginAfterReset.status,
    body: fcLoginAfterReset.data,
  });

  const rbLoginAfterReset = await requestBoardLogin(rbBaseUrl, target.phone, resetPassword);
  assertTrue(
    rbLoginAfterReset.ok && rbLoginAfterReset.data?.success === true,
    'request_board login with reset password failed',
    { status: rbLoginAfterReset.status, body: rbLoginAfterReset.data },
  );

  evidence.resetSyncRun = {
    phoneSuffix: target.phone.slice(-4),
    resetStatus: resetRes.status,
    fcLoginStatus: fcLoginAfterReset.status,
    rbLoginStatus: rbLoginAfterReset.status,
    verifiedAt: nowIso(),
  };

  const desyncPassword = buildPassword('DesyncFc', seed, 777);
  const syncRes = await requestBoardSyncPassword(rbBaseUrl, rbSyncToken, {
    phone: target.phone,
    password: desyncPassword,
    role: 'fc',
    name: 'TC Desync',
  });
  assertTrue(syncRes.ok && syncRes.data?.success === true, 'request_board sync-password pre-desync failed', {
    status: syncRes.status,
    body: syncRes.data,
  });

  const rbLoginDesync = await requestBoardLogin(rbBaseUrl, target.phone, desyncPassword);
  assertTrue(rbLoginDesync.ok && rbLoginDesync.data?.success === true, 'desync password login should pass', {
    status: rbLoginDesync.status,
    body: rbLoginDesync.data,
  });

  const rbLoginOldAfterDesync = await requestBoardLogin(rbBaseUrl, target.phone, resetPassword);
  assertTrue(
    rbLoginOldAfterDesync.status === 401 && rbLoginOldAfterDesync.data?.success === false,
    'old password should fail after desync',
    {
      status: rbLoginOldAfterDesync.status,
      body: rbLoginOldAfterDesync.data,
    },
  );

  const fcLoginResync = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'login-with-password',
    payload: { phone: target.phone, password: resetPassword },
  });
  assertTrue(fcLoginResync.ok && fcLoginResync.data?.ok === true, 'fc login for resync failed', {
    status: fcLoginResync.status,
    body: fcLoginResync.data,
  });

  const rbLoginRecovered = await requestBoardLogin(rbBaseUrl, target.phone, resetPassword);
  assertTrue(
    rbLoginRecovered.ok && rbLoginRecovered.data?.success === true,
    'request_board login with recovered password failed',
    { status: rbLoginRecovered.status, body: rbLoginRecovered.data },
  );

  const rbLoginDesyncAfterRecovery = await requestBoardLogin(rbBaseUrl, target.phone, desyncPassword);
  assertTrue(
    rbLoginDesyncAfterRecovery.status === 401 && rbLoginDesyncAfterRecovery.data?.success === false,
    'desync password should fail after recovery',
    {
      status: rbLoginDesyncAfterRecovery.status,
      body: rbLoginDesyncAfterRecovery.data,
    },
  );

  evidence.syncRecoveryRun = {
    phoneSuffix: target.phone.slice(-4),
    desyncSyncStatus: syncRes.status,
    rbDesyncLoginStatus: rbLoginDesync.status,
    rbOldPasswordFailureStatus: rbLoginOldAfterDesync.status,
    fcResyncLoginStatus: fcLoginResync.status,
    rbRecoveredLoginStatus: rbLoginRecovered.status,
    rbDesyncAfterRecoveryFailureStatus: rbLoginDesyncAfterRecovery.status,
    verifiedAt: nowIso(),
  };

  const keepData = process.argv.includes('--keep-data');
  if (!keepData) {
    const fcPhones = createdPhones.map((it) => it.phone);
    const { error: fcDeleteError } = await fcAdmin
      .from('fc_profiles')
      .delete()
      .in('phone', fcPhones);
    assertTrue(!fcDeleteError, 'fc cleanup failed', { error: fcDeleteError?.message });

    const rbPhones = fcPhones.map((p) => normalizeRequestBoardPhone(p));
    const { error: rbDeleteError } = await rbAdmin
      .from('users')
      .delete()
      .in('phone', rbPhones);
    assertTrue(!rbDeleteError, 'request_board cleanup failed', { error: rbDeleteError?.message });

    evidence.cleanup = {
      keepData: false,
      fcDeletedCount: fcPhones.length,
      rbDeletedCount: rbPhones.length,
      executedAt: nowIso(),
    };
  } else {
    evidence.cleanup = {
      keepData: true,
      executedAt: nowIso(),
    };
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const jsonPath = path.join(EVIDENCE_DIR, `fc-blocked-cli-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `fc-blocked-cli-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');

  const lines = [];
  lines.push('# FC Blocked Case CLI Evidence');
  lines.push('');
  lines.push(`- generatedAt: ${evidence.generatedAt}`);
  lines.push(`- scope: ${evidence.scope.join(', ')}`);
  lines.push(`- supabaseProject: ${evidence.environment.supabaseProject}`);
  lines.push(`- requestBoardBaseUrl: ${evidence.environment.requestBoardBaseUrl}`);
  lines.push('');
  lines.push('## ONB-01 + P0-11');
  for (const row of evidence.commissionRuns) {
    lines.push(
      `- ${row.scenario}: phoneSuffix=${row.phoneSuffix}, setPassword=${row.setPasswordStatus}, fcLogin=${row.fcLoginStatus}, rbLogin=${row.rbLoginStatus}, expectedStatus=${row.expectedStatus}`,
    );
  }
  lines.push('');
  lines.push('## P0-12');
  lines.push(
    `- phoneSuffix=${evidence.resetSyncRun.phoneSuffix}, reset=${evidence.resetSyncRun.resetStatus}, fcLogin=${evidence.resetSyncRun.fcLoginStatus}, rbLogin=${evidence.resetSyncRun.rbLoginStatus}`,
  );
  lines.push('');
  lines.push('## P0-13');
  lines.push(
    `- phoneSuffix=${evidence.syncRecoveryRun.phoneSuffix}, desyncSync=${evidence.syncRecoveryRun.desyncSyncStatus}, rbDesyncLogin=${evidence.syncRecoveryRun.rbDesyncLoginStatus}, rbOldFail=${evidence.syncRecoveryRun.rbOldPasswordFailureStatus}, fcResync=${evidence.syncRecoveryRun.fcResyncLoginStatus}, rbRecovered=${evidence.syncRecoveryRun.rbRecoveredLoginStatus}, rbDesyncFailAfterRecovery=${evidence.syncRecoveryRun.rbDesyncAfterRecoveryFailureStatus}`,
  );
  lines.push('');
  lines.push('## Cleanup');
  lines.push(`- keepData: ${evidence.cleanup.keepData}`);
  if (!evidence.cleanup.keepData) {
    lines.push(`- fcDeletedCount: ${evidence.cleanup.fcDeletedCount}`);
    lines.push(`- rbDeletedCount: ${evidence.cleanup.rbDeletedCount}`);
  }
  lines.push(`- executedAt: ${evidence.cleanup.executedAt}`);
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
