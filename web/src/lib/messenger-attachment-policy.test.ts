import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_MESSENGER_ATTACHMENT_BYTES,
  MESSENGER_ATTACHMENT_ERROR_COPY,
  validateMessengerAttachmentSelection,
} from './messenger-attachment-policy.ts';
import { normalizeMessengerAttachmentProxyPayload } from './messenger-attachment-proxy.ts';

const UUIDS = [
  '7d493f2e-21c9-4c86-b94b-43c875555001',
  '7d493f2e-21c9-4c86-b94b-43c875555002',
] as const;
const SHA = 'a'.repeat(64);

test('accepts 20MiB and rejects 20MiB plus one byte with exact copy', () => {
  assert.equal(
    validateMessengerAttachmentSelection([
      { name: '한글 계약서.pdf', size: MAX_MESSENGER_ATTACHMENT_BYTES, type: 'application/pdf' },
    ]).ok,
    true,
  );
  assert.deepEqual(
    validateMessengerAttachmentSelection([
      { name: '한글 계약서.pdf', size: MAX_MESSENGER_ATTACHMENT_BYTES + 1, type: 'application/pdf' },
    ]),
    { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.tooLarge },
  );
});

test('enforces ten cumulative files across reselection', () => {
  const file = { name: '자료.txt', size: 1, type: 'text/plain' };
  assert.equal(validateMessengerAttachmentSelection(Array(10).fill(file)).ok, true);
  assert.deepEqual(
    validateMessengerAttachmentSelection([file], 10),
    { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.tooMany },
  );
  assert.equal(validateMessengerAttachmentSelection(Array(4).fill(file), 6).ok, true);
});

test('rejects ZIP, HWP, HWPX, SVG, executables, and MIME spoofing', () => {
  for (const name of ['archive.zip', '문서.hwp', '문서.hwpx', 'vector.svg', 'run.exe']) {
    assert.deepEqual(
      validateMessengerAttachmentSelection([{ name, size: 10 }]),
      { ok: false, error: MESSENGER_ATTACHMENT_ERROR_COPY.unsupported },
    );
  }
  assert.equal(
    validateMessengerAttachmentSelection([
      { name: 'renamed.pdf', size: 10, type: 'application/x-msdownload' },
    ]).ok,
    false,
  );
});

test('proxy preserves Korean names and strips non-contract fields', () => {
  assert.deepEqual(normalizeMessengerAttachmentProxyPayload({
    type: 'upload_intents_create',
    context: { kind: 'direct', conversationId: UUIDS[0], forged: 'drop' },
    deliveryKey: UUIDS[1],
    payloadFingerprint: SHA,
    files: [{
      clientFileId: UUIDS[0],
      name: '한글 계약서.pdf',
      size: 123,
      mimeType: 'application/pdf',
      sha256: SHA,
      signedUrl: 'must-not-forward',
      path: 'must-not-forward',
      token: 'must-not-forward',
    }],
  }), {
    ok: true,
    payload: {
      type: 'upload_intents_create',
      context: { kind: 'direct', conversationId: UUIDS[0] },
      deliveryKey: UUIDS[1],
      payloadFingerprint: SHA,
      files: [{
        clientFileId: UUIDS[0],
        name: '한글 계약서.pdf',
        size: 123,
        mimeType: 'application/pdf',
        sha256: SHA,
      }],
    },
  });
});

test('browser uploads bytes with uploadToSignedUrl and Next proxy never parses multipart bodies', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const client = readFileSync(path.join(root, 'src/lib/messenger-attachment-client.ts'), 'utf8');
  const route = readFileSync(path.join(root, 'src/app/api/messenger-attachments/route.ts'), 'utf8');

  assert.match(client, /\.uploadToSignedUrl\(/);
  assert.match(client, /upload_intents_create/);
  assert.match(client, /response\.state === 'committed'/);
  assert.doesNotMatch(route, /formData\(|arrayBuffer\(|blob\(/);
  assert.doesNotMatch(route, /signedUrl|storage_path|serviceRole/);
});
