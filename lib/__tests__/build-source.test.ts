import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ANDROID_BUILD_INPUTS, EAS_PROJECT_ID, verifyBuildSource } = require('../../scripts/release/verify-build-source.cjs');

describe('current checkout build source', () => {
  let fixtureRoot: string;
  let archiveFiles: string[];
  let trackedNative: string;
  let config: { expo: { version: string; extra: { eas: { projectId: string } }; runtimeVersion: { policy: string } } };
  let verifyInstrumentation: jest.Mock;
  let git: jest.Mock;

  const write = (file: string, content: string) => {
    const target = join(fixtureRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const saveConfig = () => write('app.json', JSON.stringify(config));
  const verify = (platform = 'android', version = config.expo.version) => verifyBuildSource(
    { repoRoot: fixtureRoot, platform, version },
    { git, verifyInstrumentation },
  );

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'garamin-build-source-'));
    archiveFiles = ['app.json', 'package.json', 'eas.json', ...ANDROID_BUILD_INPUTS];
    trackedNative = '';
    for (const file of archiveFiles) write(file, '{}');
    config = { expo: { version: '4.2.12', extra: { eas: { projectId: EAS_PROJECT_ID } }, runtimeVersion: { policy: 'appVersion' } } };
    saveConfig();
    write('package.json', JSON.stringify({ scripts: { prepare: 'node ./scripts/prepare.js' } }));
    write('scripts/prepare.js', 'verifyAndroidDrawingOrderInstrumentation();');
    verifyInstrumentation = jest.fn();
    git = jest.fn((_root: string, args: string[]) => {
      if (args[0] === 'rev-parse') return fixtureRoot;
      if (args.includes('--cached')) return archiveFiles.join('\0') + '\0';
      return trackedNative;
    });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('uses current files including uncommitted inputs without a branch or clean-tree requirement', () => {
    expect(verify()).toEqual({ repoRoot: fixtureRoot, platform: 'android', version: '4.2.12' });
    expect(git).toHaveBeenCalledWith(fixtureRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    expect(git.mock.calls.some(([, args]) => args.includes('status') || args.includes('branch'))).toBe(false);
    expect(verifyInstrumentation).toHaveBeenCalledWith(fixtureRoot, { requireGeneratedAndroid: false });
  });

  test('accepts a subsequent version edited only in app.json', () => {
    config.expo.version = '4.3.0';
    saveConfig();
    expect(verify().version).toBe('4.3.0');
  });

  test('rejects a version changed after the plan was read', () => {
    config.expo.version = '4.3.0';
    saveConfig();
    expect(() => verify('android', '4.2.12')).toThrow('changed after');
  });

  test('iOS uses the same app version and archive without requiring an Android native build', () => {
    archiveFiles = ['app.json', 'package.json', 'eas.json'];
    expect(verify('ios').version).toBe('4.2.12');
    expect(verifyInstrumentation).not.toHaveBeenCalled();
  });

  test.each(['android/settings.gradle', 'ios/app.xcodeproj/project.pbxproj'])('rejects a tracked native version override: %s', (file) => {
    trackedNative = file + '\0';
    expect(() => verify()).toThrow('Generated android/ and ios/');
  });

  test('rejects unignored generated native files that would prevent cloud prebuild', () => {
    archiveFiles.push('android/app/build.gradle');
    expect(() => verify()).toThrow('must be ignored');
  });

  test('rejects an ignored instrumentation input before starting a remote build', () => {
    archiveFiles = archiveFiles.filter((file) => !file.endsWith('ReactAndroidDrawingOrderGuardPlugin.java'));
    expect(() => verify()).toThrow('missing or ignored');
    expect(verifyInstrumentation).not.toHaveBeenCalled();
  });

  test('rejects an unreviewed archive override', () => {
    write('.easignore', 'app.json');
    expect(() => verify()).toThrow('Review .easignore');
  });

  test('rejects the wrong EAS project and runtime policy', () => {
    config.expo.extra.eas.projectId = 'wrong-project';
    saveConfig();
    expect(() => verify()).toThrow('GaramIn EAS project');
    config.expo.extra.eas.projectId = EAS_PROJECT_ID;
    config.expo.runtimeVersion.policy = 'sdkVersion';
    saveConfig();
    expect(() => verify()).toThrow('appVersion runtime policy');
  });

  test('rejects the legacy Android preparation path', () => {
    write('scripts/prepare.js', 'applyAndroidDrawingOrderFix();');
    expect(() => verify()).toThrow('prebuilt drawing-order protection');
  });

  test('rejects running against a different Git repository root', () => {
    git.mockImplementationOnce(() => tmpdir());
    expect(() => verify()).toThrow('same source folder');
  });
});
