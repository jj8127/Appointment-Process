import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildExamPaymentProofExportLinkMap,
  buildExamPaymentProofImagePath,
  EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS,
} from './exam-payment-proof-admin.ts';

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

test('canonical list and detail expose proof without a review workflow', () => {
  assert.match(listSource, /입금 증빙 경로/);
  assert.match(listSource, /입금 증빙 URL \(30일 유효\)/);
  assert.match(listSource, /renderHeader\('입금 증빙', 'payment_proof'/);
  assert.match(detailSource, /<Title order=\{4\} c=\{CHARCOAL\}>입금 증빙 확인<\/Title>/);
  assert.match(detailSource, /buildExamPaymentProofImagePath\(registrationId\)/);
  assert.doesNotMatch(`${listSource}\n${detailSource}`, /증빙 승인|증빙 거절|OCR|날짜 일치/);

  const examInfoIndex = detailSource.indexOf('>시험 신청 정보<');
  const proofCardPlacementIndex = detailSource.indexOf('<PaymentProofCard');
  assert.ok(examInfoIndex >= 0 && proofCardPlacementIndex > examInfoIndex);
});
