import fs from 'fs';
import http from 'http';
import { createRequire } from 'module';
import path from 'path';
import {
  isSentryUploadDisabled,
  resolveSentryBuildUploadPolicy,
} from '../../web/src/lib/sentry-build-policy';

type SentryBuildPluginManager = {
  normalizedOptions: {
    authToken?: string;
    telemetry?: boolean;
    release: { create: boolean; finalize: boolean };
    sourcemaps?: { disable?: boolean };
  };
  telemetry: { emitBundlerPluginExecutionSignal: () => Promise<void> };
  createRelease: () => Promise<void>;
  uploadSourcemaps: (paths: string[]) => Promise<void>;
};

const requireFromWeb = createRequire(path.join(__dirname, '../../web/package.json'));
const { createSentryBuildPluginManager } = requireFromWeb('@sentry/bundler-plugin-core') as {
  createSentryBuildPluginManager: (
    options: Record<string, unknown>,
    context: { buildTool: string; loggerPrefix: string },
  ) => SentryBuildPluginManager;
};

describe('Sentry build upload guard', () => {
  test.each(['1', 'true', 'TRUE', ' yes ', 'on'])(
    'treats %p as an authoritative upload disable value',
    (value) => {
      expect(isSentryUploadDisabled(value)).toBe(true);
    },
  );

  test.each([undefined, '', '0', 'false', 'off'])(
    'does not disable configured release builds for %p',
    (value) => {
      expect(isSentryUploadDisabled(value)).toBe(false);
    },
  );

  it('blocks token fallback, telemetry, release mutation, and sourcemap upload when disabled', () => {
    expect(resolveSentryBuildUploadPolicy('1', 'configured-token')).toEqual({
      disabled: true,
      authToken: '',
      telemetry: false,
      useRunAfterProductionCompileHook: false,
      release: { create: false, finalize: false },
      sourcemaps: { disable: true },
    });
  });

  it('preserves configured release-build behavior when the guard is inactive', () => {
    expect(resolveSentryBuildUploadPolicy(undefined, 'configured-token')).toEqual({
      disabled: false,
      authToken: 'configured-token',
      telemetry: undefined,
      useRunAfterProductionCompileHook: undefined,
      release: undefined,
      sourcemaps: { disable: false },
    });
  });

  it('prevents the installed Sentry plugin from recovering an environment token or sending to loopback', async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const previousAuthToken = mutableEnv.SENTRY_AUTH_TOKEN;
    const previousNodeEnv = mutableEnv.NODE_ENV;
    let requestCount = 0;
    const server = http.createServer((_request, response) => {
      requestCount += 1;
      response.statusCode = 500;
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      mutableEnv.SENTRY_AUTH_TOKEN = 'sentinel-nonsecret';
      mutableEnv.NODE_ENV = 'production';
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a loopback TCP address');
      }

      const policy = resolveSentryBuildUploadPolicy('1', mutableEnv.SENTRY_AUTH_TOKEN);
      const manager = createSentryBuildPluginManager({
        authToken: policy.authToken,
        telemetry: policy.telemetry,
        release: policy.release,
        sourcemaps: policy.sourcemaps,
        org: 'test-org',
        project: 'test-project',
        url: `http://127.0.0.1:${address.port}`,
        silent: true,
      }, {
        buildTool: 'webpack',
        loggerPrefix: '[sentry-build-upload-guard-test]',
      });

      expect(manager.normalizedOptions.authToken).toBe('');
      expect(manager.normalizedOptions.telemetry).toBe(false);
      expect(manager.normalizedOptions.release.create).toBe(false);
      expect(manager.normalizedOptions.release.finalize).toBe(false);
      expect(manager.normalizedOptions.sourcemaps?.disable).toBe(true);

      await manager.telemetry.emitBundlerPluginExecutionSignal();
      await manager.createRelease();
      await manager.uploadSourcemaps([]);
      expect(requestCount).toBe(0);
    } finally {
      if (previousAuthToken === undefined) {
        delete mutableEnv.SENTRY_AUTH_TOKEN;
      } else {
        mutableEnv.SENTRY_AUTH_TOKEN = previousAuthToken;
      }
      if (previousNodeEnv === undefined) {
        delete mutableEnv.NODE_ENV;
      } else {
        mutableEnv.NODE_ENV = previousNodeEnv;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('wires every disabled-build control into the Next.js Sentry options', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../web/next.config.ts'), 'utf8');

    expect(source).toContain('resolveSentryBuildUploadPolicy(');
    expect(source).toContain('authToken: sentryBuildUploadPolicy.authToken');
    expect(source).toContain('telemetry: sentryBuildUploadPolicy.telemetry');
    expect(source).toContain(
      'useRunAfterProductionCompileHook: sentryBuildUploadPolicy.useRunAfterProductionCompileHook',
    );
    expect(source).toContain('release: sentryBuildUploadPolicy.release');
    expect(source).toContain('sourcemaps: sentryBuildUploadPolicy.sourcemaps');
  });
});
