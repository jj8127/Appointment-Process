jest.mock('expo-application', () => ({
  nativeApplicationVersion: '4.2.19',
  nativeBuildVersion: '4219',
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '4.2.19', android: { versionCode: 4219 } } },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import {
  buildSignupClientHeaders,
  SIGNUP_AUTH_PROTOCOL,
  SIGNUP_CLIENT_HEADER_NAMES,
} from '../signup-client-metadata';

describe('signup client release metadata', () => {
  it('emits bounded non-authoritative release headers', () => {
    expect(buildSignupClientHeaders({
      platform: 'android',
      appVersion: '4.2.19',
      buildNumber: '4219',
    })).toEqual({
      [SIGNUP_CLIENT_HEADER_NAMES.platform]: 'android',
      [SIGNUP_CLIENT_HEADER_NAMES.appVersion]: '4.2.19',
      [SIGNUP_CLIENT_HEADER_NAMES.buildNumber]: '4219',
      [SIGNUP_CLIENT_HEADER_NAMES.protocol]: SIGNUP_AUTH_PROTOCOL,
    });
  });

  it('replaces arbitrary values instead of forwarding them to Edge logs', () => {
    expect(buildSignupClientHeaders({
      platform: 'private-device',
      appVersion: '4.2.19\nprivate',
      buildNumber: 'x'.repeat(33),
    })).toEqual({
      [SIGNUP_CLIENT_HEADER_NAMES.platform]: 'unknown',
      [SIGNUP_CLIENT_HEADER_NAMES.appVersion]: 'unknown',
      [SIGNUP_CLIENT_HEADER_NAMES.buildNumber]: 'unknown',
      [SIGNUP_CLIENT_HEADER_NAMES.protocol]: SIGNUP_AUTH_PROTOCOL,
    });
  });
});
