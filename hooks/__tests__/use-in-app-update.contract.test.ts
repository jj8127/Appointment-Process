import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = join(__dirname, '..', '..');

describe('useInAppUpdate platform contracts', () => {
  it('has one startup owner instead of checking again on every home mount', () => {
    const homeSource = readFileSync(join(rootDir, 'app', 'index.tsx'), 'utf8');
    const rootSource = readFileSync(join(rootDir, 'app', '_layout.tsx'), 'utf8');

    expect(homeSource.includes('useInAppUpdate')).toBe(false);
    expect(rootSource.match(/useInAppUpdate\(/g)).toHaveLength(1);
  });

  it('uses iOS-specific update options instead of Android updateType', () => {
    const iosHookPath = join(rootDir, 'hooks', 'useInAppUpdate.ios.ts');

    expect(existsSync(iosHookPath)).toBe(true);

    const source = readFileSync(iosHookPath, 'utf8');
    expect(source).toContain('cancelable: true');
    expect(source.includes('inAppUpdates.startUpdate')).toBe(false);
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
