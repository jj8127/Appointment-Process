import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
}

describe('login mobile keyboard behavior', () => {
  it('keeps the login button tappable while the keyboard is open', () => {
    const source = readAppFile('login.tsx');
    const loginButtonStart = source.indexOf('<Button');
    const loginButtonBlock = source.slice(
      loginButtonStart,
      source.indexOf('</Button>', loginButtonStart),
    );

    expect(source).toContain('keyboardShouldPersistTaps="always"');
    expect(loginButtonBlock).toContain('onPress={handleLogin}');
    expect(loginButtonBlock).toContain('submitOnPressIn');
    expect(loginButtonBlock).toContain('dismissKeyboardOnPress');
    expect(loginButtonBlock).not.toContain('dismissKeyboardOnPress={false}');
    expect(source).not.toContain('Keyboard.dismiss()');
    expect(source).not.toContain('    Keyboard,');
  });

  it('uses the shared touchable Button for the login CTA instead of a raw Pressable', () => {
    const source = readAppFile('login.tsx');
    const loginButtonStart = source.indexOf('<Button');
    const loginButtonBlock = source.slice(
      loginButtonStart,
      source.indexOf('</Button>', loginButtonStart),
    );

    expect(source).toContain("import { Button } from '@/components/Button';");
    expect(loginButtonBlock).toContain('<Button');
    expect(loginButtonBlock).toContain('onPress={handleLogin}');
    expect(loginButtonBlock).toContain('loading={loading}');
    expect(loginButtonBlock).toContain('disabled={loading}');
    expect(loginButtonBlock).not.toContain('<Pressable');
  });

  it('hydrates and persists saved password credentials behind an explicit opt-in', () => {
    const source = readAppFile('login.tsx');

    expect(source).toContain("getSavedLoginCredentials");
    expect(source).toContain("setSavedLoginCredentials");
    expect(source).toContain("rememberPassword");
    expect(source).toContain("비밀번호 저장");
    expect(source).toContain("setPhoneInput(saved.phone)");
    expect(source).toContain("setPasswordInput(saved.password)");
    expect(source).toContain("setRememberPassword(true)");
    expect(source).toContain("setSavedLoginCredentials({");
    expect(source).toContain("rememberPassword: rememberPassword ? true : false");
  });

  it('keeps the saved-password checkbox tappable while the keyboard is open', () => {
    const source = readAppFile('login.tsx');
    const rememberLabelIndex = source.indexOf('accessibilityLabel="비밀번호 저장"');
    const rememberButtonStart = source.lastIndexOf('<Pressable', rememberLabelIndex);
    const rememberButtonBlock = source.slice(
      rememberButtonStart,
      source.indexOf('</Pressable>', rememberLabelIndex),
    );

    expect(rememberButtonBlock).toContain('onPressIn={handleRememberPasswordPressIn}');
    expect(rememberButtonBlock).toContain('onPress={handleRememberPasswordPress}');
    expect(rememberButtonBlock).not.toContain('onPress={toggleRememberPassword}');
    expect(source).toContain('rememberPasswordPressInHandledRef');
  });
});
