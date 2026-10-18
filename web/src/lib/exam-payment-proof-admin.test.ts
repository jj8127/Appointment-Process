import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import * as examPaymentProofAdmin from './exam-payment-proof-admin.ts';
import {
  buildExamPaymentProofExportLinkMap,
  buildExamPaymentProofImagePath,
  EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS,
  parseExamPaymentProofExportLinks,
} from './exam-payment-proof-admin.ts';
import * as queryContract from './supabase-query-contract.ts';
import * as userIntentPolicy from './user-intent-policy.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const applicantApiSource = readFileSync(
  'web/src/app/api/admin/exam-applicants/route.ts',
  'utf8',
);
const imageApiSource = readFileSync(
  'web/src/app/api/admin/exam-applicants/[id]/payment-proof/route.ts',
  'utf8',
);
const exportApiSource = readFileSync(
  'web/src/app/api/admin/exam-applicants/payment-proof-export/route.ts',
  'utf8',
);
const listSource = readFileSync(
  'web/src/app/dashboard/exam/applicants/page.tsx',
  'utf8',
);
const detailSource = readFileSync(
  'web/src/app/dashboard/exam/applicants/[id]/page.tsx',
  'utf8',
);

function exportRouteHarness({
  proofData = [],
  signedData = [],
}: {
  proofData?: unknown;
  signedData?: unknown;
} = {}) {
  const loggerCalls: unknown[][] = [];
  const adminSupabase = {
    from(table: string) {
      assert.equal(table, 'exam_payment_proof_uploads');
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: proofData, error: null }).then(resolve);
        },
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, examPaymentProofAdmin.EXAM_PAYMENT_PROOF_BUCKET);
        return {
          createSignedUrls: async () => ({ data: signedData, error: null }),
        };
      },
    },
  };
  const code = ts.transpileModule(exportApiSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (request: Request) => Promise<unknown>> = {};
  vm.runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === 'next/server') {
        return {
          NextResponse: {
            json: (body: unknown, options?: { status?: number; headers?: unknown }) => ({
              status: options?.status ?? 200,
              body,
              headers: options?.headers,
            }),
          },
        };
      }
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/csrf') return { checkRateLimit: () => ({ allowed: true }), SECURITY_HEADERS: {} };
      if (id === '@/lib/exam-payment-proof-admin') return examPaymentProofAdmin;
      if (id === '@/lib/logger') return { logger: { error: (...args: unknown[]) => loggerCalls.push(args) } };
      if (id === '@/lib/server-session') {
        return {
          getVerifiedReadOnlyAdminSession: async () => ({
            ok: true,
            session: { residentDigits: '01011112222' },
          }),
        };
      }
      if (id === '@/lib/supabase-query-contract') return queryContract;
      if (id === '@/lib/user-intent-policy') return userIntentPolicy;
      throw new Error(`Missing payment-proof export mock: ${id}`);
    },
  });

  return {
    loggerCalls,
    request: () => exports.POST(new Request('https://example.invalid/api/admin/exam-applicants/payment-proof-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationIds: ['11111111-1111-4111-8111-111111111111'] }),
    })) as Promise<{ status: number; body: unknown }>,
  };
}

test('payment-proof helper builds an encoded authenticated image route', () => {
  assert.equal(
    buildExamPaymentProofImagePath('registration id'),
    '/api/admin/exam-applicants/registration%20id/payment-proof',
  );
  assert.equal(EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS, 30 * 24 * 60 * 60);
});

test('export link lookup remains keyed by registration', () => {
  const lookup = buildExamPaymentProofExportLinkMap([
    {
      registrationId: 'registration-1',
      storagePath: 'registrations/registration-1/proof.jpg',
      signedUrl: 'https://storage.example.test/signed',
    },
  ]);

  assert.equal(lookup.get('registration-1')?.storagePath, 'registrations/registration-1/proof.jpg');
});

test('payment-proof export links accept only credential-free HTTPS URLs', () => {
  const baseLink = {
    registrationId: 'registration-1',
    storagePath: 'registrations/registration-1/proof.jpg',
    signedUrl: 'https://storage.example.test/signed',
  };
  assert.deepStrictEqual(parseExamPaymentProofExportLinks([baseLink]), [baseLink]);
  assert.deepStrictEqual(
    parseExamPaymentProofExportLinks([baseLink], ['registration-1']),
    [baseLink],
  );
  assert.equal(
    parseExamPaymentProofExportLinks([
      baseLink,
      { ...baseLink, signedUrl: 'https://storage.example.test/duplicate' },
    ], ['registration-1', 'registration-2']),
    null,
  );
  assert.equal(
    parseExamPaymentProofExportLinks([
      baseLink,
      { ...baseLink, registrationId: 'registration-3' },
    ], ['registration-1', 'registration-2']),
    null,
  );

  for (const signedUrl of [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/signed',
    'https://user:secret@storage.example.test/signed',
  ]) {
    assert.equal(parseExamPaymentProofExportLinks([{ ...baseLink, signedUrl }]), null);
  }
});

test('ordinary applicant reads expose only proof presence', () => {
  assert.match(applicantApiSource, /payment_proof_attached/);
  assert.doesNotMatch(applicantApiSource, /storage_path/);
  assert.doesNotMatch(applicantApiSource, /signedUrl/);
});

test('admin and manager image viewing streams the current private proof', () => {
  assert.match(imageApiSource, /getVerifiedReadOnlyAdminSession/);
  assert.match(imageApiSource, /\.eq\('status', 'attached'\)/);
  assert.match(imageApiSource, /\.from\(EXAM_PAYMENT_PROOF_BUCKET\)[\s\S]+\.download\(/);
  assert.match(imageApiSource, /Cache-Control': 'private, no-store, max-age=0'/);
  assert.doesNotMatch(imageApiSource, /createSignedUrl|getPublicUrl/);
  assert.doesNotMatch(imageApiSource, /logger\.error\([\s\S]{0,200}registrationId/);
});

test('export issues session-free signed links only after staff authorization', () => {
  assert.match(exportApiSource, /getVerifiedReadOnlyAdminSession/);
  assert.match(exportApiSource, /EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS/);
  assert.match(exportApiSource, /\.createSignedUrls\(/);
  assert.doesNotMatch(exportApiSource, /getPublicUrl/);
});

test('payment-proof export rejects malformed successful row and signed-url arrays', async () => {
  const validProofRows = [{
    registration_id: '11111111-1111-4111-8111-111111111111',
    storage_path: 'registrations/11111111-1111-4111-8111-111111111111/proof.jpg',
  }];

  for (const proofData of [null, { unexpected: true }]) {
    const harness = exportRouteHarness({ proofData });
    const response = await harness.request();
    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(response.body),
      JSON.stringify({ error: '입금 증빙 링크를 발급하지 못했습니다.' }),
    );
    assert.equal(harness.loggerCalls.length, 1);
  }

  for (const proofData of [
    [{ registration_id: 'not-a-uuid', storage_path: validProofRows[0].storage_path }],
    [{ ...validProofRows[0], registration_id: '22222222-2222-4222-8222-222222222222' }],
    [{ ...validProofRows[0], storage_path: '' }],
    [validProofRows[0], { ...validProofRows[0], storage_path: 'another/path.jpg' }],
    [validProofRows[0], { ...validProofRows[0], registration_id: '22222222-2222-4222-8222-222222222222' }],
  ]) {
    const harness = exportRouteHarness({ proofData });
    const response = await harness.request();
    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(response.body),
      JSON.stringify({ error: '입금 증빙 링크를 발급하지 못했습니다.' }),
    );
  }

  for (const signedData of [null, { unexpected: true }]) {
    const harness = exportRouteHarness({ proofData: validProofRows, signedData });
    const response = await harness.request();
    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(response.body),
      JSON.stringify({ error: '입금 증빙 링크를 발급하지 못했습니다.' }),
    );
    assert.equal(harness.loggerCalls.length, 1);
  }


  for (const signedData of [
    [],
    [
      { path: validProofRows[0].storage_path, signedUrl: 'https://storage.example.test/signed' },
      { path: validProofRows[0].storage_path, signedUrl: 'https://storage.example.test/duplicate' },
    ],
    [{ path: 'unexpected/path.jpg', signedUrl: 'https://storage.example.test/signed' }],
  ]) {
    const harness = exportRouteHarness({ proofData: validProofRows, signedData });
    const response = await harness.request();
    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(response.body),
      JSON.stringify({ error: '입금 증빙 링크를 발급하지 못했습니다.' }),
    );
  }

  for (const signedUrl of [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/signed',
    'https://user:secret@storage.example.test/signed',
  ]) {
    const harness = exportRouteHarness({
      proofData: validProofRows,
      signedData: [{ path: validProofRows[0].storage_path, signedUrl }],
    });
    const response = await harness.request();
    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(response.body),
      JSON.stringify({ error: '입금 증빙 링크를 발급하지 못했습니다.' }),
    );
  }
});

test('canonical list and detail expose proof without a review workflow', () => {
  assert.match(listSource, /입금 증빙 경로/);
  assert.match(listSource, /입금 증빙 URL \(30일 유효\)/);
  assert.match(listSource, /renderHeader\('입금 증빙', 'payment_proof'/);
  assert.match(detailSource, /<Title order=\{4\} c=\{CHARCOAL\}>입금 증빙 확인<\/Title>/);
  assert.match(detailSource, /buildExamPaymentProofImagePath\(registrationId\)/);
  assert.doesNotMatch(`${listSource}\n${detailSource}`, /증빙 승인|증빙 거절|OCR|날짜 일치/);

  const rightColumnIndex = detailSource.indexOf('<Grid.Col span={{ base: 12, lg: 4 }}>');
  const proofCardPlacementIndex = detailSource.indexOf('<PaymentProofCard');
  const receptionActionIndex = detailSource.indexOf('<Box mt="auto">', rightColumnIndex);
  assert.ok(
    rightColumnIndex >= 0
      && proofCardPlacementIndex > rightColumnIndex
      && receptionActionIndex > proofCardPlacementIndex,
  );
});
