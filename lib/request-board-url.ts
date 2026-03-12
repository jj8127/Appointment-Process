import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { logger } from './logger';

const REQUEST_BOARD_PRODUCTION_URL = 'https://requestboard-steel.vercel.app';
const REQUEST_BOARD_DEV_API_PORT = '3000';
const REQUEST_BOARD_DEV_WEB_PORT = '5173';

let loggedApiBaseUrl = false;
let loggedWebBaseUrl = false;

const normalizeConfiguredUrl = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, '');
};

const extractHost = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//i, '');
  const authority = withoutProtocol.split('/')[0]?.trim() ?? '';
  const host = authority.split(':')[0]?.trim() ?? '';
  return host || null;
};

const normalizeDevHost = (host: string): string => {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1') {
    return Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
  }

  return host.trim();
};

const resolveExpoHost = (): string | null => {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.linkingUri,
  ];

  for (const candidate of candidates) {
    const host = extractHost(candidate);
    if (host) {
      return normalizeDevHost(host);
    }
  }

  return null;
};

const buildDerivedDevUrl = (port: string): string | null => {
  const host = resolveExpoHost();
  if (!host) {
    return null;
  }

  return `http://${host}:${port}`;
};

const logResolvedUrl = (scope: 'api' | 'web', baseUrl: string) => {
  if (scope === 'api') {
    if (loggedApiBaseUrl) {
      return;
    }
    loggedApiBaseUrl = true;
  } else {
    if (loggedWebBaseUrl) {
      return;
    }
    loggedWebBaseUrl = true;
  }

  logger.info(`[request-board] resolved ${scope} base url`, { baseUrl });
};

const resolveRequestBoardBaseUrl = (
  configuredUrl: string | null | undefined,
  devPort: string,
  scope: 'api' | 'web',
): string => {
  const explicitUrl = normalizeConfiguredUrl(configuredUrl)
    ?? normalizeConfiguredUrl(process.env.EXPO_PUBLIC_REQUEST_BOARD_URL);
  if (explicitUrl) {
    logResolvedUrl(scope, explicitUrl);
    return explicitUrl;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const derivedUrl = buildDerivedDevUrl(devPort);
    if (derivedUrl) {
      logResolvedUrl(scope, derivedUrl);
      return derivedUrl;
    }
  }

  logResolvedUrl(scope, REQUEST_BOARD_PRODUCTION_URL);
  return REQUEST_BOARD_PRODUCTION_URL;
};

export const getRequestBoardApiBaseUrl = (): string =>
  resolveRequestBoardBaseUrl(process.env.EXPO_PUBLIC_REQUEST_BOARD_API_URL, REQUEST_BOARD_DEV_API_PORT, 'api');

export const getRequestBoardWebBaseUrl = (): string =>
  resolveRequestBoardBaseUrl(process.env.EXPO_PUBLIC_REQUEST_BOARD_WEB_URL, REQUEST_BOARD_DEV_WEB_PORT, 'web');
