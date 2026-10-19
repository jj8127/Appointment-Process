import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

import {
  createMigratingSensitiveTokenStorage,
  type SensitiveTokenStorage,
} from '../secure-token-storage';

// Preserve installed legacy SecureStore key compatibility after retiring its client screen.
const SIGNUP_COMPLETION_TOKEN_STORAGE_KEY = 'fc-onboarding.signup-completion-token-v1';

jest.mock('../safe-storage', () => ({
  safeStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

const createMemoryStorage = (
  initial: Record<string, string> = {},
): SensitiveTokenStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
};

describe('sensitive token storage migration', () => {
  it('can delete, save, read, and clear the signup capability through the actual SecureStore key contract', async () => {
    const nativeValues = new Map<string, string>();
    const nativeBacking = {
      getValueWithKeyAsync: jest.fn(async (key: string) => nativeValues.get(key) ?? null),
      setValueWithKeyAsync: jest.fn(async (value: string, key: string) => { nativeValues.set(key, value); }),
      deleteValueWithKeyAsync: jest.fn(async (key: string) => { nativeValues.delete(key); }),
    };
    const sdkRoot = path.dirname(require.resolve('expo-secure-store/package.json'));
    const byteCounter: Record<string, unknown> = {};
    const sdk = {} as {
      getItemAsync: (key: string) => Promise<string | null>;
      setItemAsync: (key: string, value: string) => Promise<void>;
      deleteItemAsync: (key: string) => Promise<void>;
    };
    // Execute the installed SDK validators; only the native backing is replaced.
    const compile = (file: string) => ts.transpileModule(
      fs.readFileSync(path.join(sdkRoot, 'src', file), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
    ).outputText;
    new Function('exports', compile('byteCounter.ts'))(byteCounter);
    new Function('require', 'exports', compile('SecureStore.ts'))((name: string) => {
      if (name === './ExpoSecureStore') return { default: nativeBacking };
      if (name === './byteCounter') return byteCounter;
      throw new Error('Unexpected SecureStore dependency');
    }, sdk);
    const storage = createMigratingSensitiveTokenStorage({
      getItem: sdk.getItemAsync,
      setItem: sdk.setItemAsync,
      removeItem: sdk.deleteItemAsync,
    }, createMemoryStorage());
    const token = 'A'.repeat(43);
    await storage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY);
    await storage.setItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY, token);
    await expect(storage.getItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY)).resolves.toBe(token);
    await storage.removeItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY);
    await expect(storage.getItem(SIGNUP_COMPLETION_TOKEN_STORAGE_KEY)).resolves.toBeNull();
    expect(nativeBacking.setValueWithKeyAsync).toHaveBeenCalledWith(
      token, SIGNUP_COMPLETION_TOKEN_STORAGE_KEY, {},
    );
  });

  it('moves a legacy plaintext token to primary storage and deletes the old copy', async () => {
    const primary = createMemoryStorage();
    const legacy = createMemoryStorage({ session: 'signed-token' });
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await expect(storage.getItem('session')).resolves.toBe('signed-token');
    expect(primary.values.get('session')).toBe('signed-token');
    expect(legacy.values.has('session')).toBe(false);
  });

  it('prefers the secured copy and deletes a stale legacy duplicate', async () => {
    const primary = createMemoryStorage({ session: 'current-token' });
    const legacy = createMemoryStorage({ session: 'stale-token' });
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await expect(storage.getItem('session')).resolves.toBe('current-token');
    expect(legacy.values.has('session')).toBe(false);
  });

  it('writes and removes both storage generations without leaving a plaintext copy', async () => {
    const primary = createMemoryStorage();
    const legacy = createMemoryStorage({ session: 'old-token' });
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await storage.setItem('session', 'new-token');
    expect(primary.values.get('session')).toBe('new-token');
    expect(legacy.values.has('session')).toBe(false);

    await storage.removeItem('session');
    expect(primary.values.has('session')).toBe(false);
    expect(legacy.values.has('session')).toBe(false);
  });

  it('fails closed and deletes the plaintext copy when secure migration is unavailable', async () => {
    const primary = createMemoryStorage();
    primary.setItem = async () => {
      throw new Error('secure storage unavailable');
    };
    const legacy = createMemoryStorage({ session: 'legacy-token' });
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await expect(storage.getItem('session')).resolves.toBeNull();
    expect(legacy.values.has('session')).toBe(false);
  });

  it('deletes the plaintext copy and returns no token when secure reads fail', async () => {
    const primary = createMemoryStorage();
    primary.getItem = async () => {
      throw new Error('secure read unavailable');
    };
    const legacy = createMemoryStorage({ session: 'legacy-token' });
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await expect(storage.getItem('session')).resolves.toBeNull();
    expect(legacy.values.has('session')).toBe(false);
  });

  it('does not hide a stale plaintext cleanup failure after a secure read', async () => {
    const primary = createMemoryStorage({ session: 'secure-token' });
    const legacy = createMemoryStorage({ session: 'legacy-token' });
    legacy.removeItem = async () => {
      throw new Error('legacy cleanup unavailable');
    };
    const storage = createMigratingSensitiveTokenStorage(primary, legacy);

    await expect(storage.getItem('session')).rejects.toThrow(
      '민감 세션의 기존 저장 사본을 삭제하지 못했습니다.',
    );
  });

  it('routes every Request Board credential through the sensitive storage boundary', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'request-board-api.ts'),
      'utf8',
    );

    for (const key of [
      'STORAGE_KEY_TOKEN',
      'STORAGE_KEY_BRIDGE_TOKEN',
      'STORAGE_KEY_APP_SESSION_TOKEN',
    ]) {
      expect(source).toContain(`sensitiveTokenStorage.getItem(${key})`);
    }
    expect(source).toContain('sensitiveTokenStorage.setItem(STORAGE_KEY_TOKEN, token)');
    expect(source).toContain('sensitiveTokenStorage.setItem(STORAGE_KEY_BRIDGE_TOKEN, token)');
    expect(source).toContain('sensitiveTokenStorage.setItem(STORAGE_KEY_APP_SESSION_TOKEN, token)');
    expect(source).toContain('safeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user))');
  });
});
