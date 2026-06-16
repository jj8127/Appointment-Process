import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('board-update notification contract', () => {
  const source = readFileSync(join(process.cwd(), 'supabase/functions/board-update/index.ts'), 'utf8');

  it('notifies board readers after a successful update', () => {
    expect(source).toContain("const notificationTitle = '게시글 수정'");
    expect(source).toContain('const targetUrl = `/board?postId=${postId}`');
    expect(source).toContain('insertNotificationsWithFallback(notificationRows)');
    expect(source).toContain("sendBoardPush('fc', notificationTitle, updatedTitle, targetUrl)");
    expect(source).toContain("sendBoardPush('admin', notificationTitle, updatedTitle, targetUrl)");
    expect(source).toContain('skip_notification_insert: true');
  });
});
