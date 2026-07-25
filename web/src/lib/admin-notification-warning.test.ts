import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getAdminNotificationWarning,
} from './admin-notification-warning.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('keeps notification delivery diagnostics out of operator-facing feedback', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'notification_delivery_incomplete' }),
    null,
  );
});

test('surfaces only confirmed inbox persistence failures', () => {
  const expected = '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다.';
  assert.equal(
    getAdminNotificationWarning({
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      },
    }),
    expected,
  );
  assert.equal(
    getAdminNotificationWarning({ warning: 'notification_persistence_incomplete' }),
    expected,
  );
});

test('suppresses no-device and provider failures after inbox persistence', () => {
  for (const pushStatus of ['no_registered_device', 'provider_rejected']) {
    assert.equal(
      getAdminNotificationWarning({
        warning: 'notification_delivery_incomplete',
        delivery: {
          notificationStored: true,
          pushStatus,
          retryable: pushStatus === 'provider_rejected',
        },
      }),
      null,
    );
  }
});

test('lifecycle, document, and appointment responses expose only inbox persistence failure', () => {
  const expected = '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다.';
  const persistenceFailures = [
    {
      ok: true,
      warning: 'notification_persistence_incomplete',
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      },
    },
    {
      success: true,
      warning: 'notification_persistence_incomplete',
      notification: {
        delivery: {
          notificationStored: false,
          pushStatus: 'not_attempted',
          retryable: true,
        },
      },
    },
    {
      success: true,
      warning: 'notification_persistence_incomplete',
    },
  ];

  for (const response of persistenceFailures) {
    assert.equal(getAdminNotificationWarning(response), expected);
  }

  for (const pushStatus of ['no_registered_device', 'provider_rejected']) {
    assert.equal(
      getAdminNotificationWarning({
        success: true,
        warning: 'notification_delivery_incomplete',
        notification: {
          delivery: {
            notificationStored: true,
            pushStatus,
            retryable: false,
          },
        },
      }),
      null,
    );
  }
  assert.equal(
    getAdminNotificationWarning({ warning: 'notification_unread' }),
    null,
  );
});

test('does not expose a server action warning payload', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'provider-specific delivery detail' }),
    null,
  );
});

test('ignores missing, blank, and malformed warnings', () => {
  assert.equal(getAdminNotificationWarning(null), null);
  assert.equal(getAdminNotificationWarning({}), null);
  assert.equal(getAdminNotificationWarning({ warning: '   ' }), null);
  assert.equal(getAdminNotificationWarning({ warning: true }), null);
});

test('admin mutation callers surface canonical persistence warnings through the shared UI adapter', () => {
  const dashboardSource = readSource('app/dashboard/page.tsx');
  const appointmentSource = readSource('app/dashboard/appointment/page.tsx');
  const docsSource = readSource('app/dashboard/docs/page.tsx');
  const profileSource = readSource('app/dashboard/profile/[id]/page.tsx');

  assert.ok((dashboardSource.match(/showAdminNotificationWarning\(/g) ?? []).length >= 8);
  assert.equal((appointmentSource.match(/showAdminNotificationWarning\(/g) ?? []).length, 2);
  assert.equal((docsSource.match(/showAdminNotificationWarning\(/g) ?? []).length, 1);
  assert.equal((profileSource.match(/showAdminNotificationWarning\(/g) ?? []).length, 1);

  const helperSource = readSource('lib/admin-notification-warning.ts');
  const uiSource = readSource('lib/show-admin-notification-warning.ts');
  assert.match(helperSource, /notificationStored === false/);
  assert.match(uiSource, /notifications\.show/);
  assert.match(uiSource, /알림함 등록 실패/);
});

test('lifecycle actions classify persistence independently from push delivery', () => {
  const docsAction = readSource('app/dashboard/docs/actions.ts');
  const appointmentAction = readSource('app/dashboard/appointment/actions.ts');
  for (const source of [docsAction, appointmentAction]) {
    assert.match(source, /delivery\.notificationStored/);
    assert.match(source, /notification_persistence_incomplete/);
    assert.doesNotMatch(source, /!notificationResult\.success/);
    assert.doesNotMatch(source, /!result\.success/);
  }
});
