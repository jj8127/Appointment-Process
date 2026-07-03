import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openBoardAttachment } from '../board-attachment-actions';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('board attachment actions', () => {
  it('opens a signed attachment URL through the supplied opener', async () => {
    const openExternalUrl = jest.fn().mockResolvedValue('https://example.test/file.pdf');
    const alert = jest.fn();

    await expect(openBoardAttachment({
      signedUrl: 'https://example.test/file.pdf',
      openExternalUrl,
      alert,
    })).resolves.toBe(true);

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/file.pdf');
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

  it('keeps mobile and admin board attachment opening on the shared helper', () => {
    for (const source of [
      readRepoFile('app/board.tsx'),
      readRepoFile('app/admin-board-manage.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/board-attachment-actions'");
      expect(source).toContain('openBoardAttachment');
      expect(source).not.toContain('openExternalUrl(item.signedUrl).catch');
    }
  });
});
