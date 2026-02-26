import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const FC_ENV_PATH = path.join(ROOT, '.env');
const WEB_ENV_PATH = path.join(ROOT, 'web', '.env.local');
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

function digitsPhone(seed, offset) {
  const suffix = String((Number(seed) + offset) % 100000000).padStart(8, '0');
  return `015${suffix}`;
}

function randomBase64(bytes) {
  return crypto.randomBytes(bytes).toString('base64');
}

function pbkdf2Base64(password, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64');
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

async function run() {
  const fcEnv = parseEnvFile(FC_ENV_PATH);
  const webEnv = parseEnvFile(WEB_ENV_PATH);

  const supabaseUrl = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRole = ensure(webEnv.SUPABASE_SERVICE_ROLE_KEY, 'web/.env.local SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRole);

  const seed = Date.now();
  const adminPhone = digitsPhone(seed, 100);
  const fcPhone = digitsPhone(seed, 200);
  const adminName = `TC_ADMIN_${String(seed).slice(-4)}`;
  const password = `Adm${String(seed).slice(-6)}!aA`;

  const salt = randomBase64(16);
  const hash = pbkdf2Base64(password, salt);

  const evidence = {
    generatedAt: nowIso(),
    scope: ['ONB-04'],
    phones: {
      adminSuffix: adminPhone.slice(-4),
      fcSuffix: fcPhone.slice(-4),
    },
    steps: {},
    cleanup: null,
  };

  const { error: adminUpsertError } = await admin
    .from('admin_accounts')
    .upsert(
      {
        name: adminName,
        phone: adminPhone,
        password_hash: hash,
        password_salt: salt,
        password_set_at: nowIso(),
        failed_count: 0,
        locked_until: null,
        active: true,
      },
      { onConflict: 'phone' },
    );
  assertTrue(!adminUpsertError, 'admin upsert failed', { error: adminUpsertError?.message });
  evidence.steps.adminUpsert = { ok: true, at: nowIso() };

  const { data: fcProfile, error: fcInsertError } = await admin
    .from('fc_profiles')
    .insert({
      name: `TC_FC_${String(seed).slice(-4)}`,
      affiliation: '1팀',
      phone: fcPhone,
      status: 'temp-id-issued',
      temp_id: `TEMP_${String(seed).slice(-8)}`,
      signup_completed: true,
      identity_completed: true,
    })
    .select('id,status,temp_id')
    .single();
  assertTrue(!fcInsertError && !!fcProfile?.id, 'fc profile insert failed', { error: fcInsertError?.message });
  const fcId = fcProfile.id;
  evidence.steps.fcProfileInsert = { ok: true, fcId, at: nowIso() };

  const consentSubmit = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'fc-consent',
    payload: { phone: fcPhone, allowance_date: '2026-02-26' },
  });
  assertTrue(consentSubmit.status === 200 && consentSubmit.data?.ok === true, 'fc-consent submit failed', {
    status: consentSubmit.status,
    body: consentSubmit.data,
  });

  const { data: afterConsent, error: afterConsentErr } = await admin
    .from('fc_profiles')
    .select('status,allowance_date,allowance_reject_reason')
    .eq('id', fcId)
    .single();
  assertTrue(!afterConsentErr, 'fc profile query after consent failed', { error: afterConsentErr?.message });
  assertTrue(afterConsent?.status === 'allowance-pending', 'status after consent should be allowance-pending', {
    actual: afterConsent?.status,
  });
  evidence.steps.fcConsentSubmit = {
    status: consentSubmit.status,
    profileStatus: afterConsent?.status,
    allowanceDate: afterConsent?.allowance_date,
    at: nowIso(),
  };

  const adminApprove = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'admin-action',
    payload: {
      adminPhone,
      action: 'updateStatus',
      payload: { fcId, status: 'allowance-consented' },
    },
  });
  assertTrue(adminApprove.status === 200 && adminApprove.data?.ok === true, 'admin approve failed', {
    status: adminApprove.status,
    body: adminApprove.data,
  });
  const { data: afterApprove, error: afterApproveErr } = await admin
    .from('fc_profiles')
    .select('status,allowance_reject_reason')
    .eq('id', fcId)
    .single();
  assertTrue(!afterApproveErr, 'fc profile query after approve failed', { error: afterApproveErr?.message });
  assertTrue(afterApprove?.status === 'allowance-consented', 'status after approve mismatch', {
    actual: afterApprove?.status,
  });
  evidence.steps.adminApprove = { status: adminApprove.status, profileStatus: afterApprove?.status, at: nowIso() };

  const adminReject = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'admin-action',
    payload: {
      adminPhone,
      action: 'updateStatus',
      payload: {
        fcId,
        status: 'temp-id-issued',
        extra: { allowance_reject_reason: 'TC_REJECT_REASON' },
      },
    },
  });
  assertTrue(adminReject.status === 200 && adminReject.data?.ok === true, 'admin reject failed', {
    status: adminReject.status,
    body: adminReject.data,
  });
  const { data: afterReject, error: afterRejectErr } = await admin
    .from('fc_profiles')
    .select('status,allowance_reject_reason')
    .eq('id', fcId)
    .single();
  assertTrue(!afterRejectErr, 'fc profile query after reject failed', { error: afterRejectErr?.message });
  assertTrue(afterReject?.status === 'temp-id-issued', 'status after reject mismatch', { actual: afterReject?.status });
  assertTrue(afterReject?.allowance_reject_reason === 'TC_REJECT_REASON', 'reject reason mismatch', {
    actual: afterReject?.allowance_reject_reason,
  });
  evidence.steps.adminReject = {
    status: adminReject.status,
    profileStatus: afterReject?.status,
    rejectReason: afterReject?.allowance_reject_reason,
    at: nowIso(),
  };

  const consentResubmit = await callFcFunction({
    supabaseUrl,
    anonKey,
    fnName: 'fc-consent',
    payload: { phone: fcPhone, allowance_date: '2026-02-27' },
  });
  assertTrue(consentResubmit.status === 200 && consentResubmit.data?.ok === true, 'fc-consent resubmit failed', {
    status: consentResubmit.status,
    body: consentResubmit.data,
  });
  const { data: afterResubmit, error: afterResubmitErr } = await admin
    .from('fc_profiles')
    .select('status,allowance_date,allowance_reject_reason')
    .eq('id', fcId)
    .single();
  assertTrue(!afterResubmitErr, 'fc profile query after resubmit failed', { error: afterResubmitErr?.message });
  assertTrue(afterResubmit?.status === 'allowance-pending', 'status after resubmit mismatch', {
    actual: afterResubmit?.status,
  });
  assertTrue(afterResubmit?.allowance_reject_reason === null, 'reject reason should be cleared on resubmit', {
    actual: afterResubmit?.allowance_reject_reason,
  });
  evidence.steps.fcConsentResubmit = {
    status: consentResubmit.status,
    profileStatus: afterResubmit?.status,
    allowanceDate: afterResubmit?.allowance_date,
    rejectReason: afterResubmit?.allowance_reject_reason,
    at: nowIso(),
  };

  const keepData = process.argv.includes('--keep-data');
  if (!keepData) {
    const { error: fcDeleteErr } = await admin.from('fc_profiles').delete().eq('id', fcId);
    assertTrue(!fcDeleteErr, 'fc cleanup failed', { error: fcDeleteErr?.message });

    const { error: adminDeleteErr } = await admin.from('admin_accounts').delete().eq('phone', adminPhone);
    assertTrue(!adminDeleteErr, 'admin cleanup failed', { error: adminDeleteErr?.message });

    evidence.cleanup = { keepData: false, at: nowIso() };
  } else {
    evidence.cleanup = { keepData: true, at: nowIso() };
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const jsonPath = path.join(EVIDENCE_DIR, `admin-blocked-cli-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `admin-blocked-cli-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');

  const lines = [];
  lines.push('# Admin Blocked Case CLI Evidence');
  lines.push('');
  lines.push(`- generatedAt: ${evidence.generatedAt}`);
  lines.push(`- scope: ${evidence.scope.join(', ')}`);
  lines.push(`- adminPhoneSuffix: ${evidence.phones.adminSuffix}`);
  lines.push(`- fcPhoneSuffix: ${evidence.phones.fcSuffix}`);
  lines.push('');
  lines.push('## ONB-04');
  lines.push(`- FC consent submit -> status: ${evidence.steps.fcConsentSubmit.profileStatus}`);
  lines.push(`- Admin approve -> status: ${evidence.steps.adminApprove.profileStatus}`);
  lines.push(`- Admin reject -> status: ${evidence.steps.adminReject.profileStatus}, reason: ${evidence.steps.adminReject.rejectReason}`);
  lines.push(`- FC resubmit consent -> status: ${evidence.steps.fcConsentResubmit.profileStatus}, rejectReason: ${String(evidence.steps.fcConsentResubmit.rejectReason)}`);
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
