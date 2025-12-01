type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type Driver = 'async-storage' | 'secure-store' | 'file' | 'memory';

const memoryStore = new Map<string, string>();

const memoryAdapter: StorageAdapter = {
  async getItem(key) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  async setItem(key, value) {
    memoryStore.set(key, value);
  },
  async removeItem(key) {
    memoryStore.delete(key);
  },
};

let adapter: StorageAdapter = memoryAdapter;
let driver: Driver = 'memory';

try {
  // The require is wrapped so we can gracefully fallback when the native module is missing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const asyncStorage = require('@react-native-async-storage/async-storage')
    .default as StorageAdapter | undefined;
  if (asyncStorage?.setItem) {
    adapter = asyncStorage;
    driver = 'async-storage';
  }
} catch (err) {
  console.warn('[storage] AsyncStorage unavailable, falling back.', err);
}

if (driver === 'memory') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    const secureAdapter: StorageAdapter = {
      async getItem(key) {
        try {
          return await SecureStore.getItemAsync(key);
        } catch (err) {
          console.warn('[storage] SecureStore get failed, using memory fallback.', err);
          return memoryAdapter.getItem(key);
        }
      },
      async setItem(key, value) {
        try {
          await SecureStore.setItemAsync(key, value);
        } catch (err) {
          console.warn('[storage] SecureStore set failed, using memory fallback.', err);
          await memoryAdapter.setItem(key, value);
        }
      },
      async removeItem(key) {
        try {
          await SecureStore.deleteItemAsync(key);
        } catch (err) {
          console.warn('[storage] SecureStore remove failed, using memory fallback.', err);
          await memoryAdapter.removeItem(key);
        }
      },
    };
    adapter = secureAdapter;
    driver = 'secure-store';
  } catch (err) {
    console.warn('[storage] SecureStore unavailable, trying file-based storage.', err);
  }
}

if (driver === 'memory') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
    const filePath = `${FileSystem.documentDirectory ?? ''}safe-storage.json`;

    const readStore = async () => {
      try {
        const info = await FileSystem.getInfoAsync(filePath);
        if (!info.exists) return {};
        const raw = await FileSystem.readAsStringAsync(filePath);
        return raw ? (JSON.parse(raw) as Record<string, string>) : {};
      } catch (err) {
        console.warn('[storage] File read failed, using memory in the meantime.', err);
        return {};
      }
    };

    const writeStore = async (data: Record<string, string>) => {
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(data));
    };

    const fileAdapter: StorageAdapter = {
      async getItem(key) {
        const data = await readStore();
        return key in data ? data[key] : null;
      },
      async setItem(key, value) {
        const data = await readStore();
        data[key] = value;
        await writeStore(data);
      },
      async removeItem(key) {
        const data = await readStore();
        delete data[key];
        await writeStore(data);
      },
    };

    adapter = fileAdapter;
    driver = 'file';
  } catch (err) {
    console.warn('[storage] FileSystem unavailable, using in-memory fallback only.', err);
  }
}

export const safeStorage = adapter;
export const storageDriver = driver;
