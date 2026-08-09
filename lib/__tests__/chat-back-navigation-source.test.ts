import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('direct chat back navigation contract', () => {
  it('falls back to the messenger hub and uses a normal press action', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'chat.tsx'), 'utf8');

    expect(source).toContain("goBackOrReplace(router, '/messenger')");
    expect(source).toContain('accessibilityLabel="메신저 목록으로 돌아가기"');
    expect(source).toContain('onPress={handleBack}');
    expect(source).not.toContain('onPressIn={handleBack}');
  });
});
