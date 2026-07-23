import {
  deliverBoardAttachments,
  type BoardAttachmentDeliveryDeps,
  type BoardAttachmentFile,
} from '../board-attachment-delivery';

type Source = { uri: string };

const files: BoardAttachmentFile<Source>[] = [
  {
    source: { uri: 'file:///safe.pdf' },
    fileName: 'safe.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
    fileType: 'file',
  },
];

const createDeps = (
  overrides: Partial<BoardAttachmentDeliveryDeps<Source>> = {},
): BoardAttachmentDeliveryDeps<Source> => ({
  sign: jest.fn(async () => [
    { storagePath: 'board/post/same_safe.pdf', signedUrl: 'https://upload.invalid/signed' },
  ]),
  upload: jest.fn(async () => undefined),
  finalize: jest.fn(async () => undefined),
  areFinalized: jest.fn(async () => false),
  ...overrides,
});

describe('board post-commit attachment delivery', () => {
  it('reuses the exact signed manifest after a finalize response is lost', async () => {
    let reconcileCalls = 0;
    const finalize = jest.fn(async () => {
      throw new Error('response_lost_after_commit');
    });
    const deps = createDeps({
      finalize,
      areFinalized: async () => {
        reconcileCalls += 1;
        if (reconcileCalls === 1) throw new Error('temporary_read_failure');
        return true;
      },
    });

    const first = await deliverBoardAttachments(files, null, deps);
    expect(first.complete).toBe(false);
    expect(first.manifest).toMatchObject({
      phase: 'finalize',
      files: [{ storagePath: 'board/post/same_safe.pdf' }],
    });

    const retry = await deliverBoardAttachments(files, first.manifest, deps);
    expect(retry).toEqual({ complete: true, manifest: null });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(deps.sign).toHaveBeenCalledTimes(1);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it('keeps an upload-phase manifest instead of signing a new random path', async () => {
    const deps = createDeps({
      upload: async () => {
        throw new Error('upload_unconfirmed');
      },
      finalize: async () => {
        throw new Error('storage_object_not_ready');
      },
    });

    const first = await deliverBoardAttachments(files, null, deps);
    const retry = await deliverBoardAttachments(files, first.manifest, deps);

    expect(first.manifest?.phase).toBe('upload');
    expect(retry.manifest?.files[0].storagePath).toBe('board/post/same_safe.pdf');
    expect(deps.sign).toHaveBeenCalledTimes(2);
    expect(deps.sign).toHaveBeenLastCalledWith([
      expect.objectContaining({ storagePath: 'board/post/same_safe.pdf' }),
    ]);
  });

  it('finalizes the exact manifest when an upload response is lost after storage commit', async () => {
    const finalize = jest.fn(async () => undefined);
    const deps = createDeps({
      upload: async () => {
        throw new Error('response_lost_after_upload');
      },
      finalize,
    });

    const result = await deliverBoardAttachments(files, null, deps);

    expect(result).toEqual({ complete: true, manifest: null });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(deps.sign).toHaveBeenCalledTimes(1);
  });
});
