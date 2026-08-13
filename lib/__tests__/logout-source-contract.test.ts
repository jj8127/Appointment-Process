import { readFileSync } from 'fs';
import { join } from 'path';

const readRootFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('explicit mobile logout source contract', () => {
  test('uses the no-auto-redirect login route after an explicit logout', () => {
    const source = readRootFile('hooks/use-app-logout.ts');

    expect(source).toContain("loginPath: string = '/login?skipAuto=1'");
    expect(source).toContain('logout();');
    expect(source).toContain('router.replace(loginPath as any);');
  });

  test('home logout does not enter a terminal Android-only loading surface', () => {
    const source = readRootFile('app/index.tsx');

    expect(source).toContain('const appLogout = useAppLogout();');
    expect(source).toContain('appLogout();');
    expect(source).not.toContain('isLoggingOut');
    expect(source).not.toContain('setIsLoggingOut');
  });

  test('session logout delegates local-first cleanup to the coordinator', () => {
    const source = readRootFile('hooks/use-session.tsx');

    expect(source).toContain('startSessionLogout({');
    expect(source).toContain('sessionToken: appSessionToken');
    expect(source).toContain('clearLocalSession: () => clearSessionState({ clearAppSession: true })');
    expect(source).toContain('unregisterPushTokens: unregisterAllPushTokens');
  });
});
