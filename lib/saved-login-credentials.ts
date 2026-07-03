import { logger } from './logger';
import { normalizePhone } from './validation';

export type LoginCredentialStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SavedLoginCredentials = {
  rememberPassword: true;
  phone: string;
  password: string;
};

type SaveLoginCredentialsInput = {
  rememberPassword: boolean;
  phone: string;
  password: string;
};

const SAVED_LOGIN_CREDENTIALS_KEY = 'garamin.saved-login-credentials.v1';

let defaultStorage: LoginCredentialStorage | null | undefined;

function createSecureStoreAdapter(): LoginCredentialStorage | null {
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
  } catch (err) {
    logger.warn('[saved-login] SecureStore unavailable, falling back to safe storage.', err);
    return null;
  }
}

function getDefaultStorage(): LoginCredentialStorage | null {
  if (defaultStorage === undefined) {
    defaultStorage = createSecureStoreAdapter();
  }
  return defaultStorage;
}

function parseSavedCredentials(raw: string | null): SavedLoginCredentials | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedLoginCredentials>;
    if (parsed.rememberPassword !== true) return null;
    if (typeof parsed.phone !== 'string' || !parsed.phone.trim()) return null;
    if (typeof parsed.password !== 'string' || !parsed.password.trim()) return null;

    return {
      rememberPassword: true,
      phone: normalizePhone(parsed.phone),
      password: parsed.password.trim(),
    };
  } catch {
    return null;
  }
}

export async function getSavedLoginCredentials(
  storage: LoginCredentialStorage | null = getDefaultStorage(),
): Promise<SavedLoginCredentials | null> {
  if (!storage) return null;

  const raw = await storage.getItem(SAVED_LOGIN_CREDENTIALS_KEY);
  const saved = parseSavedCredentials(raw);
  if (!saved && raw) {
    await storage.removeItem(SAVED_LOGIN_CREDENTIALS_KEY);
  }
  return saved;
}

export async function clearSavedLoginCredentials(
  storage: LoginCredentialStorage | null = getDefaultStorage(),
): Promise<void> {
  if (!storage) return;
  await storage.removeItem(SAVED_LOGIN_CREDENTIALS_KEY);
}

export async function setSavedLoginCredentials(
  input: SaveLoginCredentialsInput,
  storage: LoginCredentialStorage | null = getDefaultStorage(),
): Promise<void> {
  if (!storage) return;

  if (!input.rememberPassword) {
    await clearSavedLoginCredentials(storage);
    return;
  }

  const phone = normalizePhone(input.phone);
  const password = input.password.trim();

  if (!phone || !password) {
    await clearSavedLoginCredentials(storage);
    return;
  }

  const payload: SavedLoginCredentials = {
    rememberPassword: true,
    phone,
    password,
  };

  await storage.setItem(SAVED_LOGIN_CREDENTIALS_KEY, JSON.stringify(payload));
}
