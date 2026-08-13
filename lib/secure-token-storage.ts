import { logger } from './logger';
import { safeStorage } from './safe-storage';

export type SensitiveTokenStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memoryValues = new Map<string, string>();
const memoryOnlyStorage: SensitiveTokenStorage = {
  async getItem(key) {
    return memoryValues.get(key) ?? null;
  },
  async setItem(key, value) {
    memoryValues.set(key, value);
  },
  async removeItem(key) {
    memoryValues.delete(key);
  },
};

export function createMigratingSensitiveTokenStorage(
  primary: SensitiveTokenStorage,
  legacy: SensitiveTokenStorage,
): SensitiveTokenStorage {
  return {
    async getItem(key) {
      let securedValue: string | null;
      try {
        securedValue = await primary.getItem(key);
      } catch {
        const removed = await legacy.removeItem(key)
          .then(() => true)
          .catch(() => false);
        if (!removed) {
          logger.warn('[secure-token-storage] Legacy token cleanup failed after secure read failure.');
        }
        return null;
      }
      if (securedValue) {
        try {
          await legacy.removeItem(key);
        } catch {
          logger.warn('[secure-token-storage] Legacy token cleanup failed after secure read.');
          throw new Error('민감 세션의 기존 저장 사본을 삭제하지 못했습니다.');
        }
        return securedValue;
      }

      const legacyValue = await legacy.getItem(key);
      if (!legacyValue) return null;

      try {
        await primary.setItem(key, legacyValue);
      } catch {
        await legacy.removeItem(key);
        return null;
      }
      await legacy.removeItem(key);
      return legacyValue;
    },
    async setItem(key, value) {
      try {
        await primary.setItem(key, value);
      } catch {
        await legacy.removeItem(key);
        throw new Error('민감 세션 정보를 안전하게 저장하지 못했습니다.');
      }
      await legacy.removeItem(key);
    },
    async removeItem(key) {
      const results = await Promise.allSettled([
        primary.removeItem(key),
        legacy.removeItem(key),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('민감 세션 정보를 안전하게 삭제하지 못했습니다.');
      }
    },
  };
}

function createNativeSecureStoreAdapter(): SensitiveTokenStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    if (!SecureStore?.getItemAsync || !SecureStore?.setItemAsync || !SecureStore?.deleteItemAsync) {
      return null;
    }
    return {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    };
  } catch {
    return null;
  }
}

let defaultStorage: SensitiveTokenStorage | null = null;

export function getSensitiveTokenStorage(): SensitiveTokenStorage {
  if (defaultStorage) return defaultStorage;

  if (typeof document !== 'undefined') {
    defaultStorage = safeStorage;
    return defaultStorage;
  }

  const secureStore = createNativeSecureStoreAdapter();
  if (!secureStore) {
    logger.warn('[secure-token-storage] SecureStore unavailable; using memory-only token storage.');
  }
  defaultStorage = createMigratingSensitiveTokenStorage(
    secureStore ?? memoryOnlyStorage,
    safeStorage,
  );
  return defaultStorage;
}

export const sensitiveTokenStorage: SensitiveTokenStorage = {
  getItem: (key) => getSensitiveTokenStorage().getItem(key),
  setItem: (key, value) => getSensitiveTokenStorage().setItem(key, value),
  removeItem: (key) => getSensitiveTokenStorage().removeItem(key),
};
