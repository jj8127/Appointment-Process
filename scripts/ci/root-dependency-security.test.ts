import { createRequire } from 'node:module';
import path from 'node:path';

type PackageLockEntry = {
  dev?: boolean;
  version?: string;
};

type PackageLock = {
  packages: Record<string, PackageLockEntry>;
};

type RootPackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, unknown>;
  scripts: Record<string, string>;
};

const repoRoot = path.resolve(__dirname, '../..');
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));
const packageJson = requireFromRoot('./package.json') as RootPackage;
const packageLock = requireFromRoot('./package-lock.json') as PackageLock;

const installedVersion = (name: string): string | undefined =>
  packageLock.packages[`node_modules/${name}`]?.version;

describe('FC root dependency security contract', () => {
  it('enables the Node 20 WebSocket runtime for static Expo exports', () => {
    expect(packageJson.scripts.build).toBe(
      'node --experimental-websocket ./node_modules/expo/bin/cli export --platform web',
    );
    expect(packageJson.devDependencies['babel-preset-expo']).toBe('~54.0.12');
    expect(installedVersion('babel-preset-expo')).toBe('54.0.12');
  });

  it('keeps Expo 54 runtime dependencies on the supported compatibility line', () => {
    expect(packageJson.dependencies).toMatchObject({
      '@sentry/react-native': '7.2.0',
      '@supabase/supabase-js': '2.109.0',
      expo: '~54.0.36',
      'expo-router': '~6.0.24',
      'react-native-screens': '~4.16.0',
      'react-native-webview': '13.15.0',
      ws: '8.21.1',
    });

    expect(installedVersion('expo')).toBe('54.0.36');
    expect(installedVersion('@sentry/react-native')).toBe('7.2.0');
    expect(installedVersion('@supabase/supabase-js')).toBe('2.109.0');
    expect(installedVersion('ws')).toBe('8.21.1');
  });

  it('excludes the unused native picker that crashes RN 0.81 Fabric startup', () => {
    expect(packageJson.dependencies['@react-native-picker/picker']).toBeUndefined();
    expect(packageLock.packages['node_modules/@react-native-picker/picker']).toBeUndefined();
  });

  it('keeps Expo MCP outside the production dependency graph', () => {
    expect(packageJson.dependencies['expo-mcp']).toBeUndefined();
    expect(packageJson.devDependencies['expo-mcp']).toBe('~0.2.4');
    expect(packageLock.packages['node_modules/expo-mcp']).toMatchObject({
      dev: true,
      version: '0.2.4',
    });
    expect(packageLock.packages['node_modules/@modelcontextprotocol/sdk']).toMatchObject({
      dev: true,
      version: '1.30.0',
    });
  });

  it('pins compatible patched transitives without changing the Expo runtime line', () => {
    expect(packageJson.overrides).toEqual({
      expo: {
        'node-forge': '1.4.0',
        postcss: '8.5.26',
        tar: '7.5.22',
        undici: '6.28.0',
        uuid: '11.1.1',
      },
      'expo-mcp': {
        '@modelcontextprotocol/sdk': '1.30.0',
      },
      '@hono/node-server': '2.1.0',
      hono: '4.13.1',
      'ip-address': '10.4.0',
      'fast-uri': '3.1.5',
      'js-yaml': '4.3.1',
      nanoid: '3.3.18',
      'minimatch@3.1.5': {
        'brace-expansion': '1.1.18',
      },
      'minimatch@9.0.9': {
        'brace-expansion': '2.1.4',
      },
      'minimatch@10.2.5': {
        'brace-expansion': '5.0.9',
      },
      'expo-updates': {
        'node-forge': '1.4.0',
      },
      'react-native': {
        'react-devtools-core': {
          'shell-quote': '1.10.0',
        },
      },
      'sp-react-native-in-app-updates': {
        axios: '1.18.1',
        underscore: '1.13.8',
      },
      'ts-jest': {
        handlebars: '4.7.9',
      },
    });

    expect({
      '@hono/node-server': installedVersion('@hono/node-server'),
      '@modelcontextprotocol/sdk': installedVersion('@modelcontextprotocol/sdk'),
      axios: installedVersion('axios'),
      'fast-uri': installedVersion('fast-uri'),
      handlebars: installedVersion('handlebars'),
      hono: installedVersion('hono'),
      'ip-address': installedVersion('ip-address'),
      'js-yaml': installedVersion('js-yaml'),
      nanoid: installedVersion('nanoid'),
      'node-forge': installedVersion('node-forge'),
      postcss: installedVersion('postcss'),
      'react-native-device-info': installedVersion('react-native-device-info'),
      'react-native-siren/react-native-device-info':
        packageLock.packages[
          'node_modules/react-native-siren/node_modules/react-native-device-info'
        ]?.version,
      'shell-quote': installedVersion('shell-quote'),
      tar: installedVersion('tar'),
      undici: installedVersion('undici'),
      underscore: installedVersion('underscore'),
      uuid: installedVersion('uuid'),
    }).toEqual({
      '@hono/node-server': '2.1.0',
      '@modelcontextprotocol/sdk': '1.30.0',
      axios: '1.18.1',
      'fast-uri': '3.1.5',
      handlebars: '4.7.9',
      hono: '4.13.1',
      'ip-address': '10.4.0',
      'js-yaml': '4.3.1',
      nanoid: '3.3.18',
      'node-forge': '1.4.0',
      postcss: '8.5.26',
      'react-native-device-info': '10.3.0',
      'react-native-siren/react-native-device-info': '8.7.1',
      'shell-quote': '1.10.0',
      tar: '7.5.22',
      undici: '6.28.0',
      underscore: '1.13.8',
      uuid: '11.1.1',
    });
    expect(
      Object.keys(packageLock.packages).filter((entry) =>
        entry.endsWith('node_modules/react-native-device-info'),
      ),
    ).toEqual([
      'node_modules/react-native-device-info',
      'node_modules/react-native-siren/node_modules/react-native-device-info',
    ]);
  });

  it('loads the patched CommonJS runtime surface used by Expo tooling', () => {
    const handlebars = requireFromRoot('handlebars') as {
      compile: (source: string) => (context: Record<string, string>) => string;
    };
    const postcss = requireFromRoot('postcss') as {
      parse: (source: string) => { first?: { prop?: string } };
    };
    const uuid = requireFromRoot('uuid') as { v4: () => string };
    const xcode = requireFromRoot('xcode') as { project: (file: string) => unknown };

    expect(handlebars.compile('Hello {{name}}')({ name: 'FC' })).toBe('Hello FC');
    expect(postcss.parse('a { color: red }').first?.prop).toBeUndefined();
    expect(uuid.v4()).toMatch(/^[0-9a-f-]{36}$/i);
    expect(typeof xcode.project).toBe('function');
  });

  it('creates a local-only Supabase client with the explicit Node 20 WebSocket transport', () => {
    const { createClient } = requireFromRoot('@supabase/supabase-js') as {
      createClient: (
        url: string,
        key: string,
        options: Record<string, unknown>,
      ) => { from: (table: string) => unknown };
    };
    const WebSocket = requireFromRoot('ws');
    const client = createClient('http://127.0.0.1:54321', 'local-anon-placeholder', {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      realtime: {
        transport: WebSocket,
      },
    });

    expect(typeof client.from).toBe('function');
    expect(client.from('dependency_contract')).toBeDefined();
  });
});
