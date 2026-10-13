import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('common signup OTP feedback contract', () => {
  it('shows OTP request failures next to the request control before the code field', () => {
    const source = read('app/services/signup.tsx');
    const requestButton = source.indexOf("<Button onPress={() => submit('otp')}");
    const feedback = source.indexOf('{otpError ?');
    const codeField = source.indexOf('<FormInput label="인증 코드"');

    expect(requestButton).toBeGreaterThan(-1);
    expect(feedback).toBeGreaterThan(requestButton);
    expect(codeField).toBeGreaterThan(feedback);
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('인증 문자 발송 요청이 접수되었습니다.');
  });

  it('keeps duplicate membership distinct from cooldown and lock throttles', () => {
    const source = read('supabase/functions/platform-service/index.ts');
    expect(source).toContain("const status=result.code==='already_exists' ? 409 : 429");
    expect(source).toContain("result.code==='locked'");
  });

  it('disables repeat OTP requests locally for server cooldowns, locks, and ambiguous delivery', () => {
    const source = read('app/services/signup.tsx');

    expect(source).toContain("failure.code === 'locked'");
    expect(source).toContain("failure.code === 'cooldown'");
    expect(source).toContain('? 600');
    expect(source).toContain('? 60');
    expect(source).toContain('if (throttleSeconds > 0) setCooldown(throttleSeconds);');
  });
});
