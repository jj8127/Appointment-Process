import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
}

describe('signup flow background fallback', () => {
  it('keeps native stack transition backgrounds on the signup gradient color', () => {
    const source = readAppFile('_layout.tsx');

    expect(source).toContain('AUTH_GRADIENT_BACKGROUND');
    expect(source).toContain('authHeader');
    expect(source).toContain('contentStyle: { backgroundColor: AUTH_GRADIENT_BACKGROUND }');
    expect(source).toContain('name="signup"');
    expect(source).toContain('...authHeader');
    expect(source).toContain('name="signup-verify"');
    expect(source).toContain('name="signup-password"');
  });

  it.each(['signup.tsx', 'signup-verify.tsx', 'signup-password.tsx'])(
    'keeps a non-black root and gradient fallback in %s',
    (fileName) => {
      const source = readAppFile(fileName);

      expect(source).toContain('gradientFallback');
      expect(source).toContain('backgroundColor: COLORS.primaryPale');
      expect(source).toContain('style={[StyleSheet.absoluteFill, styles.gradientFallback]}');
    },
  );
});
