import {
  EXAM_PAYMENT_PROOF_CAUTION,
  EXAM_PAYMENT_PROOF_MAX_BYTES,
  hasExamPaymentProof,
  normalizeExamPaymentProofSelection,
} from '@/lib/exam-payment-proof';

describe('exam payment proof', () => {
  it('normalizes a supported screenshot', () => {
    expect(
      normalizeExamPaymentProofSelection(
        {
          uri: 'file:///proof.png',
          fileName: 'deposit.png',
          mimeType: 'image/png',
          fileSize: 1024,
        },
        'request-1',
      ),
    ).toEqual({
      ok: true,
      value: {
        requestId: 'request-1',
        uri: 'file:///proof.png',
        fileName: 'deposit.png',
        mimeType: 'image/png',
        fileSize: 1024,
      },
    });
  });

  it('recovers a missing mime type from the file extension', () => {
    const result = normalizeExamPaymentProofSelection(
      {
        uri: 'file:///proof.JPG',
        fileName: 'proof.JPG',
        fileSize: 2048,
      },
      'request-2',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mimeType).toBe('image/jpeg');
    }
  });

  it('rejects unsupported and oversized files', () => {
    expect(
      normalizeExamPaymentProofSelection(
        {
          uri: 'file:///proof.gif',
          fileName: 'proof.gif',
          mimeType: 'image/gif',
          fileSize: 1024,
        },
        'request-3',
      ),
    ).toEqual({ ok: false, message: 'JPG, PNG 또는 WebP 사진만 첨부할 수 있습니다.' });

    expect(
      normalizeExamPaymentProofSelection(
        {
          uri: 'file:///proof.png',
          fileName: 'proof.png',
          mimeType: 'image/png',
          fileSize: EXAM_PAYMENT_PROOF_MAX_BYTES + 1,
        },
        'request-4',
      ),
    ).toEqual({ ok: false, message: '입금 내역 사진은 10MB 이하만 첨부할 수 있습니다.' });
  });

  it('accepts either a newly selected or already attached proof', () => {
    expect(hasExamPaymentProof({ selectedProof: null, existingProofAttached: false })).toBe(false);
    expect(hasExamPaymentProof({ selectedProof: null, existingProofAttached: true })).toBe(true);
    expect(
      hasExamPaymentProof({
        selectedProof: {
          requestId: 'request-5',
          uri: 'file:///proof.png',
          fileName: 'proof.png',
          mimeType: 'image/png',
          fileSize: 1024,
        },
        existingProofAttached: false,
      }),
    ).toBe(true);
  });

  it('keeps the requested caution copy exact', () => {
    expect(EXAM_PAYMENT_PROOF_CAUTION).toBe(
      '입금일과 증빙의 입금일이 다르면 신청할 수 없습니다.',
    );
  });
});
