import fs from 'fs';
import path from 'path';

import {
  createMigratingSensitiveTokenStorage,
  type SensitiveTokenStorage,
} from '../secure-token-storage';

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
