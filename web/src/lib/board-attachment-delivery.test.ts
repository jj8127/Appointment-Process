import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverBoardAttachments,
  type BoardAttachmentDeliveryDeps,
  type BoardAttachmentFile,
} from './board-attachment-delivery.ts';

type Source = { name: string };

const files: BoardAttachmentFile<Source>[] = [
  {
    source: { name: 'safe.pdf' },
    fileName: 'safe.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
    fileType: 'file',
  },
];

test('web attachment retry reconciles the same finalize manifest without duplicating rows', async () => {
  let signCalls = 0;
  let uploadCalls = 0;
  let finalizeCalls = 0;
  let reconcileCalls = 0;
  const deps: BoardAttachmentDeliveryDeps<Source> = {
    sign: async () => {
      signCalls += 1;
      return [
        { storagePath: 'board/post/same_safe.pdf', signedUrl: 'https://upload.invalid/signed' },
      ];
    },
    upload: async () => {
      uploadCalls += 1;
    },
    finalize: async () => {
      finalizeCalls += 1;
      throw new Error('response_lost_after_commit');
    },
    areFinalized: async () => {
      reconcileCalls += 1;
      if (reconcileCalls === 1) throw new Error('temporary_read_failure');
      return true;
    },
  };

  const first = await deliverBoardAttachments(files, null, deps);
  assert.equal(first.complete, false);
  assert.equal(first.manifest?.phase, 'finalize');

  const retry = await deliverBoardAttachments(files, first.manifest, deps);
  assert.deepEqual(retry, { complete: true, manifest: null });
  assert.equal(signCalls, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(finalizeCalls, 1);
});

test('web attachment retry refreshes an expired URL for the exact same storage path', async () => {
  const signInputs: unknown[] = [];
  const deps: BoardAttachmentDeliveryDeps<Source> = {
    sign: async (input) => {
      signInputs.push(input);
      return [
        {
          storagePath: 'board/post/same_safe.pdf',
          signedUrl: `https://upload.invalid/signed-${signInputs.length}`,
        },
      ];
    },
    upload: async () => {
      throw new Error('upload_unconfirmed');
    },
    finalize: async () => {
      throw new Error('storage_object_not_ready');
    },
    areFinalized: async () => false,
  };

  const first = await deliverBoardAttachments(files, null, deps);
  const retry = await deliverBoardAttachments(files, first.manifest, deps);

  assert.equal(retry.manifest?.files[0].storagePath, 'board/post/same_safe.pdf');
  assert.equal(signInputs.length, 2);
  assert.deepEqual(signInputs[1], [
    {
      storagePath: 'board/post/same_safe.pdf',
      fileName: 'safe.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      fileType: 'file',
    },
  ]);
});
