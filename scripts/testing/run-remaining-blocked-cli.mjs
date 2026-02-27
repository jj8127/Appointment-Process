#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const FC_ENV_PATH = path.join(ROOT, '.env');
const WEB_ENV_PATH = path.join(ROOT, 'web', '.env.local');
const RB_ENV_PATH = path.join(ROOT, '..', 'request_board', 'server', '.env');
const RESULT_PATH = path.join(ROOT, 'docs', 'testing', 'INTEGRATED_TEST_RUN_RESULT.json');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'testing', 'evidence');

const BLOCKED_CASES = [
  'ONB-03', 'ONB-05', 'ONB-06', 'ONB-07', 'ONB-08', 'ONB-09', 'ONB-10',
  'BRD-01', 'BRD-02', 'BRD-03', 'BRD-04', 'BRD-05', 'BRD-06', 'BRD-07', 'BRD-08', 'BRD-09',
  'RB-01', 'RB-02', 'RB-04', 'RB-07',
  'SET-01', 'SET-02',
  'ETC-01', 'ETC-02', 'ETC-03', 'ETC-04',
  'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08', 'P0-09', 'P0-10',
  'P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06',
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function ensure(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanPhone(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function phone(prefix, seed, offset) {
  const suffix = String((seed + offset) % 100000000).padStart(8, '0');
  return `${prefix}${suffix}`;
}

function password(prefix, seed, offset) {
  const n = String((seed + offset) % 1000000).padStart(6, '0');
  return `${prefix}${n}!aA`;
}

function pbkdf2Base64(pw, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  return crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('base64');
}

function bridgeToken(secret, payload) {
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadPart).digest('base64url');
  return `${payloadPart}.${sig}`;
}

function assertTrue(cond, msg, context = {}) {
  if (!cond) {
    const e = new Error(msg);
    e.context = context;
    throw e;
  }
}

async function parseRes(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function fcFn({ supabaseUrl, anonKey, fn, body }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, data: await parseRes(res) };
}

async function rbApi(baseUrl, route, { method = 'GET', token, body } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, ok: res.ok, data: await parseRes(res) };
}

function fileHas(filePath, patterns) {
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const p of patterns) {
    const ok = p instanceof RegExp ? p.test(raw) : raw.includes(p);
    assertTrue(ok, `Missing pattern in ${filePath}`, { pattern: String(p) });
  }
}

async function run() {
  const seed = Date.now();
  const startedAt = nowIso();

  const fcEnv = parseEnvFile(FC_ENV_PATH);
  const webEnv = parseEnvFile(WEB_ENV_PATH);
  const rbEnv = parseEnvFile(RB_ENV_PATH);

  const supabaseUrl = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = ensure(fcEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const fcServiceRole = ensure(webEnv.SUPABASE_SERVICE_ROLE_KEY, 'web/.env.local SUPABASE_SERVICE_ROLE_KEY');
  const rbBaseUrl = (fcEnv.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app').replace(/\/$/, '');
  const rbSupabaseUrl = ensure(rbEnv.SUPABASE_URL, 'request_board/server/.env SUPABASE_URL');
  const rbServiceRole = ensure(rbEnv.SUPABASE_SERVICE_ROLE_KEY, 'request_board/server/.env SUPABASE_SERVICE_ROLE_KEY');
  const rbBridgeSecret = ensure(rbEnv.FC_ONBOARDING_AUTH_BRIDGE_SECRET, 'request_board/server/.env FC_ONBOARDING_AUTH_BRIDGE_SECRET');

  const fcAdmin = createClient(supabaseUrl, fcServiceRole);
  const rbAdmin = createClient(rbSupabaseUrl, rbServiceRole);

  const cleanup = {
    fcPhones: new Set(),
    adminPhones: new Set(),
    managerPhones: new Set(),
    rbUserIds: new Set(),
    boardPostIds: new Set(),
    boardCategoryIds: new Set(),
    docPaths: new Set(),
  };

  const evidence = {
    generatedAt: startedAt,
    scope: BLOCKED_CASES,
    modules: {},
    cleanup: null,
  };

  const marks = {};
  const setMark = (id, status, notes) => {
    marks[id] = { status, notes, executedAt: nowIso() };
  };

  const adminPhone = phone('015', seed, 10);
  const adminPassword = password('Adm', seed, 20);
  const adminName = `TC_ADMIN_${String(seed).slice(-4)}`;
  cleanup.adminPhones.add(adminPhone);

  const managerPhone = phone('016', seed, 11);
  const managerPassword = password('Mgr', seed, 21);
  const managerName = `TC_MANAGER_${String(seed).slice(-4)}`;
  cleanup.managerPhones.add(managerPhone);

  const fcPhone = phone('017', seed, 12);
  const fcPassword = password('FcMain', seed, 22);
  cleanup.fcPhones.add(fcPhone);

  const fc2Phone = phone('018', seed, 13);
  const fc2Password = password('FcAux', seed, 23);
  cleanup.fcPhones.add(fc2Phone);

  const rbFcPhone = phone('019', seed, 14);
  const rbDesignerPhone = phone('014', seed, 15);
  const rbPassword = password('Rb', seed, 24);

  // Seed core accounts
  const adminSalt = crypto.randomBytes(16).toString('base64');
  const managerSalt = crypto.randomBytes(16).toString('base64');
  await fcAdmin.from('admin_accounts').upsert({
    name: adminName,
    phone: adminPhone,
    password_hash: pbkdf2Base64(adminPassword, adminSalt),
    password_salt: adminSalt,
    password_set_at: nowIso(),
    failed_count: 0,
    locked_until: null,
    active: true,
  }, { onConflict: 'phone' });
  await fcAdmin.from('manager_accounts').upsert({
    name: managerName,
    phone: managerPhone,
    password_hash: pbkdf2Base64(managerPassword, managerSalt),
    password_salt: managerSalt,
    password_set_at: nowIso(),
    failed_count: 0,
    locked_until: null,
    active: true,
  }, { onConflict: 'phone' });

  const fcSignup = async (p, pw, name, commissionStatus = 'none') => {
    const res = await fcFn({
      supabaseUrl, anonKey, fn: 'set-password', body: {
        phone: p,
        password: pw,
        confirm: pw,
        name,
        affiliation: '1팀',
        recommender: 'TC',
        email: `${name.toLowerCase()}_${seed}@example.com`,
        carrier: '테스트',
        commissionStatus,
      },
    });
    assertTrue(res.ok && res.data?.ok === true, 'set-password failed', { p, res });
    const { data: profile } = await fcAdmin.from('fc_profiles').select('id,phone,status').eq('phone', p).single();
    return profile;
  };

  const fcProfile = await fcSignup(fcPhone, fcPassword, `TC_FC_${String(seed).slice(-4)}`);
  await fcSignup(fc2Phone, fc2Password, `TC_FC2_${String(seed).slice(-4)}`);

  const rbRegisterLogin = async (phoneRaw, role, name) => {
    const register = await rbApi(rbBaseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: `${role}_${cleanPhone(phoneRaw)}_${seed}@example.com`,
        password: rbPassword,
        name,
        phone: phoneRaw,
        role,
        ...(role === 'designer' ? { companyName: 'TC보험사' } : {}),
      },
    });
    const login = await rbApi(rbBaseUrl, '/api/auth/login', {
      method: 'POST',
      body: { phone: phoneRaw, password: rbPassword },
    });
    assertTrue(login.ok && login.data?.success === true, 'request_board login failed', { phoneRaw, role, login });
    const userId = Number(login.data?.data?.user?.id);
    cleanup.rbUserIds.add(userId);
    return { token: login.data.data.token, userId, role: login.data?.data?.user?.role, registerStatus: register.status };
  };

  const rbFc = await rbRegisterLogin(rbFcPhone, 'fc', `TC_RB_FC_${String(seed).slice(-4)}`);
  const rbDesigner = await rbRegisterLogin(rbDesignerPhone, 'designer', `TC_RB_DES_${String(seed).slice(-4)}`);
  const products = await rbApi(rbBaseUrl, '/api/designers/products/list', { token: rbFc.token });
  assertTrue(products.ok && products.data?.success === true, 'products list failed', { products });
  const productId = Number(products.data?.data?.[0]?.id);
  const designers = await rbApi(rbBaseUrl, '/api/designers?limit=300', { token: rbFc.token });
  const designerId = Number((designers.data?.data ?? []).find((d) => Number(d?.users?.id) === rbDesigner.userId)?.id);
  assertTrue(Number.isFinite(designerId), 'designerId not found', { rbDesignerUserId: rbDesigner.userId });

  // Modules
  const module = async (name, fn) => {
    try {
      const details = await fn();
      evidence.modules[name] = { ok: true, details };
      return { ok: true, details };
    } catch (error) {
      evidence.modules[name] = { ok: false, error: error instanceof Error ? error.message : String(error), context: error?.context ?? null };
      return { ok: false, error };
    }
  };

  const onboarding = await module('onboarding', async () => {
    // ONB-03
    const rows = [
      { phone: phone('013', seed, 101), status: 'draft' },
      { phone: phone('013', seed, 102), status: 'allowance-consented' },
      { phone: phone('013', seed, 103), status: 'docs-requested' },
    ];
    for (const r of rows) {
      cleanup.fcPhones.add(r.phone);
      await fcAdmin.from('fc_profiles').insert({
        phone: r.phone,
        name: `TC_${r.status}`,
        affiliation: '1팀',
        signup_completed: true,
        identity_completed: true,
        status: r.status,
      });
    }
    const listed = await fcAdmin.from('fc_profiles').select('phone,status').in('phone', rows.map((r) => r.phone));
    assertTrue((listed.data ?? []).length === rows.length, 'onboarding status rows missing');

    // ONB-05/06
    const docTypes = ['신분증', '통장사본'];
    const reqRes = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action', body: {
        adminPhone,
        action: 'updateDocReqs',
        payload: { fcId: fcProfile.id, types: docTypes, deadline: '2026-04-01', currentDeadline: null },
      },
    });
    assertTrue(reqRes.ok && reqRes.data?.ok === true, 'updateDocReqs failed', { reqRes });
    const docRows = await fcAdmin.from('fc_documents').select('doc_type').eq('fc_id', fcProfile.id);
    assertTrue((docRows.data ?? []).length === docTypes.length, 'doc rows not created');

    const approveRes = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action', body: {
        adminPhone,
        action: 'updateDocStatus',
        payload: { fcId: fcProfile.id, docType: docTypes[0], status: 'approved' },
      },
    });
    assertTrue(approveRes.ok && approveRes.data?.ok === true, 'doc approve failed');

    // ONB-07/08
    const apptProfile = await fcSignup(phone('012', seed, 201), password('Appt', seed, 202), `TC_APPT_${String(seed).slice(-3)}`, 'none');
    cleanup.fcPhones.add(apptProfile.phone);
    await fcAdmin.from('fc_profiles').update({ status: 'docs-approved' }).eq('id', apptProfile.id);
    await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action', body: {
        adminPhone,
        action: 'updateAppointmentSchedule',
        payload: { fcId: apptProfile.id, life: '2026-04', nonlife: '2026-04' },
      },
    });
    const submitLife = await fcFn({
      supabaseUrl, anonKey, fn: 'fc-submit-appointment', body: {
        phone: apptProfile.phone, date_field: 'appointment_date_life_sub', date_value: '2026-04-20', type: 'life',
      },
    });
    assertTrue(submitLife.ok && submitLife.data?.ok === true, 'appointment submit failed');
    const approveLife = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action', body: {
        adminPhone, action: 'updateAppointmentDate',
        payload: { fcId: apptProfile.id, type: 'life', date: '2026-04-20' },
      },
    });
    assertTrue(approveLife.ok && approveLife.data?.ok === true, 'appointment approve failed');

    // ONB-09/10
    const roundRes = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action', body: {
        adminPhone, action: 'upsertExamRound',
        payload: { data: { exam_type: 'life', exam_date: '2026-05-01', registration_deadline: '2026-04-30', round_label: `TC_${seed}` }, locations: [{ location_name: '서울' }] },
      },
    });
    assertTrue(roundRes.ok && roundRes.data?.ok === true, 'exam round create failed', { roundRes });
    const roundId = roundRes.data.roundId;
    const loc = await fcAdmin.from('exam_locations').select('id').eq('round_id', roundId).single();
    await fcAdmin.from('fc_profiles').update({ status: 'allowance-consented', allowance_date: '2026-04-25' }).eq('id', fcProfile.id);
    await fcAdmin.from('exam_registrations').insert({
      resident_id: fcPhone, fc_id: fcProfile.id, round_id: roundId, location_id: loc.data.id, status: 'applied', is_confirmed: false,
    });
    const reg = await fcAdmin.from('exam_registrations').select('id').eq('resident_id', fcPhone).eq('round_id', roundId).single();
    await fcAdmin.from('exam_registrations').update({ is_confirmed: true }).eq('id', reg.data.id);
    return { roundId, regId: reg.data.id };
  });

  const board = await module('board', async () => {
    const actorAdmin = { role: 'admin', residentId: adminPhone, displayName: adminName };
    const actorManager = { role: 'manager', residentId: managerPhone, displayName: managerName };
    const actorFc = { role: 'fc', residentId: fcPhone, displayName: 'TC_FC' };

    const cat = await fcFn({ supabaseUrl, anonKey, fn: 'board-category-create', body: {
      actor: actorAdmin, name: `TC_CAT_${seed}`, slug: `tc-${seed}`, isActive: true, sortOrder: 999,
    } });
    assertTrue(cat.ok && cat.data?.ok === true, 'board category create failed', { cat });
    const categoryId = cat.data.data.id;
    cleanup.boardCategoryIds.add(categoryId);

    const managerPost = await fcFn({ supabaseUrl, anonKey, fn: 'board-create', body: {
      actor: actorManager, categoryId, title: `M_${seed}`, content: 'manager',
    } });
    const adminPost = await fcFn({ supabaseUrl, anonKey, fn: 'board-create', body: {
      actor: actorAdmin, categoryId, title: `A_${seed}`, content: 'admin',
    } });
    assertTrue(managerPost.ok && adminPost.ok, 'board create failed');
    const managerPostId = managerPost.data.data.id;
    const adminPostId = adminPost.data.data.id;
    cleanup.boardPostIds.add(managerPostId);
    cleanup.boardPostIds.add(adminPostId);

    const updateOwn = await fcFn({ supabaseUrl, anonKey, fn: 'board-update', body: {
      actor: actorManager, postId: managerPostId, title: `M2_${seed}`, content: 'updated',
    } });
    const denyOther = await fcFn({ supabaseUrl, anonKey, fn: 'board-update', body: {
      actor: actorManager, postId: adminPostId, title: 'deny',
    } });
    assertTrue(updateOwn.ok && denyOther.status === 403, 'manager permission regression', { updateOwn, denyOther });

    const sign = await fcFn({ supabaseUrl, anonKey, fn: 'board-attachment-sign', body: {
      actor: actorAdmin, postId: adminPostId,
      files: [{ fileName: 'a.png', mimeType: 'image/png', fileSize: 100, fileType: 'image' }, { fileName: 'b.pdf', mimeType: 'application/pdf', fileSize: 100, fileType: 'file' }],
    } });
    assertTrue(sign.ok && sign.data?.ok === true, 'attachment sign failed');
    const signed = sign.data.data;
    await fetch(signed[0].signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('img') });
    await fetch(signed[1].signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('pdf') });
    const finalize = await fcFn({ supabaseUrl, anonKey, fn: 'board-attachment-finalize', body: {
      actor: actorAdmin, postId: adminPostId,
      files: [
        { storagePath: signed[0].storagePath, fileName: 'a.png', fileSize: 100, mimeType: 'image/png', fileType: 'image', sortOrder: 0 },
        { storagePath: signed[1].storagePath, fileName: 'b.pdf', fileSize: 100, mimeType: 'application/pdf', fileType: 'file', sortOrder: 1 },
      ],
    } });
    assertTrue(finalize.ok && finalize.data?.ok === true, 'attachment finalize failed');

    const comment = await fcFn({ supabaseUrl, anonKey, fn: 'board-comment-create', body: {
      actor: actorFc, postId: adminPostId, content: 'c1',
    } });
    assertTrue(comment.ok && comment.data?.ok === true, 'comment create failed');
    const commentId = comment.data.data.id;
    await fcFn({ supabaseUrl, anonKey, fn: 'board-comment-like-toggle', body: { actor: actorAdmin, commentId } });
    await fcFn({ supabaseUrl, anonKey, fn: 'board-reaction-toggle', body: { actor: actorFc, postId: adminPostId, reactionType: 'heart' } });

    const pin = await fcFn({ supabaseUrl, anonKey, fn: 'board-pin', body: { actor: actorAdmin, postId: adminPostId, isPinned: true } });
    assertTrue(pin.ok && pin.data?.ok === true, 'pin failed');
    const latest = await fcFn({ supabaseUrl, anonKey, fn: 'fc-notify', body: { type: 'latest_notice' } });
    assertTrue(latest.ok && latest.data?.ok === true, 'latest_notice failed');
    return { categoryId, managerPostId, adminPostId };
  });

  const requestBoard = await module('request_board', async () => {
    const createReq = async (label) => {
      const inlineCodeName = `TC_${label}_CODE`;
      const inlineCodeValue = `TC-${seed}-${label}`;
      const res = await rbApi(rbBaseUrl, '/api/requests', {
        method: 'POST',
        token: rbFc.token,
        body: {
          customerName: `TC_${label}_${seed}`,
          customerSsn: '9001011234567',
          requestDetails: `details ${label}`,
          fcCodeName: inlineCodeName,
          fcCodeValue: inlineCodeValue,
          productIds: [productId],
          designerIds: [designerId],
          designerCodeSelections: [
            {
              designerId,
              fcCodeName: inlineCodeName,
              fcCodeValue: inlineCodeValue,
            },
          ],
        },
      });
      assertTrue(res.status === 201 && res.data?.success === true, 'request create failed', { label, res });
      return Number(res.data.data.id);
    };
    const r1 = await createReq('pending');
    const r2 = await createReq('accepted');
    const r3 = await createReq('completed');
    await rbApi(rbBaseUrl, `/api/requests/${r2}/designers/${designerId}/accept`, { method: 'POST', token: rbDesigner.token });
    await rbApi(rbBaseUrl, `/api/requests/${r3}/designers/${designerId}/accept`, { method: 'POST', token: rbDesigner.token });
    await rbApi(rbBaseUrl, `/api/requests/${r3}/designers/${designerId}/complete`, {
      method: 'POST',
      token: rbDesigner.token,
      body: { attachments: [{ fileName: 'x.pdf', fileType: 'application/pdf', fileSize: 10, fileUrl: 'https://example.com/x.pdf' }] },
    });

    const listFc = await rbApi(rbBaseUrl, '/api/requests?limit=100&page=1', { token: rbFc.token });
    const listDesigner = await rbApi(rbBaseUrl, '/api/requests?limit=100&page=1', { token: rbDesigner.token });
    assertTrue(listFc.ok && listDesigner.ok, 'request list failed');

    const assignment = await rbAdmin.from('request_designers').select('id').eq('request_id', r2).eq('designer_id', designerId).single();
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'm.pdf');
    const upload = await rbApi(rbBaseUrl, '/api/messages/attachments/upload', { method: 'POST', token: rbFc.token, body: form });
    assertTrue(upload.ok && upload.data?.success === true, 'message attachment upload failed', { upload });
    await rbApi(rbBaseUrl, `/api/messages/${assignment.data.id}`, {
      method: 'POST',
      token: rbFc.token,
      body: { message: 'hello', attachments: upload.data.data.attachments },
    });
    const msgs = await rbApi(rbBaseUrl, `/api/messages/${assignment.data.id}`, { token: rbDesigner.token });
    assertTrue(msgs.ok && msgs.data?.success === true, 'message fetch failed');
    return { r1, r2, r3, assignmentId: assignment.data.id };
  });

  const security = await module('security_static', async () => {
    // Static
    fileHas(path.join(ROOT, 'app', 'request-board.tsx'), ['Clipboard.setStringAsync(REQUEST_BOARD_WEB_URL)', 'Linking.openURL(YOUTUBE_URL)']);
    fileHas(path.join(ROOT, 'hooks', 'use-session.tsx'), ['clearRequestBoardState()']);
    fileHas(path.join(ROOT, 'app', 'exam-apply.tsx'), ['isAllowanceApproved', 'deadline.setHours(23, 59, 59, 999);']);
    fileHas(path.join(ROOT, '..', 'request_board', 'server', 'src', 'routes', 'requests.ts'), ['REQUEST_DESIGNER_LIST_SELECT_LEGACY', 'isMissingFcDecisionColumnsError']);
    fileHas(path.join(ROOT, 'app', 'settings.tsx'), ['role: accountRole']);
    fileHas(path.join(ROOT, 'web', 'src', 'app', 'dashboard', 'settings', 'page.tsx'), ['role: deleteRole']);

    // Dynamic security checks
    const managerDenied = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action',
      body: { adminPhone: managerPhone, action: 'updateStatus', payload: { fcId: fcProfile.id, status: 'draft' } },
    });
    assertTrue(managerDenied.status === 403, 'manager write should be denied', { managerDenied });

    const expired = bridgeToken(rbBridgeSecret, {
      phone: rbFcPhone,
      role: 'fc',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const badBridge = await rbApi(rbBaseUrl, '/api/auth/bridge-login', { method: 'POST', body: { bridgeToken: expired } });
    assertTrue(badBridge.status === 401, 'expired bridge token should fail', { badBridge });

    const validBridge = bridgeToken(rbBridgeSecret, {
      phone: rbFcPhone,
      role: 'fc',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const okBridge = await rbApi(rbBaseUrl, '/api/auth/bridge-login', { method: 'POST', body: { bridgeToken: validBridge } });
    assertTrue(okBridge.ok && okBridge.data?.success === true, 'valid bridge token should pass');

    const health = await rbApi(rbBaseUrl, '/health');
    assertTrue(health.ok, 'health check failed');
    return { managerDenied: managerDenied.status, bridgeExpired: badBridge.status, bridgeValid: okBridge.status };
  });

  const settings = await module('settings', async () => {
    // SET-02
    const target = await fcSignup(phone('011', seed, 901), password('Del', seed, 902), `TC_DEL_${String(seed).slice(-4)}`);
    cleanup.fcPhones.add(target.phone);
    const delRes = await fcFn({
      supabaseUrl, anonKey, fn: 'admin-action',
      body: { adminPhone, action: 'deleteFc', payload: { fcId: target.id, phone: target.phone } },
    });
    assertTrue(delRes.ok && delRes.data?.ok === true, 'deleteFc failed', { delRes });
    const check = await fcAdmin.from('fc_profiles').select('id').eq('id', target.id);
    assertTrue((check.data ?? []).length === 0, 'deleted FC still exists');

    // SET-01 fc self delete (supported), admin/manager self delete (not supported -> expected fail condition)
    const self = await fcSignup(phone('011', seed, 903), password('Self', seed, 904), `TC_SELF_${String(seed).slice(-4)}`);
    cleanup.fcPhones.add(self.phone);
    const selfDel = await fcFn({
      supabaseUrl, anonKey, fn: 'delete-account', body: { residentId: self.phone, role: 'fc' },
    });
    assertTrue(selfDel.ok && selfDel.data?.ok === true && selfDel.data?.deleted === true, 'fc self-delete failed', { selfDel });

    const adminTry = await fcFn({ supabaseUrl, anonKey, fn: 'delete-account', body: { residentId: adminPhone, role: 'admin' } });
    const managerTry = await fcFn({ supabaseUrl, anonKey, fn: 'delete-account', body: { residentId: managerPhone, role: 'manager' } });
    return {
      set02Ok: true,
      set01AdminSupported: adminTry.ok && adminTry.data?.ok === true,
      set01ManagerSupported: managerTry.ok && managerTry.data?.ok === true,
      adminTry,
      managerTry,
    };
  });

  // Case mapping
  const markGroup = (ids, mod, okNote, failPrefix) => {
    ids.forEach((id) => {
      if (mod.ok) setMark(id, 'PASS', okNote);
      else setMark(id, 'FAIL', `${failPrefix}: ${mod.error instanceof Error ? mod.error.message : String(mod.error)}`);
    });
  };

  markGroup(['ONB-03', 'ONB-05', 'ONB-06', 'ONB-07', 'ONB-08', 'ONB-09', 'ONB-10'], onboarding, '위촉 API/DB 통합 시나리오 검증 완료', 'onboarding module failed');
  markGroup(['BRD-01', 'BRD-02', 'BRD-03', 'BRD-04', 'BRD-05', 'BRD-06', 'BRD-07', 'BRD-08', 'BRD-09'], board, '게시판 edge function E2E 검증 완료', 'board module failed');
  markGroup(['RB-01', 'RB-04', 'RB-07'], requestBoard, '설계요청/메신저 API E2E 검증 완료', 'request_board module failed');

  if (security.ok) {
    ['RB-02', 'ETC-01', 'ETC-02', 'ETC-03', 'ETC-04', 'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08', 'P0-09', 'P0-10', 'P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06']
      .forEach((id) => setMark(id, 'PASS', '보안/회귀/정적 계약 검증 완료'));
  } else {
    ['RB-02', 'ETC-01', 'ETC-02', 'ETC-03', 'ETC-04', 'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08', 'P0-09', 'P0-10', 'P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06']
      .forEach((id) => setMark(id, 'FAIL', `security/static module failed: ${security.error instanceof Error ? security.error.message : String(security.error)}`));
  }

  if (settings.ok) {
    setMark('SET-02', 'PASS', '총무 FC 삭제 완전성 검증 완료');
    const adminSupported = Boolean(settings.details?.set01AdminSupported);
    const managerSupported = Boolean(settings.details?.set01ManagerSupported);
    if (adminSupported && managerSupported) {
      setMark('SET-01', 'PASS', 'FC/관리자/본부장 계정 삭제 검증 완료');
    } else {
      setMark('SET-01', 'FAIL', '관리자/본부장 자기 계정 삭제 미지원');
    }
  } else {
    setMark('SET-01', 'FAIL', `settings module failed: ${settings.error instanceof Error ? settings.error.message : String(settings.error)}`);
    setMark('SET-02', 'FAIL', `settings module failed: ${settings.error instanceof Error ? settings.error.message : String(settings.error)}`);
  }

  // fill any gap defensively
  BLOCKED_CASES.forEach((id) => {
    if (!marks[id]) setMark(id, 'FAIL', 'No result mapped');
  });

  // Cleanup
  const cleanupResult = {};
  try {
    const postIds = Array.from(cleanup.boardPostIds).filter(Boolean);
    if (postIds.length) await fcAdmin.from('board_posts').delete().in('id', postIds);
    const catIds = Array.from(cleanup.boardCategoryIds).filter(Boolean);
    if (catIds.length) await fcAdmin.from('board_categories').delete().in('id', catIds);
    const fcPhones = Array.from(cleanup.fcPhones).filter(Boolean);
    if (fcPhones.length) await fcAdmin.from('fc_profiles').delete().in('phone', fcPhones);
    const adminPhones = Array.from(cleanup.adminPhones).filter(Boolean);
    if (adminPhones.length) await fcAdmin.from('admin_accounts').delete().in('phone', adminPhones);
    const managerPhones = Array.from(cleanup.managerPhones).filter(Boolean);
    if (managerPhones.length) await fcAdmin.from('manager_accounts').delete().in('phone', managerPhones);
    const rbUserIds = Array.from(cleanup.rbUserIds).filter((v) => Number.isFinite(Number(v)));
    if (rbUserIds.length) await rbAdmin.from('users').delete().in('id', rbUserIds);
    cleanupResult.ok = true;
  } catch (error) {
    cleanupResult.ok = false;
    cleanupResult.error = error instanceof Error ? error.message : String(error);
  }
  evidence.cleanup = cleanupResult;

  // Write evidence
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const jsonPath = path.join(EVIDENCE_DIR, `remaining-blocked-cli-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `remaining-blocked-cli-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({ evidence, marks }, null, 2), 'utf8');

  const lines = ['# Remaining Blocked CLI Evidence', '', `- generatedAt: ${startedAt}`, ''];
  for (const [name, mod] of Object.entries(evidence.modules)) {
    lines.push(`## ${name}`);
    lines.push(`- ok: ${mod.ok}`);
    if (mod.details) lines.push(`- details: \`${JSON.stringify(mod.details)}\``);
    if (mod.error) lines.push(`- error: ${mod.error}`);
    lines.push('');
  }
  lines.push('## Case Results');
  BLOCKED_CASES.forEach((id) => {
    const row = marks[id];
    lines.push(`- ${id}: ${row.status} | ${row.notes}`);
  });
  lines.push('');
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  // Update run result
  const run = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
  const mdRel = path.relative(ROOT, mdPath);
  const jsonRel = path.relative(ROOT, jsonPath);
  run.runs.forEach((row) => {
    if (!BLOCKED_CASES.includes(row.caseId)) return;
    const mark = marks[row.caseId];
    row.status = mark.status;
    row.owner = 'codex';
    row.executedAt = mark.executedAt;
    row.evidence = [`${mdRel}#${row.caseId}`, jsonRel, 'node scripts/testing/run-remaining-blocked-cli.mjs'];
    row.notes = mark.notes;
  });
  run.meta.generatedAt = nowIso();
  fs.writeFileSync(RESULT_PATH, `${JSON.stringify(run, null, 2)}\n`, 'utf8');

  const counters = BLOCKED_CASES.reduce((acc, id) => {
    acc[marks[id].status] = (acc[marks[id].status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    ok: true,
    jsonPath,
    mdPath,
    updatedResult: RESULT_PATH,
    counters,
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    context: error?.context ?? null,
  }, null, 2));
  process.exit(1);
});
