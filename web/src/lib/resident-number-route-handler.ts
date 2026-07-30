import type { ResidentNumberReadResult } from '@/lib/resident-number-read-contract';

export type ResidentNumberStaffSession = {
  role: 'admin' | 'manager' | 'fc';
  staffType: 'admin' | 'developer' | null;
};

export function canReadResidentNumbersForStaffSession(
  session: ResidentNumberStaffSession,
): boolean {
  if (session.role === 'manager') return session.staffType === null;
  if (session.role === 'admin') {
    return session.staffType === 'admin' || session.staffType === 'developer';
  }
  return false;
}

type ResidentNumberRouteSession =
  | { ok: true; session: { residentDigits: string } }
  | { ok: false; status: number; error: string };

type ResidentNumberRouteResponseBody =
  | { error: string }
  | ({ ok: true } & ResidentNumberReadResult);

type ResidentNumberRouteResponse = {
  body: ResidentNumberRouteResponseBody;
  status: number;
};

type ResidentNumberRouteHandlerDeps = {
  getSession: () => Promise<ResidentNumberRouteSession>;
  checkRateLimit: (
    key: string,
    limit: number,
    windowMs: number,
  ) => { allowed: boolean };
  readJson: () => Promise<unknown>;
  normalizeFcIds: (value: unknown) => string[];
  readResidentNumbers: (options: {
    fcIds: string[];
    staffPhone: string;
    logPrefix: string;
  }) => Promise<ResidentNumberReadResult>;
  logInvalidJson: (error: unknown) => void;
  logReadFailure: (error: unknown) => void;
};

const RESIDENT_NUMBER_ROUTE_LOG_PREFIX = '[api/admin/resident-numbers]';
const RESIDENT_NUMBER_RATE_LIMIT = 30;
const RESIDENT_NUMBER_RATE_LIMIT_WINDOW_MS = 60_000;
const RESIDENT_NUMBER_MAX_FC_IDS = 20;

export async function handleResidentNumberRoutePost({
  getSession,
  checkRateLimit,
  readJson,
  normalizeFcIds,
  readResidentNumbers,
  logInvalidJson,
  logReadFailure,
}: ResidentNumberRouteHandlerDeps): Promise<ResidentNumberRouteResponse> {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return {
      body: { error: sessionCheck.error },
      status: sessionCheck.status,
    };
  }

  const rateLimit = checkRateLimit(
    `resident-numbers:${sessionCheck.session.residentDigits}`,
    RESIDENT_NUMBER_RATE_LIMIT,
    RESIDENT_NUMBER_RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return {
      body: { error: 'Too many requests' },
      status: 429,
    };
  }

  let body: unknown;
  try {
    body = await readJson();
  } catch (error: unknown) {
    logInvalidJson(error);
    return {
      body: { error: 'Invalid JSON payload' },
      status: 400,
    };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      body: { error: 'Invalid JSON payload' },
      status: 400,
    };
  }

  const fcIds = normalizeFcIds((body as { fcIds?: unknown }).fcIds);
  if (fcIds.length > RESIDENT_NUMBER_MAX_FC_IDS) {
    return {
      body: { error: '한 번에 최대 20명까지 조회할 수 있습니다.' },
      status: 400,
    };
  }

  if (fcIds.length === 0) {
    return {
      body: {
        ok: true,
        residentNumbers: {},
        residentNumberStatuses: {},
      },
      status: 200,
    };
  }

  try {
    const result = await readResidentNumbers({
      fcIds,
      staffPhone: sessionCheck.session.residentDigits,
      logPrefix: RESIDENT_NUMBER_ROUTE_LOG_PREFIX,
    });

    return {
      body: { ok: true, ...result },
      status: 200,
    };
  } catch (error: unknown) {
    logReadFailure(error);
    return {
      body: { error: '요청 처리에 실패했습니다.' },
      status: 500,
    };
  }
}
