const getStoredAppSessionTokenMock = jest.fn();
const invokeMock = jest.fn();
const getPermissionsAsyncMock = jest.fn();
const requestPermissionsAsyncMock = jest.fn();
const getExpoPushTokenAsyncMock = jest.fn();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: 'standalone',
    expoConfig: { extra: { eas: { projectId: 'test-project' } } },
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Linking: { openSettings: jest.fn() },
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: getPermissionsAsyncMock,
  requestPermissionsAsync: requestPermissionsAsyncMock,
  getExpoPushTokenAsync: getExpoPushTokenAsyncMock,
}));

jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: getStoredAppSessionTokenMock,
}));

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

// The module must load after Jest installs its native-module mocks.
// eslint-disable-next-line import/first
import {
  getPushPermissionStatus,
  registerPushToken,
  unregisterAllPushTokens,
} from '../notifications';

describe('registerPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPermissionsAsyncMock.mockResolvedValue({ status: 'granted' });
    getExpoPushTokenAsyncMock.mockResolvedValue({ data: 'ExponentPushToken[test]' });
    getStoredAppSessionTokenMock.mockResolvedValue('session-token');
    invokeMock.mockResolvedValue({ data: { ok: true, role: 'fc' }, error: null });
  });

  test('reports a confirmed trusted registration', async () => {
    await expect(registerPushToken('fc', '01000000000', '테스트')).resolves.toEqual({
      ok: true,
      retryable: false,
      reason: 'registered',
    });
  });

  test('treats a temporarily missing app session as retryable', async () => {
    getStoredAppSessionTokenMock.mockResolvedValue(null);

    await expect(registerPushToken('fc', '01000000000', '테스트')).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'session_unavailable',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test('never prompts unless permission request is explicitly enabled', async () => {
    getPermissionsAsyncMock.mockResolvedValue({ status: 'denied' });
    requestPermissionsAsyncMock.mockResolvedValue({ status: 'denied' });

    await expect(registerPushToken('fc', '01000000000', '테스트')).resolves.toEqual({
      ok: false,
      retryable: false,
      reason: 'permission_denied',
    });
    expect(requestPermissionsAsyncMock).not.toHaveBeenCalled();
    expect(getExpoPushTokenAsyncMock).not.toHaveBeenCalled();
  });

  test('requests permission only for an explicit master-ON action', async () => {
    getPermissionsAsyncMock.mockResolvedValue({ status: 'undetermined' });
    requestPermissionsAsyncMock.mockResolvedValue({ status: 'granted' });

    await expect(registerPushToken(
      'fc',
      '01000000000',
      'Test User',
      undefined,
      { requestPermission: true },
    )).resolves.toEqual({ ok: true, retryable: false, reason: 'registered' });
    expect(requestPermissionsAsyncMock).toHaveBeenCalledTimes(1);
  });

  test('reports current permission without requesting it', async () => {
    getPermissionsAsyncMock.mockResolvedValue({ status: 'undetermined' });
    await expect(getPushPermissionStatus()).resolves.toBe('undetermined');
    expect(requestPermissionsAsyncMock).not.toHaveBeenCalled();
  });

  test('unregisters every token for the signed actor through the trusted function', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(unregisterAllPushTokens()).resolves.toEqual({
      ok: true,
      retryable: false,
      reason: 'unregistered',
    });
    expect(invokeMock).toHaveBeenCalledWith('device-token-register', expect.objectContaining({
      method: 'DELETE',
      body: { disableAll: true },
      headers: { 'x-app-session-token': 'session-token' },
    }));
  });

  test('returns a retryable result when trusted registration fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError' } });

    await expect(registerPushToken('fc', '01000000000', '테스트')).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'registration_failed',
    });
  });

  test('requires an explicit success acknowledgement from the registration function', async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await expect(registerPushToken('fc', '01000000000', '테스트')).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'registration_failed',
    });
  });
});
