import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const SIGNUP_AUTH_PROTOCOL = 'signup-capability-v1';
export const SIGNUP_CLIENT_HEADER_NAMES = {
  platform: 'x-moduon-platform',
  appVersion: 'x-moduon-app-version',
  buildNumber: 'x-moduon-build-number',
  protocol: 'x-moduon-signup-protocol',
} as const;

type SignupClientMetadata = Readonly<{
  platform: string | null | undefined;
  appVersion: string | null | undefined;
  buildNumber: string | null | undefined;
}>;

const SAFE_RELEASE_VALUE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

function safeReleaseValue(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return SAFE_RELEASE_VALUE.test(normalized) ? normalized : 'unknown';
}

export function buildSignupClientHeaders(metadata: SignupClientMetadata): Record<string, string> {
  const platform = ['android', 'ios', 'web'].includes(String(metadata.platform))
    ? String(metadata.platform)
    : 'unknown';
  return {
    [SIGNUP_CLIENT_HEADER_NAMES.platform]: platform,
    [SIGNUP_CLIENT_HEADER_NAMES.appVersion]: safeReleaseValue(metadata.appVersion),
    [SIGNUP_CLIENT_HEADER_NAMES.buildNumber]: safeReleaseValue(metadata.buildNumber),
    [SIGNUP_CLIENT_HEADER_NAMES.protocol]: SIGNUP_AUTH_PROTOCOL,
  };
}

/** Release telemetry only; the completion capability remains the security boundary. */
export function signupClientHeaders(): Record<string, string> {
  const configuredBuild = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Platform.OS === 'android'
      ? Constants.expoConfig?.android?.versionCode?.toString()
      : null;
  return buildSignupClientHeaders({
    platform: Platform.OS,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
    buildNumber: Application.nativeBuildVersion ?? configuredBuild,
  });
}
