import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateHanwhaPdfPayload,
} from './admin-hanwha-pdf-payload.ts';

test('requires fileName only when creating a Hanwha PDF upload URL', () => {
  assert.deepEqual(
    validateHanwhaPdfPayload('createHanwhaPdfUploadUrl', {
      fcId: 'fc-1',
      fileName: 'dawichok.pdf',
    }),
    { ok: true, fcId: 'fc-1', fileName: 'dawichok.pdf' },
  );

  assert.deepEqual(
    validateHanwhaPdfPayload('createHanwhaPdfUploadUrl', {
      fcId: 'fc-1',
    }),
    { ok: false, error: 'fcId and fileName are required' },
  );
});

test('allows deleting an existing Hanwha PDF with only fcId', () => {
  assert.deepEqual(
    validateHanwhaPdfPayload('deleteHanwhaPdf', {
      fcId: 'fc-1',
    }),
    { ok: true, fcId: 'fc-1' },
  );
});
