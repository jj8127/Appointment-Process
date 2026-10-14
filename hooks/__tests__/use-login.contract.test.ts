import fs from 'fs';
import path from 'path';

describe('use-login source contract', () => {
  it('does not force a landing-route replace before session state propagates', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'hooks', 'use-login.ts'),
      'utf8',
    );

    expect(source).not.toContain(
      "router.replace(isRequestBoardDesigner ? '/request-board' : nextRole === 'admin' ? '/' : '/home-lite');",
    );
  });

  it('keeps password authentication on the common entry and preserves shared signed-session installation', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'hooks', 'use-login.ts'),
      'utf8',
    );

    expect(source).not.toContain("supabase.functions.invoke");
    expect(source).toContain('acceptLoginResponse');
    expect(source).toContain('handleLoginRejection');
    const common = fs.readFileSync(path.join(process.cwd(), 'app', 'services', 'login.tsx'), 'utf8');
    expect(common).toContain("platformRequest<PlatformAuthResponse>('login'");
  });

});
