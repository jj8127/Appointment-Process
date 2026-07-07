import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closePendingAdminFileWindow,
  navigateAdminFileWindowOrCurrentTab,
  navigatePendingAdminFileWindow,
  openPendingAdminFileWindow,
} from './admin-file-open.ts';

test('opens a pending file window synchronously without noopener features and clears opener manually', () => {
  const calls: unknown[] = [];
  const opened = {
    closed: false,
    opener: { parent: true },
    close: () => undefined,
    location: { assign: () => undefined },
  };

  const popup = openPendingAdminFileWindow((url, target, features) => {
    calls.push({ url, target, features });
    return opened;
  });

  assert.equal(popup, opened);
  assert.deepEqual(calls, [{ url: '', target: '_blank', features: undefined }]);
  assert.equal(opened.opener, null);
});

test('navigates the pending file window to the signed URL', () => {
  const assigned: string[] = [];
  const opened = {
    closed: false,
    opener: null,
    close: () => undefined,
    location: { assign: (url: string) => assigned.push(url) },
  };

  navigatePendingAdminFileWindow(opened, 'https://example.supabase.co/signed');

  assert.deepEqual(assigned, ['https://example.supabase.co/signed']);
});

test('falls back to the current tab when a popup blocker prevents opening a pending file window', () => {
  const currentTabAssignments: string[] = [];

  const target = navigateAdminFileWindowOrCurrentTab(
    null,
    'https://example.supabase.co/signed',
    (url) => currentTabAssignments.push(url),
  );

  assert.equal(target, 'current-tab');
  assert.deepEqual(currentTabAssignments, ['https://example.supabase.co/signed']);
});

test('closes a pending file window on signing failure', () => {
  let closed = false;
  const opened = {
    closed: false,
    opener: null,
    close: () => {
      closed = true;
      opened.closed = true;
    },
    location: { assign: () => undefined },
  };

  closePendingAdminFileWindow(opened);

  assert.equal(closed, true);
  assert.equal(opened.closed, true);
});
