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
    expect(source).toContain('if (!hydrated || !role)');
    expect(source).toContain('key="session-transition"');
  });

  test('logout screens use the focused hook rather than competing null-role redirects', () => {
    for (const file of ['index', 'home-lite', 'settings', 'board', 'admin-board-manage', 'request-board']) {
      const source = readRootFile(`app/${file}.tsx`);
      expect(source).not.toMatch(/if \(!role\)\s*\{\s*router\.replace/);
    }
    const layout = readRootFile('app/_layout.tsx');
    expect(layout).not.toContain("removeItem('session_role')");
    expect(layout).toContain('<HomeLiteLogoutBackButton />');
    expect(layout).toContain('onPress={logout}');
  });

  test('session logout delegates local-first cleanup to the coordinator', () => {
    const source = readRootFile('hooks/use-session.tsx');

    expect(source).toContain('startSessionLogout({');
    expect(source).toContain('sessionToken: appSessionToken');
    expect(source).toContain('clearLocalSession: () => clearSessionState({ clearAppSession: true })');
    expect(source).toContain('unregisterPushTokens: unregisterAllPushTokens');
  });
});
