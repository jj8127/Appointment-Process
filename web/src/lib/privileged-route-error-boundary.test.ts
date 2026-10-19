import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import * as queryContract from './supabase-query-contract.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const groupChatSource = readFileSync('web/src/app/api/group-chat/route.ts', 'utf8');
const fcDeleteSource = readFileSync('web/src/app/api/fc-delete/route.ts', 'utf8');
const examApplicantsSource = readFileSync('web/src/app/api/admin/exam-applicants/route.ts', 'utf8');
const appointmentActionSource = readFileSync('web/src/app/dashboard/appointment/actions.ts', 'utf8');
const docsActionSource = readFileSync('web/src/app/dashboard/docs/actions.ts', 'utf8');
const examScheduleActionSource = readFileSync('web/src/app/dashboard/exam/schedule/actions.ts', 'utf8');
const examSchedulePageSource = readFileSync('web/src/app/dashboard/exam/schedule/page.tsx', 'utf8');
const noticeActionSource = readFileSync('web/src/app/dashboard/notifications/actions.ts', 'utf8');

function examScheduleHarness(data: unknown) {
  const loggerCalls: unknown[][] = [];
  const query = {
    select() { return query; },
    order() { return query; },
    range() { return query; },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  const code = ts.transpileModule(examScheduleActionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  vm.runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === '@/lib/admin-supabase') {
        return {
          adminSupabase: {
            from: (table: string) => {
              assert.equal(table, 'exam_rounds');
              return query;
            },
            functions: { invoke: async () => ({ data: null, error: null }) },
            rpc: async () => ({ data: null, error: null }),
          },
        };
      }
      if (id === '@/lib/exam-round-notification') return { buildExamRoundNotificationPayload: () => ({}) };
      if (id === '@/lib/logger') {
        return {
          logger: {
            warn: (...args: unknown[]) => loggerCalls.push(args),
            error: (...args: unknown[]) => loggerCalls.push(args),
          },
        };
      }
      if (id === '@/lib/notification-delivery-feedback') {
        return {
          getNotificationDeliveryFeedback: () => ({ severity: 'error' }),
          parseNotificationDeliveryFeedback: () => null,
        };
      }
      if (id === '@/lib/privileged-action-input-policy') {
        return {
          parseExamRoundDeleteInput: () => ({ ok: false, error: 'unused' }),
          parseExamRoundSaveInput: () => ({ ok: false, error: 'unused' }),
        };
      }
      if (id === '@/lib/server-session') {
        return {
          getVerifiedAdminSession: async () => ({ ok: false, status: 401, error: 'unused' }),
          getVerifiedReadOnlyAdminSession: async () => ({
            ok: true,
            session: { role: 'admin', residentDigits: '01011112222' },
          }),
        };
      }
      if (id === '@/lib/supabase-query-contract') return queryContract;
      if (id === '@/lib/user-intent-policy') {
        return {
          requireExamRoundDeleteReceipt: () => undefined,
          requireExamRoundSaveReceipt: (value: unknown) => value,
        };
      }
      throw new Error(`Missing exam schedule mock: ${id}`);
    },
  });
  return {
    loggerCalls,
    fetch: exports.fetchExamRoundsAction,
  };
}

test('privileged proxy and RPC routes keep internal error messages server-side', () => {
  assert.match(groupChatSource, /serverError\(error, 'api\/group-chat', SECURITY_HEADERS\)/);
  assert.doesNotMatch(groupChatSource, /message: error instanceof Error \? error\.message/);
  assert.match(groupChatSource, /getVerifiedServerSession[\s\S]*if \(!supabaseUrl \|\| !serviceKey\)[\s\S]*code: 'service_unavailable'[\s\S]*}, 503\)/);
  assert.doesNotMatch(groupChatSource, /missing_group_chat_config|Missing Supabase group chat configuration/);

  // FC deletion is delegated to admin-action (which retires the GaramLink account first); only its own message is relayed.
  assert.match(fcDeleteSource, /functions\/v1\/admin-action/);
  assert.match(fcDeleteSource, /action: 'deleteFc'/);
  assert.doesNotMatch(fcDeleteSource, /\{ error: error\.message/);

  assert.match(examApplicantsSource, /if \(error\) throw error;[\s\S]*if \(!data\?\.id\) return null/);
  assert.match(examApplicantsSource, /serverError\(error, 'api\/admin\/exam-applicants transition', SECURITY_HEADERS\)/);
  assert.match(examApplicantsSource, /serverError\(error, 'api\/admin\/exam-applicants cancellation', SECURITY_HEADERS\)/);
  assert.doesNotMatch(examApplicantsSource, /NextResponse\.json\(\{ error: error\.message \}/);
});

test('privileged server actions return stable messages instead of database details', () => {
  for (const source of [appointmentActionSource, docsActionSource, noticeActionSource]) {
    assert.doesNotMatch(source, /return \{ success: false, (?:error|message):[^\n}]*\.message/);
  }
  assert.doesNotMatch(examScheduleActionSource, /if \(err instanceof Error && err\.message\)/);
  assert.match(examScheduleActionSource, /return '저장 중 오류가 발생했습니다\.'/);
  assert.match(examScheduleActionSource, /return \{ success: false, error: '시험 일정 조회 실패' \}/);
});

test('exam schedule reads reject malformed successful rows instead of synthesizing empty data', async () => {
  const validRound = {
    id: 'round-1',
    exam_date: null,
    exam_month: '2026-11-01',
    registration_deadline: '2026-10-20',
    round_label: '11월 1차',
    exam_type: 'life',
    notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
    exam_locations: [],
  };
  const validHarness = examScheduleHarness([validRound]);
  const validResult = await validHarness.fetch();
  assert.equal(JSON.stringify(validResult), JSON.stringify({
    success: true,
    data: [{
      id: validRound.id,
      exam_date: validRound.exam_date,
      exam_month: validRound.exam_month,
      registration_deadline: validRound.registration_deadline,
      round_label: validRound.round_label,
      exam_type: validRound.exam_type,
      created_at: validRound.created_at,
      locations: [],
    }],
  }));

  const malformedPayloads = [
    null,
    { unexpected: true },
    [{ ...validRound, exam_locations: null }],
    [{ ...validRound, exam_locations: { unexpected: true } }],
    [{ ...validRound, exam_locations: undefined }],
    [{ ...validRound, exam_locations: [{ location_name: '서울' }] }],
  ];
  for (const data of malformedPayloads) {
    const harness = examScheduleHarness(data);
    const result = await harness.fetch();
    assert.equal(JSON.stringify(result), JSON.stringify({ success: false, error: '시험 일정 조회 실패' }));
    assert.equal(harness.loggerCalls.length, 1);
  }

  assert.match(examSchedulePageSource, /!result\.success \|\| !Array\.isArray\(result\.data\)/);
  assert.doesNotMatch(examSchedulePageSource, /return \(result\.data \?\? \[\]\)/);
});
