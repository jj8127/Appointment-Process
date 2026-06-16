import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
}

describe('signup flow background fallback', () => {
  it('keeps native stack transition backgrounds on the signup gradient color', () => {
    const source = readAppFile('_layout.tsx');

    expect(source).toContain('AUTH_SCREEN_BACKGROUND');
    expect(source).toContain('authHeader');
    expect(source).toContain('contentStyle: { backgroundColor: AUTH_SCREEN_BACKGROUND }');
    expect(source).toContain('name="signup"');
    expect(source).toContain('...authHeader');
    expect(source).toContain('name="signup-verify"');
    expect(source).toContain('name="signup-password"');
  });

  it.each(['login.tsx', 'signup.tsx', 'signup-verify.tsx', 'signup-password.tsx', 'reset-password.tsx'])(
    'uses a plain light auth background instead of a full-screen native gradient in %s',
    (fileName) => {
      const source = readAppFile(fileName);

      expect(source).not.toContain("from 'expo-linear-gradient'");
      expect(source).not.toContain('<LinearGradient');
      expect(source).not.toContain('StyleSheet.absoluteFill');
      expect(source).not.toContain('styles.gradientFallback');
      expect(source).toContain('styles.authBackground');
      expect(source).toContain('backgroundColor: AUTH_SCREEN_BACKGROUND');
    },
  );
});
