import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildNotificationTargetRoute,
  parseNotificationPushData,
} from '@/lib/notification-target';

const root = join(__dirname, '..', '..');

function collectProductionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return collectProductionSources(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('strict notification routing boundary', () => {
  it('removes the legacy title/body/category/url guessing resolver', () => {
    expect(existsSync(join(root, 'lib', 'notification-route.ts'))).toBe(false);

    const offenders = [
      ...collectProductionSources(join(root, 'app')),
      ...collectProductionSources(join(root, 'components')),
      ...collectProductionSources(join(root, 'hooks')),
      ...collectProductionSources(join(root, 'lib')),
    ].filter((path) => {
      const source = readFileSync(path, 'utf8');
      return (
        source.includes('resolvePushNotificationRoute')
        || source.includes('normalizeNotificationTargetUrl')
        || source.includes('resolveRequestBoardNotificationRoute')
      );
    });
    expect(offenders).toEqual([]);
  });

  it('routes only an exact typed push target and notification UUID', () => {
    const notificationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const parsed = parseNotificationPushData({
      notificationId,
      target: { version: 1, kind: 'board_post', postId },
      title: 'ignored',
      url: '/dashboard',
    });

    expect(parsed).toEqual({
      notificationId,
      target: { version: 1, kind: 'board_post', postId },
    });
    expect(
      buildNotificationTargetRoute({
        ...parsed!,
        viewerRole: 'fc',
      }),
    ).toContain(`/board?postId=${postId}`);
    expect(
      parseNotificationPushData({
        notificationId,
        title: 'board post',
        url: `/board?postId=${postId}`,
      }),
    ).toBeNull();
  });
});
