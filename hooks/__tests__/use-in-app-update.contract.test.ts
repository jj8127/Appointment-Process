import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(__dirname, '..', '..');

describe('useInAppUpdate platform contracts', () => {
  it('uses iOS-specific update options instead of Android updateType', () => {
    const iosHookPath = join(rootDir, 'hooks', 'useInAppUpdate.ios.ts');

    expect(existsSync(iosHookPath)).toBe(true);

    const source = readFileSync(iosHookPath, 'utf8');
    expect(source).toContain('buttonUpgradeText');
    expect(source).not.toContain('IAUUpdateKind');
    expect(source).not.toContain('updateType');
  });

  it('keeps Android updates on the Play Store in-app update API', () => {
    const androidHookPath = join(rootDir, 'hooks', 'useInAppUpdate.android.ts');
    const source = readFileSync(androidHookPath, 'utf8');

    expect(source).toContain('IAUUpdateKind.FLEXIBLE');
    expect(source).toContain('updateType');
  });
});
