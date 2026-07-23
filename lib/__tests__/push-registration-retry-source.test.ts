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

  test('keeps one global registration owner instead of a second home-screen attempt loop', () => {
    expect(homeSource).not.toContain("from '@/lib/notifications'");
    expect(homeSource).not.toContain('registerPushToken(');
    expect(homeSource).not.toContain('pushRegistrationAttemptRef');
  });

  test('migrates legacy session tokens to secure storage and never rewrites them into session JSON', () => {
    expect(source).toContain('const securedAppSessionToken = await getStoredAppSessionToken();');
    expect(source).toContain('const restoredAppSessionToken = securedAppSessionToken ?? legacyAppSessionToken;');
    expect(source).toContain('await persistStoredAppSessionToken(legacyAppSessionToken);');

    const persistStart = source.indexOf('const persist = async () => {');
    const persistEnd = source.indexOf('persist();', persistStart);
    const persistSource = source.slice(persistStart, persistEnd);
    expect(persistSource).not.toContain('appSessionToken,');
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
