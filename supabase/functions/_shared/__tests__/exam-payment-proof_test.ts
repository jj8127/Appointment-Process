import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExamPaymentProofStoragePath,
  getKoreanYmd,
  validateCancelExamApplication,
  validateDiscardExamPaymentProof,
  validatePrepareExamPaymentProof,
  validateSubmitExamPaymentProof,
} from '../exam-payment-proof.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
const fcId = '22222222-2222-4222-8222-222222222222';
const roundId = '33333333-3333-4333-8333-333333333333';
const locationId = '44444444-4444-4444-8444-444444444444';

test('validates bounded image metadata', () => {
  assert.deepEqual(
    validatePrepareExamPaymentProof({
      action: 'prepare',
      requestId,
      fileName: 'proof.png',
      mimeType: 'image/png',
      fileSize: 1024,
    }),
    {
      ok: true,
      value: {
        requestId,
        fileName: 'proof.png',
        mimeType: 'image/png',
        fileSize: 1024,
      },
    },
  );

  assert.equal(
    validatePrepareExamPaymentProof({
      action: 'prepare',
      requestId,
      fileName: 'proof.gif',
      mimeType: 'image/gif',
      fileSize: 1024,
    }).ok,
    false,
  );
});

test('validates submission selection and date', () => {
  assert.deepEqual(
    validateSubmitExamPaymentProof({
      action: 'submit',
      uploadId: requestId,
      roundId,
      locationId,
      examType: 'life',
      feePaidDate: '2026-07-23',
      isThirdExam: true,
    }),
    {
      ok: true,
      value: {
        uploadId: requestId,
        roundId,
        locationId,
        examType: 'life',
        feePaidDate: '2026-07-23',
        isThirdExam: true,
      },
    },
  );

  assert.equal(
    validateSubmitExamPaymentProof({
      action: 'submit',
      uploadId: null,
      roundId,
      locationId,
      examType: 'life',
      feePaidDate: '2026-02-30',
      isThirdExam: false,
    }).ok,
    false,
  );
});

test('builds an opaque FC-scoped storage path', () => {
  assert.equal(
    buildExamPaymentProofStoragePath({
      fcId,
      objectId: requestId,
      mimeType: 'image/jpeg',
    }),
    `fc/${fcId}/${requestId}.jpg`,
  );
});

test('validates discard identity and Korean calendar day', () => {
  assert.equal(validateDiscardExamPaymentProof({ action: 'discard', uploadId: requestId }).ok, true);
  assert.equal(
    validateCancelExamApplication({ action: 'cancel', registrationId: roundId }).ok,
    true,
  );
  assert.equal(
    getKoreanYmd(new Date('2026-07-22T15:30:00.000Z')),
    '2026-07-23',
  );
});
