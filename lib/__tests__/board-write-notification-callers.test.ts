import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getBoardNotificationWarningMessage,
  invokeBoardWriteWithDeps,
  type BoardWriteNotification,
} from '../board-api';

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

const repoRoot = join(__dirname, '..', '..');

describe('board write notification callers', () => {
  it('preserves the durable save and notification partial-result envelope', async () => {
    const notification: BoardWriteNotification = {
      ok: false,
      inbox: { ok: true, attempted: 3 },
      push: {
        ok: false,
        attempted: 2,
        confirmed: 1,
        targets: [
          { targetRole: 'admin', ok: true, sent: 1, logged: true },
          {
            targetRole: 'fc',
            ok: false,
            sent: 0,
            logged: false,
            failure: 'delivery_unconfirmed',
          },
        ],
      },
    };
    const invoke = jest.fn(async () => ({
      data: {
        ok: true,
        saved: true,
        data: { id: 'post-id' },
        notification,
        notificationWarning: 'notification_delivery_incomplete',
      },
      error: null,
    }));

    const result = await invokeBoardWriteWithDeps<{ id: string }>(
      'board-create',
      { title: 'safe title' },
      {
        getStoredAppSessionToken: async () => 'signed-session',
        invoke,
      },
    );

    expect(result).toEqual({
      data: { id: 'post-id' },
      saved: true,
      notification,
      notificationWarning: 'notification_delivery_incomplete',
    });
  });

  it('keeps older successful responses compatible and maps warnings to safe UI copy', async () => {
    const result = await invokeBoardWriteWithDeps<null>(
      'board-update',
      { postId: 'post-id' },
      {
        getStoredAppSessionToken: async () => 'signed-session',
        invoke: async () => ({
          data: { ok: true, data: null },
          error: null,
        }),
      },
    );

    expect(result).toMatchObject({
      data: null,
      saved: true,
      notification: null,
      notificationWarning: null,
    });
    expect(getBoardNotificationWarningMessage(null)).toBeNull();
    expect(getBoardNotificationWarningMessage('notification_delivery_incomplete'))
      .toBe('게시글은 저장되었지만 일부 알림이 전송되지 않았습니다. 알림 상태를 확인해주세요.');
  });

  it('keeps durable board writes successful when attachment delivery is incomplete', () => {
    const mobileSource = readFileSync(join(repoRoot, 'app', 'admin-board.tsx'), 'utf8');
    const webSource = readFileSync(
      join(repoRoot, 'web', 'src', 'app', 'dashboard', 'board', 'page.tsx'),
      'utf8',
    );

    expect(mobileSource).toContain('notificationWarning = createResult.notificationWarning');
    expect(mobileSource).toContain('notificationWarning = updateResult.notificationWarning');
    expect(mobileSource).toContain('setPendingAttachmentRetry({');
    expect(mobileSource).toContain('pendingAttachmentRetry.manifest');
    expect(mobileSource).toContain('manifest: attachmentResult.manifest');
    expect(mobileSource).toContain('const canEditComposer = canWrite && !pendingAttachmentRetry');
    expect(mobileSource).toContain('editable={!!canEditComposer}');
    expect(mobileSource).toContain('disabled={!canEditComposer}');
    expect(mobileSource).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(mobileSource.indexOf('const createResult = await createBoardPost('))
      .toBeLessThan(mobileSource.indexOf('await uploadSelectedAttachments(targetPostId, null)'));
    expect(mobileSource).toContain(
      '게시글은 저장되었지만 첨부 전달을 확인하지 못했습니다.',
    );

    expect(webSource).toContain('notificationWarning: createResult.notificationWarning');
    expect(webSource).toContain('notificationWarning: updateResult.notificationWarning');
    expect(webSource).toContain('attachmentIncomplete: !attachmentResult.complete');
    expect(webSource).toContain('setPendingAttachmentRetry({');
    expect(webSource).toContain('pendingAttachmentRetry.manifest');
    expect(webSource).toContain('manifest: attachmentResult.manifest');
    expect(webSource).toContain('closeOnClickOutside={!pendingAttachmentRetry}');
    expect(webSource.indexOf('const createResult = await createBoardPost('))
      .toBeLessThan(webSource.indexOf('await uploadAttachments(createResult.id, null)'));
    expect(webSource).toContain('게시글은 이미 저장되었습니다.');
    expect(webSource).toContain("color: notificationWarningMessage ? 'yellow' : 'green'");
  });
});
