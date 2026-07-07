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

  it('logs invoke failures and rejected login responses for runtime diagnosis', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'hooks', 'use-login.ts'),
      'utf8',
    );

    expect(source).toContain("logger.warn('[login] login-with-password invoke failed'");
    expect(source).toContain("logger.warn('[login] login-with-password rejected'");
    expect(source).toContain("logger.warn('[login] login flow threw'");
  });
});
