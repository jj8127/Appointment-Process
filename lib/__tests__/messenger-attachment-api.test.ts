import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockInvoke = jest.fn();
const mockUploadToSignedUrl = jest.fn();
const mockStorageFrom = jest.fn(() => ({
  uploadToSignedUrl: mockUploadToSignedUrl,
}));

jest.mock('expo-crypto', () => {
  const { createHash: createNodeHash } = jest.requireActual('node:crypto');
  let uuidSequence = 1;
  const hash = (value: ArrayBuffer | ArrayBufferView | string) => {
    const bytes = typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Buffer.from(value);
    const result = createNodeHash('sha256').update(bytes).digest();
    return result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    );
  };
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: jest.fn(async (_algorithm: string, value: ArrayBufferView) =>
      hash(value)
    ),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createNodeHash('sha256').update(value, 'utf8').digest('hex')
    ),
    randomUUID: jest.fn(() => {
      const suffix = String(uuidSequence).padStart(12, '0');
      uuidSequence += 1;
      return `10000000-0000-4000-8000-${suffix}`;
    }),
  };
});

jest.mock('expo-file-system', () => ({
  File: class MockExpoFile {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    async bytes() {
      if (this.uri.startsWith('size:')) {
        return new Uint8Array(Number(this.uri.slice('size:'.length)));
      }
      return Uint8Array.from(Buffer.from(this.uri, 'utf8'));
    }
  },
}));

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(async () => 'app-session-token'),
}));

jest.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    storage: { from: mockStorageFrom },
  },
}));

// eslint-disable-next-line import/first
import {
  appendMessengerAttachmentCandidates,
  createMessengerAttachmentDownloadUrl,
  createMessengerAttachmentPreviewUrl,
  MessengerAttachmentCommitUncertainError,
  MAX_MESSENGER_ATTACHMENT_BYTES,
  prepareMessengerAttachmentBatch,
  sendMessengerAttachmentBatch,
  uploadMessengerAttachmentBatch,
} from '../messenger-attachment-api';

const CONVERSATION_A = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_B = '22222222-2222-4222-8222-222222222222';
const DELIVERY_KEY = '33333333-3333-4333-8333-333333333333';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const MESSAGE_ID = '66666666-6666-4666-8666-666666666666';

describe('native messenger attachment API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockUploadToSignedUrl.mockReset();
    mockStorageFrom.mockClear();
  });

  async function recoveryFixture() {
    const files = await appendMessengerAttachmentCandidates([], [{ uri: 'fixture', name: 'fixture.txt', mimeType: 'text/plain' }]);
    const batch = await prepareMessengerAttachmentBatch({ files, context: { kind: 'group', roomId: CONVERSATION_A }, content: '', deliveryKey: DELIVERY_KEY });
    const pending = { data: {
      ok: true, state: 'pending', deliveryKey: batch.deliveryKey, payloadFingerprint: batch.payloadFingerprint,
      expiresAt: '2030-01-01T00:00:00Z', intents: [{ id: INTENT_ID, clientFileId: files[0].clientFileId, order: 0,
        upload: { bucket: 'messenger-attachments-v2', path: 'fixture', token: 'fixture', signedUrl: 'https://example.invalid/fixture' } }],
    }, error: null };
    const committed = { data: {
      ok: true, state: 'committed', deliveryKey: batch.deliveryKey, payloadFingerprint: batch.payloadFingerprint,
      expiresAt: null, intents: [], committed: { batchId: BATCH_ID, messageIds: [MESSAGE_ID] },
    }, error: null };
    mockUploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
    return { batch, pending, committed };
  }

  test('recovers a lost commit response without uploading or sending a duplicate', async () => {
    const { batch, pending, committed } = await recoveryFixture();
    mockInvoke.mockResolvedValueOnce(pending).mockResolvedValueOnce(committed);
    const commit = jest.fn().mockRejectedValue(new Error('response lost'));
    await expect(sendMessengerAttachmentBatch(batch, commit)).resolves.toEqual({ state: 'committed' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([INTENT_ID]);
    expect(mockUploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[1][1].body).toEqual(mockInvoke.mock.calls[0][1].body);
  });

  test('never resends when the same delivery key is already committed', async () => {
    const { batch, committed } = await recoveryFixture();
    mockInvoke.mockResolvedValueOnce(committed);
    const commit = jest.fn();
    await expect(sendMessengerAttachmentBatch(batch, commit)).resolves.toEqual({ state: 'committed' });
    expect(commit).not.toHaveBeenCalled();
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  test('reports an unresolved commit honestly when recovery is still pending', async () => {
    const { batch, pending } = await recoveryFixture();
    mockInvoke.mockResolvedValue(pending);
    const commit = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(sendMessengerAttachmentBatch(batch, commit)).rejects.toBeInstanceOf(MessengerAttachmentCommitUncertainError);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mockUploadToSignedUrl).toHaveBeenCalledTimes(1);
  });

  test('does not report an upload failure as an unknown message commit', async () => {
    const { batch, pending } = await recoveryFixture();
    mockInvoke.mockResolvedValue(pending);
    mockUploadToSignedUrl.mockResolvedValue({ error: { statusCode: 500 } });
    const commit = jest.fn();
    await expect(sendMessengerAttachmentBatch(batch, commit)).rejects.toMatchObject({ code: 'attachment_upload_failed' });
    expect(commit).not.toHaveBeenCalled();
  });

  test.each([400, 401, 403, 409, 410, 413, 415, 422])('preserves an explicit server rejection (%s)', async (status) => {
    const { batch, pending } = await recoveryFixture();
    mockInvoke.mockResolvedValue(pending);
    const error = Object.assign(new Error('attachment rejected'), { status });
    await expect(sendMessengerAttachmentBatch(batch, jest.fn().mockRejectedValue(error))).rejects.toBe(error);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test('keeps the commit unknown if its recovery check also fails', async () => {
    const { batch, pending } = await recoveryFixture();
    mockInvoke.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('offline'));
    await expect(sendMessengerAttachmentBatch(batch, jest.fn().mockRejectedValue(new Error('offline'))))
      .rejects.toBeInstanceOf(MessengerAttachmentCommitUncertainError);
  });

  test('keeps picker cancel and exact reselection cumulative without duplicate ids', async () => {
    const decomposedKoreanName = '계약서.txt';
    const candidate = {
      uri: 'same-file-bytes',
      name: decomposedKoreanName,
      mimeType: 'text/plain',
    };
    const selected = await appendMessengerAttachmentCandidates([], [candidate]);
    const afterCancel = await appendMessengerAttachmentCandidates(selected, []);
    const afterReselection = await appendMessengerAttachmentCandidates(
      afterCancel,
      [candidate],
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].name).toBe('계약서.txt');
    expect(afterCancel[0].clientFileId).toBe(selected[0].clientFileId);
    expect(afterReselection).toHaveLength(1);
    expect(afterReselection[0].clientFileId).toBe(selected[0].clientFileId);
  });

  test('accepts the 20MiB boundary and rejects larger or forbidden families', async () => {
    await expect(appendMessengerAttachmentCandidates([], [{
      uri: `size:${MAX_MESSENGER_ATTACHMENT_BYTES}`,
      name: 'boundary.pdf',
      size: MAX_MESSENGER_ATTACHMENT_BYTES,
      mimeType: 'application/pdf',
    }])).resolves.toHaveLength(1);

    await expect(appendMessengerAttachmentCandidates([], [{
      uri: 'not-read',
      name: 'too-large.pdf',
      size: MAX_MESSENGER_ATTACHMENT_BYTES + 1,
      mimeType: 'application/pdf',
    }])).rejects.toThrow('20MiB');

    for (const name of [
      'archive.zip',
      '문서.hwp',
      '문서.hwpx',
      'vector.svg',
      'run.exe',
    ]) {
      await expect(appendMessengerAttachmentCandidates([], [{
        uri: name,
        name,
      }])).rejects.toThrow('지원하지 않는');
    }
    await expect(appendMessengerAttachmentCandidates([], [{
      uri: 'spoofed',
      name: 'renamed.pdf',
      mimeType: 'application/x-msdownload',
    }])).rejects.toThrow('지원하지 않는');
  });

  test('accepts every configured image, Office, PDF, and TXT family', async () => {
    const allowed = [
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
      ['bmp', 'image/bmp'],
      ['heic', 'image/heic'],
      ['heif', 'image/heif'],
      ['pdf', 'application/pdf'],
      ['doc', 'application/msword'],
      ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['xls', 'application/vnd.ms-excel'],
      ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['ppt', 'application/vnd.ms-powerpoint'],
      ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      ['txt', 'text/plain'],
    ] as const;
    for (const [extension, mimeType] of allowed) {
      await expect(appendMessengerAttachmentCandidates([], [{
        uri: `bytes-${extension}`,
        name: `파일.${extension}`,
        mimeType,
      }])).resolves.toMatchObject([{ mimeType }]);
    }
  });

  test('uses the exact canonical fingerprint and sorted broadcast context', async () => {
    const files = await appendMessengerAttachmentCandidates([], [{
      uri: 'payload',
      name: '안내.txt',
      mimeType: 'text/plain',
    }]);
    const batch = await prepareMessengerAttachmentBatch({
      files,
      context: {
        kind: 'direct_broadcast',
        conversationIds: [CONVERSATION_B, CONVERSATION_A],
      },
      content: '  공지\r\n본문  ',
      deliveryKey: DELIVERY_KEY,
    });
    const canonical = {
      version: 1,
      context: {
        kind: 'direct_broadcast',
        conversationIds: [CONVERSATION_A, CONVERSATION_B],
      },
      content: '공지\n본문',
      files: files.map((file, order) => ({
        order,
        clientFileId: file.clientFileId,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        sha256: file.sha256,
      })),
    };
    const expected = createHash('sha256')
      .update(JSON.stringify(canonical), 'utf8')
      .digest('hex');

    expect(batch.context).toEqual(canonical.context);
    expect(batch.content).toBe('공지\n본문');
    expect(batch.payloadFingerprint).toBe(expected);
  });

  test('replays the same intent after response loss and accepts only exact 409 already-exists', async () => {
    const files = await appendMessengerAttachmentCandidates([], [{
      uri: 'upload-body',
      name: '계약서.pdf',
      mimeType: 'application/pdf',
    }]);
    const batch = await prepareMessengerAttachmentBatch({
      files,
      context: { kind: 'direct', conversationId: CONVERSATION_A },
      content: '',
      deliveryKey: DELIVERY_KEY,
    });
    const pendingResponse = {
      ok: true,
      state: 'pending',
      deliveryKey: batch.deliveryKey,
      payloadFingerprint: batch.payloadFingerprint,
      expiresAt: '2026-07-25T12:00:00.000Z',
      intents: [{
        id: INTENT_ID,
        clientFileId: files[0].clientFileId,
        order: 0,
        upload: {
          bucket: 'messenger-attachments-v2',
          path: 'opaque/private/path',
          token: 'opaque-upload-token',
          signedUrl: 'https://example.invalid/storage/v1/object/upload/sign/path',
        },
      }],
    };
    mockInvoke
      .mockResolvedValueOnce({ data: pendingResponse, error: null })
      .mockResolvedValueOnce({ data: pendingResponse, error: null });
    mockUploadToSignedUrl
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: 500, message: 'network response lost' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: 409, message: 'Asset Already Exists' },
      });

    await expect(uploadMessengerAttachmentBatch(batch)).resolves.toEqual({
      state: 'uploaded',
      intentIds: [INTENT_ID],
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][1].body).toEqual(
      mockInvoke.mock.calls[1][1].body,
    );
    expect(mockUploadToSignedUrl).toHaveBeenLastCalledWith(
      'opaque/private/path',
      'opaque-upload-token',
      expect.any(Uint8Array),
      { contentType: 'application/pdf', upsert: false },
    );
  });

  test('committed replay refresh path never uploads again', async () => {
    const files = await appendMessengerAttachmentCandidates([], [{
      uri: 'already-committed',
      name: '완료.txt',
      mimeType: 'text/plain',
    }]);
    const batch = await prepareMessengerAttachmentBatch({
      files,
      context: { kind: 'group', roomId: CONVERSATION_A },
      content: '',
      deliveryKey: DELIVERY_KEY,
    });
    mockInvoke.mockResolvedValue({
      data: {
        ok: true,
        state: 'committed',
        deliveryKey: batch.deliveryKey,
        payloadFingerprint: batch.payloadFingerprint,
        expiresAt: null,
        intents: [],
        committed: {
          batchId: BATCH_ID,
          messageIds: [MESSAGE_ID],
        },
      },
      error: null,
    });

    await expect(uploadMessengerAttachmentBatch(batch)).resolves.toEqual({
      state: 'committed',
      messageIds: [MESSAGE_ID],
    });
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  test('renews an expired pending generation with the same delivery key', async () => {
    const files = await appendMessengerAttachmentCandidates([], [{
      uri: 'renew-me',
      name: '갱신.txt',
      mimeType: 'text/plain',
    }]);
    const batch = await prepareMessengerAttachmentBatch({
      files,
      context: { kind: 'direct', conversationId: CONVERSATION_A },
      content: '',
      deliveryKey: DELIVERY_KEY,
    });
    const nextIntentId = '77777777-7777-4777-8777-777777777777';
    const responseFor = (id: string, path: string) => ({
      ok: true,
      state: 'pending',
      deliveryKey: batch.deliveryKey,
      payloadFingerprint: batch.payloadFingerprint,
      expiresAt: '2026-07-25T12:00:00.000Z',
      intents: [{
        id,
        clientFileId: files[0].clientFileId,
        order: 0,
        upload: {
          bucket: 'messenger-attachments-v2',
          path,
          token: `token-${id}`,
          signedUrl: `https://example.invalid/storage/v1/object/upload/sign/${id}`,
        },
      }],
    });
    mockInvoke
      .mockResolvedValueOnce({
        data: responseFor(INTENT_ID, 'expired/path'),
        error: null,
      })
      .mockResolvedValueOnce({
        data: responseFor(nextIntentId, 'renewed/path'),
        error: null,
      });
    mockUploadToSignedUrl
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: 410, message: 'signed URL expired' },
      })
      .mockResolvedValueOnce({ data: { path: 'renewed/path' }, error: null });

    await expect(uploadMessengerAttachmentBatch(batch)).resolves.toEqual({
      state: 'uploaded',
      intentIds: [nextIntentId],
    });
    expect(mockInvoke.mock.calls[0][1].body.deliveryKey).toBe(DELIVERY_KEY);
    expect(mockInvoke.mock.calls[1][1].body.deliveryKey).toBe(DELIVERY_KEY);
    expect(mockUploadToSignedUrl).toHaveBeenLastCalledWith(
      'renewed/path',
      `token-${nextIntentId}`,
      expect.any(Uint8Array),
      { contentType: 'text/plain', upsert: false },
    );
  });

  test('creates a fresh authorized download URL without persisting secrets', async () => {
    const signedUrl =
      'https://example.invalid/storage/v1/object/sign/private?token=secret';
    mockInvoke.mockResolvedValue({
      data: {
        ok: true,
        attachment: {
          id: INTENT_ID,
          name: '안내.txt',
          size: 1,
          mimeType: 'text/plain',
          sha256: 'a'.repeat(64),
        },
        download: {
          signedUrl,
          expiresAt: '2026-07-25T12:00:00.000Z',
        },
      },
      error: null,
    });

    await expect(createMessengerAttachmentDownloadUrl(INTENT_ID))
      .resolves.toBe(signedUrl);
    expect(mockInvoke).toHaveBeenCalledWith('messenger-attachments', {
      body: {
        type: 'download_url_create',
        attachmentId: INTENT_ID,
      },
      headers: { 'x-app-session-token': 'app-session-token' },
    });
    await expect(createMessengerAttachmentPreviewUrl(INTENT_ID, 'current-session'))
      .resolves.toEqual({ signedUrl, expiresAt: '2026-07-25T12:00:00.000Z' });
    expect(mockInvoke).toHaveBeenLastCalledWith('messenger-attachments', expect.objectContaining({
      headers: { 'x-app-session-token': 'current-session' },
    }));

    const source = readFileSync(
      join(__dirname, '..', 'messenger-attachment-api.ts'),
      'utf8',
    );
    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('SecureStore');
    expect(source).not.toMatch(/logger\.[a-z]+\([^)]*(signedUrl|token|path)/);
    expect(source).not.toContain('service_role');
  });
});
