import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

describe('session push registration retry boundary', () => {
  const source = fs.readFileSync(path.join(root, 'hooks', 'use-session.tsx'), 'utf8');
  const homeSource = fs.readFileSync(path.join(root, 'app', 'index.tsx'), 'utf8');

  test('only marks a session key complete after a confirmed or terminal result', () => {
    const assignment = 'lastPushRegistrationKeyRef.current = pushRegistrationKey;';
    expect(source.match(new RegExp(assignment.replaceAll('.', '\\.'), 'g'))).toHaveLength(2);
    expect(source).toContain('if (result.ok)');
    expect(source).toContain('if (!result.retryable)');
    expect(source.indexOf(assignment)).toBeGreaterThan(source.indexOf('await registrationPromise.promise'));
  });

  test('bounds automatic retries, coalesces in-flight work, and refreshes registration after foregrounding', () => {
    expect(source).toContain('const retryDelaysMs = [1000, 2000, 5000, 10000] as const;');
    expect(source).toContain('pushRegistrationPromiseRef.current');
    expect(source).toContain('pushRegistrationForegroundRefreshKeyRef.current = pushRegistrationKey');
    expect(source).toContain("result.reason === 'permission_denied'");
    expect(source).toContain("AppState.addEventListener('change'");
    expect(source).toContain('shouldRefreshCompletedRegistration');
    expect(source).toContain('lastPushRegistrationKeyRef.current = null;');
  });

  test('never opens the OS permission prompt at app start', () => {
    // Only the notification settings switch may request permission (registerPushToken
    // with requestPermission); the root layout only creates the Android channel.
    const layoutSource = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
    expect(layoutSource).not.toContain('requestPermissionsAsync');
    expect(layoutSource).toContain('setNotificationChannelAsync(ALERTS_CHANNEL_ID');
  });

  test('keeps one global registration owner instead of a second home-screen attempt loop', () => {
    expect(source).toContain("state.requestBoardRole === 'designer'");
    expect(source).toContain("? 'manager'");
    expect(homeSource).not.toContain("from '@/lib/notifications'");
    expect(homeSource).not.toContain('registerPushToken(');
    expect(homeSource).not.toContain('pushRegistrationAttemptRef');
  });

  test('restarts registration after an explicit login even when the visible identity is unchanged', () => {
    const loginStart = source.indexOf('loginAs: (');
    const registrationStart = source.indexOf('const pushRegistrationBaseKey');
    const loginSource = source.slice(loginStart, registrationStart);

    expect(loginSource).toContain('void replaceAppSessionToken(nextAppSessionToken);');
    expect(source).toContain('setPushRegistrationRevision((current) => current + 1);');
    expect(source).toContain('`${pushRegistrationBaseKey}:${pushRegistrationRevision}`');
    expect(source).toContain('if (!pushRegistrationKey || !appSessionToken) return;');
  });
});
