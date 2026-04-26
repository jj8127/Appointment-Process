type RequestBoardMessengerReadyConfig = {
  available: true;
  baseUrl: string;
  messengerUrl: string;
  source: 'env';
};

type RequestBoardMessengerDisabledConfig = {
  available: false;
  baseUrl: null;
  messengerUrl: null;
  reason: 'missing-public-url' | 'invalid-public-url';
};

export type RequestBoardMessengerConfig =
  | RequestBoardMessengerReadyConfig
  | RequestBoardMessengerDisabledConfig;

const normalizeRequestBoardBaseUrl = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

export const resolveRequestBoardMessengerConfig = (input?: {
  requestBoardUrl?: string | null;
}): RequestBoardMessengerConfig => {
  const rawRequestBoardUrl = String(input?.requestBoardUrl ?? '').trim();
  const configuredBaseUrl = normalizeRequestBoardBaseUrl(rawRequestBoardUrl);

  if (configuredBaseUrl) {
    return {
      available: true,
      baseUrl: configuredBaseUrl,
      messengerUrl: `${configuredBaseUrl}/m/chat`,
      source: 'env',
    };
  }

  if (rawRequestBoardUrl) {
    return {
      available: false,
      baseUrl: null,
      messengerUrl: null,
      reason: 'invalid-public-url',
    };
  }

  return {
    available: false,
    baseUrl: null,
    messengerUrl: null,
    reason: 'missing-public-url',
  };
};
