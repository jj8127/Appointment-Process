import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

describe('session push registration retry boundary', () => {
  const source = fs.readFileSync(path.join(root, 'hooks', 'use-session.tsx'), 'utf8');
  const homeSource = fs.readFileSync(path.join(root, 'app', 'index.tsx'), 'utf8');

  test('only marks a session key complete after a confirmed or terminal result', () => {
    const assignment = 'lastPushRegistrationKeyRef.current = pushRegistrationKey;';
    expect(source.match(new RegExp(assignment.replaceAll('.', '\\.'), 'g'))).toHaveLength(1);
    expect(source).toContain('if (result.ok || !result.retryable)');
    expect(source.indexOf(assignment)).toBeGreaterThan(source.indexOf('await registrationPromise.promise'));
  });

  test('bounds automatic retries, coalesces in-flight work, and retries after foregrounding', () => {
    expect(source).toContain('const retryDelaysMs = [1000, 2000, 5000, 10000] as const;');
    expect(source).toContain('pushRegistrationPromiseRef.current');
    expect(source).toContain("AppState.addEventListener('change'");
    expect(source).toContain("nextState !== 'active' || !exhausted");
  });

  test('keeps one global registration owner instead of a second home-screen attempt loop', () => {
    expect(homeSource).not.toContain("from '@/lib/notifications'");
    expect(homeSource).not.toContain('registerPushToken(');
    expect(homeSource).not.toContain('pushRegistrationAttemptRef');
  });
});
