import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOARD_ATTACHMENT_URL_REUSE_MS,
  getFreshBoardAttachments,
  openBoardAttachment,
} from '../board-attachment-actions';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('board attachment actions', () => {
  it('hands a signed attachment URL to the external browser instead of a Custom Tab', async () => {
    const openExternalUrl = jest.fn().mockResolvedValue('https://example.test/file.pdf');
    const alert = jest.fn();

    await expect(openBoardAttachment({
      signedUrl: 'https://example.test/file.pdf',
      openExternalUrl,
      alert,
    })).resolves.toBe(true);

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/file.pdf', { preferExternalBrowser: true });
    expect(alert).not.toHaveBeenCalled();
  });

  it('shows shared failure feedback when attachment opening fails', async () => {
    const error = new Error('open failed');
    const openExternalUrl = jest.fn().mockRejectedValue(error);
    const alert = jest.fn();
    const logError = jest.fn();

    await expect(openBoardAttachment({
      signedUrl: 'https://example.test/file.pdf',
      openExternalUrl,
      alert,
      logError,
    })).resolves.toBe(false);

    expect(alert).toHaveBeenCalledWith('오류', '첨부파일을 열 수 없습니다.');
    expect(logError).toHaveBeenCalledWith('attachment-open', error);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/file.pdf',
    'https://user:secret@storage.example.test/file.pdf',
    undefined,
  ])('does not open an unsafe or missing attachment URL: %s', async (signedUrl) => {
    const openExternalUrl = jest.fn();
    const alert = jest.fn();

    await expect(openBoardAttachment({
      signedUrl,
      openExternalUrl,
      alert,
    })).resolves.toBe(false);

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('오류', '첨부파일을 열 수 없습니다.');
  });

  describe('signed URL freshness', () => {
    const signedAt = 1_000_000;
    const current = [{ id: 'a', signedUrl: 'https://example.test/old' }];
    const refreshed = [{ id: 'a', signedUrl: 'https://example.test/new' }];

    it('reuses attachments signed within the reuse window without refetching', async () => {
      const refresh = jest.fn();

      await expect(getFreshBoardAttachments(current, signedAt, refresh, signedAt + BOARD_ATTACHMENT_URL_REUSE_MS - 1))
        .resolves.toBe(current);
      expect(refresh).not.toHaveBeenCalled();
    });

    it.each([
      ['near the 1 hour expiry', signedAt, signedAt + BOARD_ATTACHMENT_URL_REUSE_MS],
      ['without a signing time', 0, signedAt],
    ])('re-signs attachments %s', async (_label, at, now) => {
      const refresh = jest.fn().mockResolvedValue(refreshed);

      await expect(getFreshBoardAttachments(current, at, refresh, now)).resolves.toBe(refreshed);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('does not fall back to an expired URL when re-signing fails', async () => {
      const now = signedAt + 2 * 60 * 60 * 1000;

      await expect(getFreshBoardAttachments(current, signedAt, jest.fn().mockResolvedValue(null), now)).resolves.toBeNull();
      await expect(getFreshBoardAttachments(current, signedAt, jest.fn().mockRejectedValue(new Error('offline')), now))
        .resolves.toBeNull();
    });
  });

  it('keeps mobile and admin board attachment opening on the shared helper', () => {
    for (const source of [
      readRepoFile('app/board.tsx'),
      readRepoFile('app/admin-board-manage.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/board-attachment-actions'");
      expect(source).toContain('openBoardAttachment');
      expect(source).not.toContain('openExternalUrl(item.signedUrl).catch');
      expect(source).toContain('getFreshBoardAttachments(');
    }
    const editorSource = readRepoFile('app/admin-board.tsx');
    expect(editorSource).toContain('openBoardAttachment');
    expect(editorSource).not.toMatch(/openExternalUrl\((item|file)\.uri\)/);
  });
});
