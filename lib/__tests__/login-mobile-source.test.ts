import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
}

describe('login mobile keyboard behavior', () => {
  it('keeps the login button tappable while the keyboard is open', () => {
    const source = readAppFile('login.tsx');
    const loginButtonStart = source.indexOf('styles.button,');
    const loginButtonBlock = source.slice(
      loginButtonStart,
      source.indexOf('</Pressable>', loginButtonStart),
    );

    expect(source).toContain('keyboardShouldPersistTaps="always"');
    expect(loginButtonBlock).toContain('onPress={handleLogin}');
    expect(loginButtonBlock).not.toContain('onPressIn');
    expect(source).not.toContain('Keyboard.dismiss()');
    expect(source).not.toContain('    Keyboard,');
  });
});
