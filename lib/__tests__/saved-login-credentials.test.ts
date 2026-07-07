import {
  clearSavedLoginCredentials,
  getSavedLoginCredentials,
  setSavedLoginCredentials,
  type LoginCredentialStorage,
} from '../saved-login-credentials';

function createMemoryStorage(initial: Record<string, string> = {}): LoginCredentialStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

describe('saved login credentials', () => {
  it('persists normalized phone and trimmed password only when remember password is enabled', async () => {
    const storage = createMemoryStorage();

    await setSavedLoginCredentials(
      { rememberPassword: true, phone: '010-1234-5678', password: '  pass1234!  ' },
      storage,
    );

    await expect(getSavedLoginCredentials(storage)).resolves.toEqual({
      rememberPassword: true,
      phone: '01012345678',
      password: 'pass1234!',
    });
  });

  it('clears stored credentials when remember password is disabled', async () => {
    const storage = createMemoryStorage();

    await setSavedLoginCredentials(
      { rememberPassword: true, phone: '01012345678', password: 'pass1234!' },
      storage,
    );
    await setSavedLoginCredentials(
      { rememberPassword: false, phone: '01012345678', password: 'pass1234!' },
      storage,
    );

    await expect(getSavedLoginCredentials(storage)).resolves.toBeNull();
  });

  it('drops malformed stored payloads instead of hydrating broken credentials', async () => {
    const storage = createMemoryStorage({
      'garamin.saved-login-credentials.v1': '{bad-json',
    });

    await expect(getSavedLoginCredentials(storage)).resolves.toBeNull();
    expect(storage.data.has('garamin.saved-login-credentials.v1')).toBe(false);
  });

  it('clears saved credentials explicitly', async () => {
    const storage = createMemoryStorage();
    await setSavedLoginCredentials(
      { rememberPassword: true, phone: '01012345678', password: 'pass1234!' },
      storage,
    );

    await clearSavedLoginCredentials(storage);

    await expect(getSavedLoginCredentials(storage)).resolves.toBeNull();
  });

  it('does not fall back to insecure storage when secure credential storage is unavailable', async () => {
    await expect(getSavedLoginCredentials(null)).resolves.toBeNull();
    await expect(
      setSavedLoginCredentials(
        { rememberPassword: true, phone: '01012345678', password: 'pass1234!' },
        null,
      ),
    ).resolves.toBeUndefined();
    await expect(clearSavedLoginCredentials(null)).resolves.toBeUndefined();
  });
});
