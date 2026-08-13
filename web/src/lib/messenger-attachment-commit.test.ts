import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateMessengerAttachmentCommitResponse } from './messenger-attachment-commit.ts';

const VALID_COMMIT = {
  batchId: '7d493f2e-21c9-4c86-b94b-43c875555001',
  replayed: false,
};

test('accepts attachment send success only with a valid commit, file message, and exact count', () => {
  assert.deepEqual(
    validateMessengerAttachmentCommitResponse({
      attachmentCommit: VALID_COMMIT,
      message: {
        message_type: 'file',
        attachments: [{ id: 'one' }, { id: 'two' }],
      },
      expectedAttachmentCount: 2,
    }),
    VALID_COMMIT,
  );
});

test('rejects missing or malformed attachment commit proof', () => {
  for (const attachmentCommit of [
    null,
    {},
    { batchId: 'not-a-uuid', replayed: false },
    { batchId: VALID_COMMIT.batchId, replayed: 'false' },
  ]) {
    assert.equal(
      validateMessengerAttachmentCommitResponse({
        attachmentCommit,
        message: { message_type: 'file', attachments: [{ id: 'one' }] },
        expectedAttachmentCount: 1,
      }),
      null,
    );
  }
});

test('rejects non-file messages and attachment count mismatches', () => {
  assert.equal(
    validateMessengerAttachmentCommitResponse({
      attachmentCommit: VALID_COMMIT,
      message: { message_type: 'text', attachments: [{ id: 'one' }] },
      expectedAttachmentCount: 1,
    }),
    null,
  );
  assert.equal(
    validateMessengerAttachmentCommitResponse({
      attachmentCommit: VALID_COMMIT,
      message: { message_type: 'file', attachments: [{ id: 'one' }] },
      expectedAttachmentCount: 2,
    }),
    null,
  );
});

test('direct and group web send paths enforce commit proof before accepting attachment responses', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const directPages = [
    'src/app/chat/page.tsx',
    'src/app/dashboard/chat/page.tsx',
  ];
  for (const relativePath of directPages) {
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /validateMessengerAttachmentCommitResponse\(\{/);
    assert.match(source, /attachmentCommit: payload\?\.data\?\.attachmentCommit/);
    assert.match(source, /expectedAttachmentCount: attachmentDelivery\.batch\.files\.length/);
  }

  const groupClient = readFileSync(path.join(root, 'src/lib/group-chat-client.ts'), 'utf8');
  assert.match(groupClient, /validateMessengerAttachmentCommitResponse\(\{/);
  assert.match(groupClient, /attachmentCommit: result\.attachmentCommit/);
  assert.match(groupClient, /expectedAttachmentCount: input\.attachmentIntentIds\.length/);
});
