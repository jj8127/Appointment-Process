/* eslint-disable @typescript-eslint/no-require-imports */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';

jest.mock('../../scripts/release/verify-build-source.cjs', () => ({
  verifyBuildSource: jest.fn(),
}), { virtual: true });

const {
  EAS_CLI_VERSION,
  REPO_ROOT,
  createBuildPlan,
  parseBuildRequest,
  resolveNpxCliPath,
  runBuild,
} = require('../../scripts/eas-build.js');
const { verifyBuildSource } = require('../../scripts/release/verify-build-source.cjs');

describe('EAS builds use the main source directory and its current app version', () => {
  let fixture: string;
  let originalCwd: string;
  const logger = { log: jest.fn() };
  const npxOptions = {
    nodePath: path.resolve('test-node', 'node'),
    npmExecPath: path.resolve('test-node', 'npm', 'npm-cli.js'),
    exists: () => true,
  };
  const writeApp = (version: unknown) => fs.writeFileSync(
    path.join(fixture, 'app.json'), JSON.stringify({ expo: { version } }),
  );
  const options = () => ({ repoRoot: fixture, ...npxOptions, logger });

  beforeEach(() => {
    originalCwd = process.cwd();
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'garamin-eas-build-'));
    writeApp('4.2.12');
    fs.writeFileSync(path.join(fixture, 'eas.json'), JSON.stringify({
      build: { production: { autoIncrement: true }, preview: {}, development: {} },
    }));
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    const resolved = path.resolve(fixture);
    const relative = path.relative(os.tmpdir(), resolved);
    if (!relative.startsWith('garamin-eas-build-') || relative.includes(path.sep)) {
      throw new Error('Unexpected fixture cleanup path');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it('imports without launching a process, authenticating, or modifying Git hooks', () => {
    const spawn = jest.spyOn(childProcess, 'spawnSync').mockImplementation(() => {
      throw new Error('An import must never start a command');
    });
    const exec = jest.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('An import must never run Git');
    });
    const write = jest.spyOn(fs, 'writeFileSync');
    jest.isolateModules(() => require('../../scripts/eas-build.js'));
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('anchors the real default plan to the wrapper directory even from a different working directory', () => {
    process.chdir(fixture);
    const plan = createBuildPlan(['android', '--dry-run'], npxOptions);
    expect(plan.repoRoot).toBe(path.resolve(__dirname, '../..'));
    expect(plan.repoRoot).toBe(REPO_ROOT);
    const mainVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8')).expo.version;
    expect(plan.version).toBe(mainVersion);
  });

  it('rereads app.json for each invocation rather than caching or pinning the version', () => {
    expect(createBuildPlan(['android'], options()).version).toBe('4.2.12');
    writeApp('4.3.0');
    expect(createBuildPlan(['ios'], options()).version).toBe('4.3.0');
    writeApp('5.0.0-rc.1');
    expect(createBuildPlan(['android'], options()).version).toBe('5.0.0-rc.1');
  });

  it.each(['android', 'ios'])('launches %s using shell-free Node and the pinned CLI with the source cwd', (platform) => {
    const spawn = jest.fn().mockReturnValue({ status: 0 });
    const env = { PATH: 'test-path', TEST_BUILD: '1' };
    process.chdir(os.tmpdir());
    expect(runBuild([platform, 'preview', '--non-interactive'], { ...options(), spawn, env })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(npxOptions.nodePath, [
      path.join(path.dirname(npxOptions.npmExecPath), 'npx-cli.js'),
      '--yes', `eas-cli@${EAS_CLI_VERSION}`, 'build', '--platform', platform,
      '--profile', 'preview', '--non-interactive',
    ], { cwd: fixture, stdio: 'inherit', env, shell: false, windowsHide: true });
    expect(logger.log).toHaveBeenCalledWith(`[eas-build] Build source: ${fixture}`);
    expect(logger.log).toHaveBeenCalledWith(`[eas-build] Platform: ${platform} | Profile: preview | App version: 4.2.12`);
  });

  it('preserves iOS credential flags and argument boundaries without shell expansion', () => {
    const message = 'version message; $(do-not-run) & literal spaces';
    const plan = createBuildPlan([
      'ios', 'production', '--non-interactive', '--freeze-credentials', '--message', message,
    ], options());
    expect(plan.extraArgs).toEqual(['--non-interactive', '--freeze-credentials', '--message', message]);
    expect(plan.args.at(-1)).toBe(message);
  });

  it.each(['android', 'ios'])('validates %s dry-run without spawning or mutating files/hooks', (platform) => {
    const spawn = jest.fn();
    const exec = jest.spyOn(childProcess, 'execSync');
    const write = jest.spyOn(fs, 'writeFileSync');
    expect(runBuild([platform, '--dry-run'], { ...options(), spawn })).toBe(0);
    expect(verifyBuildSource).toHaveBeenCalledWith(expect.objectContaining({
      repoRoot: fixture, platform, profile: 'production', version: '4.2.12', dryRun: true,
    }));
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Dry run complete'));
  });

  it.each([false, true])('never launches when local source validation fails (dryRun=%s)', (dryRun) => {
    const spawn = jest.fn();
    const validatePlan = jest.fn(() => { throw new Error('Invalid native source'); });
    expect(() => runBuild(['android', ...(dryRun ? ['--dry-run'] : [])], {
      ...options(), spawn, validatePlan,
    })).toThrow('Invalid native source');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([null, 412, '', '4.2', '4.2.12\n', 'current'])('rejects an invalid version %p before spawning', (version) => {
    writeApp(version);
    const spawn = jest.fn();
    expect(() => runBuild(['android', '--dry-run'], { ...options(), spawn })).toThrow('expo.version');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['app.json', 'eas.json'])('rejects malformed %s without echoing its contents', (filename) => {
    fs.writeFileSync(path.join(fixture, filename), 'synthetic-private-value');
    expect(() => createBuildPlan(['ios'], options())).toThrow(`Unable to read a valid ${filename}`);
    expect(() => createBuildPlan(['ios'], options())).not.toThrow('synthetic-private-value');
  });

  it.each([null, [], 'bad'])('rejects a non-object app config %p', (value) => {
    fs.writeFileSync(path.join(fixture, 'app.json'), JSON.stringify(value));
    expect(() => createBuildPlan(['android'], options())).toThrow('Unable to read a valid app.json');
  });

  it('rejects missing app config, missing profiles and inherited property names', () => {
    expect(() => createBuildPlan(['android', 'missing-profile'], options())).toThrow('not configured');
    expect(() => createBuildPlan(['android', 'toString'], options())).toThrow('not configured');
    fs.unlinkSync(path.join(fixture, 'app.json'));
    expect(() => createBuildPlan(['android'], options())).toThrow('Unable to read a valid app.json');
  });

  it.each([
    [], ['web'], ['all'], ['android', ''], ['ios', ' production'],
    ['ios', 'production', '--platform', 'android'], ['android', '--platform=ios'],
    ['ios', 'production', '-p', 'android'], ['ios', '-pandroid'], ['ios', '-p=android'],
    ['android', '-e', 'preview'], ['android', '-epreview'], ['ios', '-e=preview'],
    ['android', 'production', '--profile', 'preview'], ['android', '--profile=preview'],
    ['android', '--', '--platform', 'ios'], ['ios', '--dry-run=false'], ['android', 'production', 'bad\0arg'],
  ])('rejects invalid or conflicting arguments %p', (...argv) => {
    const spawn = jest.fn();
    expect(() => runBuild(argv, { ...options(), spawn })).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('defaults the profile while reserving dry-run for the local wrapper', () => {
    expect(parseBuildRequest(['ios', '--non-interactive', '--dry-run', '--freeze-credentials'])).toEqual({
      platform: 'ios', profile: 'production', dryRun: true,
      extraArgs: ['--non-interactive', '--freeze-credentials'],
    });
  });

  it('resolves npm alongside Node without relying on a global eas or a command shell', () => {
    const nodePath = path.join(fixture, 'node.exe');
    const expected = path.join(fixture, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    expect(resolveNpxCliPath({ nodePath, npmExecPath: '', exists: (candidate: string) => candidate === expected })).toBe(expected);
    expect(() => resolveNpxCliPath({ nodePath, npmExecPath: '', exists: () => false })).toThrow('Unable to locate');
  });

  it('propagates a failed CLI exit and launch error', () => {
    expect(runBuild(['android'], { ...options(), spawn: () => ({ status: 7 }) })).toBe(7);
    expect(runBuild(['android'], { ...options(), spawn: () => ({ status: null }) })).toBe(1);
    expect(() => runBuild(['android'], {
      ...options(), spawn: () => ({ error: new Error('Node could not launch') }),
    })).toThrow('Node could not launch');
  });
});
