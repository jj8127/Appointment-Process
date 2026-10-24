import {
  reportEdgeDiagnostic,
  type EdgeDiagnosticWriter,
} from './edge-diagnostic.ts';

export const SIGNUP_AUTH_PROTOCOL = 'signup-capability-v1';
export const SIGNUP_CLIENT_HEADERS = {
  platform: 'x-moduon-platform',
  appVersion: 'x-moduon-app-version',
  buildNumber: 'x-moduon-build-number',
  protocol: 'x-moduon-signup-protocol',
} as const;

const SAFE_RELEASE_VALUE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

function safeReleaseValue(value: string | null): string | undefined {
  const normalized = String(value ?? '').trim();
  return SAFE_RELEASE_VALUE.test(normalized) ? normalized : undefined;
}

export function reportSignupClientObservation(
  request: Request,
  diagnostic: EdgeDiagnosticWriter = reportEdgeDiagnostic,
): void {
  const rawProtocol = request.headers.get(SIGNUP_CLIENT_HEADERS.protocol)?.trim() ?? '';
  const platformHeader = request.headers.get(SIGNUP_CLIENT_HEADERS.platform)?.trim() ?? '';
  const platform = platformHeader === 'android' || platformHeader === 'ios' || platformHeader === 'web'
    ? platformHeader
    : 'unknown';
  const reason = rawProtocol === SIGNUP_AUTH_PROTOCOL
    ? 'capability_v1'
    : rawProtocol === ''
      ? 'legacy'
      : 'invalid';

  diagnostic({
    event: 'signup.client_protocol',
    reason,
    platform,
    appVersion: safeReleaseValue(request.headers.get(SIGNUP_CLIENT_HEADERS.appVersion)),
    buildNumber: safeReleaseValue(request.headers.get(SIGNUP_CLIENT_HEADERS.buildNumber)),
  });
}
