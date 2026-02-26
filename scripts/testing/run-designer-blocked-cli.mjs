import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const FC_ENV_PATH = path.join(ROOT, '.env');
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

function digitsPhone(seed, offset) {
  const suffix = String((Number(seed) + offset) % 100000000).padStart(8, '0');
  return `016${suffix}`;
}

async function apiCall({ baseUrl, method, route, body, token }) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const rbEnv = parseEnvFile(RB_ENV_PATH);

  const rbBaseUrl = (fcEnv.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app').replace(/\/$/, '');
  const rbSupabaseUrl = ensure(rbEnv.SUPABASE_URL, 'request_board/server/.env SUPABASE_URL');
  const rbServiceRole = ensure(rbEnv.SUPABASE_SERVICE_ROLE_KEY, 'request_board/server/.env SUPABASE_SERVICE_ROLE_KEY');
  const rbAdmin = createClient(rbSupabaseUrl, rbServiceRole);

  const seed = Date.now();
  const fcPhone = digitsPhone(seed, 11);
  const designerPhone = digitsPhone(seed, 22);
  const password = `Rb${String(seed).slice(-6)}!aA`;
  const fcEmail = `tc_fc_${seed}@example.com`;
  const designerEmail = `tc_designer_${seed}@example.com`;

  const evidence = {
    generatedAt: nowIso(),
    scope: ['RB-03', 'RB-05'],
    users: {
      fcPhoneSuffix: fcPhone.slice(-4),
      designerPhoneSuffix: designerPhone.slice(-4),
    },
    steps: {},
    requests: {},
    cleanup: null,
  };

  const fcRegister = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: '/api/auth/register',
    body: {
      email: fcEmail,
      password,
      name: `TC_FC_${String(seed).slice(-4)}`,
      phone: fcPhone,
      role: 'fc',
    },
  });
  assertTrue(fcRegister.status === 201 && fcRegister.data?.success === true, 'FC register failed', {
    status: fcRegister.status,
    body: fcRegister.data,
  });
  const fcUserId = Number(fcRegister.data?.data?.user?.id);
  assertTrue(Number.isFinite(fcUserId), 'FC user id missing');
  evidence.steps.fcRegister = { status: fcRegister.status, at: nowIso() };

  const designerRegister = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: '/api/auth/register',
    body: {
      email: designerEmail,
      password,
      name: `TC_DESIGNER_${String(seed).slice(-4)}`,
      phone: designerPhone,
      role: 'designer',
      companyName: 'TC보험사',
    },
  });
  assertTrue(designerRegister.status === 201 && designerRegister.data?.success === true, 'Designer register failed', {
    status: designerRegister.status,
    body: designerRegister.data,
  });
  const designerUserId = Number(designerRegister.data?.data?.user?.id);
  assertTrue(Number.isFinite(designerUserId), 'Designer user id missing');
  evidence.steps.designerRegister = { status: designerRegister.status, at: nowIso() };

  const fcLogin = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: '/api/auth/login',
    body: { phone: fcPhone, password },
  });
  assertTrue(fcLogin.status === 200 && fcLogin.data?.success === true, 'FC login failed', {
    status: fcLogin.status,
    body: fcLogin.data,
  });
  const fcToken = fcLogin.data?.data?.token;
  assertTrue(typeof fcToken === 'string' && fcToken.length > 20, 'FC token missing');
  evidence.steps.fcLogin = { status: fcLogin.status, at: nowIso() };

  const designerLogin = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: '/api/auth/login',
    body: { phone: designerPhone, password },
  });
  assertTrue(designerLogin.status === 200 && designerLogin.data?.success === true, 'Designer login failed', {
    status: designerLogin.status,
    body: designerLogin.data,
  });
  const designerToken = designerLogin.data?.data?.token;
  assertTrue(typeof designerToken === 'string' && designerToken.length > 20, 'Designer token missing');
  evidence.steps.designerLogin = { status: designerLogin.status, at: nowIso() };

  const productsRes = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'GET',
    route: '/api/designers/products/list',
    token: fcToken,
  });
  assertTrue(productsRes.status === 200 && productsRes.data?.success === true, 'Products list failed', {
    status: productsRes.status,
    body: productsRes.data,
  });
  const productId = Number(productsRes.data?.data?.[0]?.id);
  assertTrue(Number.isFinite(productId), 'Product id missing');
  evidence.steps.productsList = { status: productsRes.status, productId, at: nowIso() };

  const designersRes = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'GET',
    route: '/api/designers?limit=200',
    token: fcToken,
  });
  assertTrue(designersRes.status === 200 && designersRes.data?.success === true, 'Designers list failed', {
    status: designersRes.status,
    body: designersRes.data,
  });
  const designers = Array.isArray(designersRes.data?.data) ? designersRes.data.data : [];
  const matchingDesigner = designers.find((d) => Number(d?.users?.id) === designerUserId);
  assertTrue(!!matchingDesigner, 'Registered designer not found in list', { designerUserId });
  const designerId = Number(matchingDesigner.id);
  assertTrue(Number.isFinite(designerId), 'Designer id missing');
  evidence.steps.designersList = { status: designersRes.status, designerId, at: nowIso() };

  async function createRequest(label) {
    const body = {
      customerName: `TC고객_${label}_${String(seed).slice(-4)}`,
      requestDetails: `TC의뢰_${label}`,
      productIds: [productId],
      designerIds: [designerId],
      designerCodeSelections: [
        { designerId, fcCodeName: `TC_${label}`, fcCodeValue: `CODE_${label}_${String(seed).slice(-4)}` },
      ],
      fcCodeName: `TC_${label}`,
      fcCodeValue: `CODE_${label}_${String(seed).slice(-4)}`,
    };
    const res = await apiCall({
      baseUrl: rbBaseUrl,
      method: 'POST',
      route: '/api/requests',
      token: fcToken,
      body,
    });
    assertTrue(res.status === 201 && res.data?.success === true, `Create request failed(${label})`, {
      status: res.status,
      body: res.data,
    });
    const requestId = Number(res.data?.data?.id);
    assertTrue(Number.isFinite(requestId), `Request id missing(${label})`);
    return requestId;
  }

  // RB-05: 설계매니저 거절
  const rejectRequestId = await createRequest('designer_reject');
  const designerReject = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${rejectRequestId}/designers/${designerId}/reject`,
    token: designerToken,
    body: { reason: 'TC_DESIGNER_REJECT' },
  });
  assertTrue(designerReject.status === 200 && designerReject.data?.success === true, 'Designer reject failed', {
    status: designerReject.status,
    body: designerReject.data,
  });

  // RB-03/RB-05: 설계매니저 수락 -> 완료 -> FC 승인
  const approveRequestId = await createRequest('fc_approve');
  const designerAccept1 = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${approveRequestId}/designers/${designerId}/accept`,
    token: designerToken,
  });
  assertTrue(designerAccept1.status === 200 && designerAccept1.data?.success === true, 'Designer accept(approve flow) failed', {
    status: designerAccept1.status,
    body: designerAccept1.data,
  });
  const designerComplete1 = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${approveRequestId}/designers/${designerId}/complete`,
    token: designerToken,
    body: {
      designUrl: 'https://example.com/design-approve.pdf',
      attachments: [
        {
          fileName: 'tc-approve.pdf',
          fileType: 'application/pdf',
          fileSize: 12345,
          fileUrl: 'https://example.com/tc-approve.pdf',
          description: 'TC approve attachment',
        },
      ],
    },
  });
  assertTrue(designerComplete1.status === 200 && designerComplete1.data?.success === true, 'Designer complete(approve flow) failed', {
    status: designerComplete1.status,
    body: designerComplete1.data,
  });
  const fcAccept = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${approveRequestId}/designers/${designerId}/fc-accept`,
    token: fcToken,
  });
  assertTrue(fcAccept.status === 200 && fcAccept.data?.success === true, 'FC accept failed', {
    status: fcAccept.status,
    body: fcAccept.data,
  });

  // RB-03/RB-05: 설계매니저 수락 -> 완료 -> FC 거절
  const fcRejectRequestId = await createRequest('fc_reject');
  const designerAccept2 = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${fcRejectRequestId}/designers/${designerId}/accept`,
    token: designerToken,
  });
  assertTrue(designerAccept2.status === 200 && designerAccept2.data?.success === true, 'Designer accept(reject flow) failed', {
    status: designerAccept2.status,
    body: designerAccept2.data,
  });
  const designerComplete2 = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${fcRejectRequestId}/designers/${designerId}/complete`,
    token: designerToken,
    body: {
      designUrl: 'https://example.com/design-reject.pdf',
      attachments: [
        {
          fileName: 'tc-reject.pdf',
          fileType: 'application/pdf',
          fileSize: 23456,
          fileUrl: 'https://example.com/tc-reject.pdf',
          description: 'TC reject attachment',
        },
      ],
    },
  });
  assertTrue(designerComplete2.status === 200 && designerComplete2.data?.success === true, 'Designer complete(reject flow) failed', {
    status: designerComplete2.status,
    body: designerComplete2.data,
  });
  const fcReject = await apiCall({
    baseUrl: rbBaseUrl,
    method: 'POST',
    route: `/api/requests/${fcRejectRequestId}/designers/${designerId}/fc-reject`,
    token: fcToken,
    body: { reason: 'TC_FC_REJECT' },
  });
  assertTrue(fcReject.status === 200 && fcReject.data?.success === true, 'FC reject failed', {
    status: fcReject.status,
    body: fcReject.data,
  });

  const requestIds = [rejectRequestId, approveRequestId, fcRejectRequestId];
  const { data: assignmentRows, error: assignmentError } = await rbAdmin
    .from('request_designers')
    .select('request_id,status,fc_decision')
    .in('request_id', requestIds)
    .eq('designer_id', designerId);
  assertTrue(!assignmentError, 'Assignment verification query failed', { error: assignmentError?.message });

  const assignmentByRequest = new Map((assignmentRows || []).map((row) => [Number(row.request_id), row]));
  const rejectedAssignment = assignmentByRequest.get(rejectRequestId);
  const approvedAssignment = assignmentByRequest.get(approveRequestId);
  const fcRejectedAssignment = assignmentByRequest.get(fcRejectRequestId);

  assertTrue(rejectedAssignment?.status === 'rejected', 'Designer reject status mismatch', { row: rejectedAssignment });
  assertTrue(approvedAssignment?.status === 'completed' && approvedAssignment?.fc_decision === 'accepted', 'FC approve status mismatch', { row: approvedAssignment });
  assertTrue(fcRejectedAssignment?.status === 'completed' && fcRejectedAssignment?.fc_decision === 'rejected', 'FC reject status mismatch', { row: fcRejectedAssignment });

  evidence.requests = {
    rejectFlow: {
      requestId: rejectRequestId,
      designerRejectStatus: designerReject.status,
      assignmentStatus: rejectedAssignment?.status ?? null,
    },
    fcApproveFlow: {
      requestId: approveRequestId,
      designerAcceptStatus: designerAccept1.status,
      designerCompleteStatus: designerComplete1.status,
      fcAcceptStatus: fcAccept.status,
      assignmentStatus: approvedAssignment?.status ?? null,
      fcDecision: approvedAssignment?.fc_decision ?? null,
    },
    fcRejectFlow: {
      requestId: fcRejectRequestId,
      designerAcceptStatus: designerAccept2.status,
      designerCompleteStatus: designerComplete2.status,
      fcRejectStatus: fcReject.status,
      assignmentStatus: fcRejectedAssignment?.status ?? null,
      fcDecision: fcRejectedAssignment?.fc_decision ?? null,
    },
  };

  const keepData = process.argv.includes('--keep-data');
  if (!keepData) {
    const userIds = [fcUserId, designerUserId];
    const { error: cleanupError } = await rbAdmin
      .from('users')
      .delete()
      .in('id', userIds);
    assertTrue(!cleanupError, 'Cleanup users failed', { error: cleanupError?.message });
    evidence.cleanup = { keepData: false, deletedUserCount: userIds.length, at: nowIso() };
  } else {
    evidence.cleanup = { keepData: true, at: nowIso() };
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const jsonPath = path.join(EVIDENCE_DIR, `designer-blocked-cli-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `designer-blocked-cli-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');

  const lines = [];
  lines.push('# Designer Blocked Case CLI Evidence');
  lines.push('');
  lines.push(`- generatedAt: ${evidence.generatedAt}`);
  lines.push(`- scope: ${evidence.scope.join(', ')}`);
  lines.push(`- fcPhoneSuffix: ${evidence.users.fcPhoneSuffix}`);
  lines.push(`- designerPhoneSuffix: ${evidence.users.designerPhoneSuffix}`);
  lines.push('');
  lines.push('## RB-05');
  lines.push(`- designer reject flow: requestId=${evidence.requests.rejectFlow.requestId}, status=${evidence.requests.rejectFlow.assignmentStatus}`);
  lines.push(`- designer accept+complete flow A: requestId=${evidence.requests.fcApproveFlow.requestId}, status=${evidence.requests.fcApproveFlow.assignmentStatus}`);
  lines.push(`- designer accept+complete flow B: requestId=${evidence.requests.fcRejectFlow.requestId}, status=${evidence.requests.fcRejectFlow.assignmentStatus}`);
  lines.push('');
  lines.push('## RB-03');
  lines.push(`- FC approve on completed design: fcDecision=${evidence.requests.fcApproveFlow.fcDecision}`);
  lines.push(`- FC reject on completed design: fcDecision=${evidence.requests.fcRejectFlow.fcDecision}`);
  lines.push('');
  lines.push('## Cleanup');
  lines.push(`- keepData: ${evidence.cleanup.keepData}`);
  if (!evidence.cleanup.keepData) {
    lines.push(`- deletedUserCount: ${evidence.cleanup.deletedUserCount}`);
  }
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
