type ResidentNumberMap = Record<string, string | null>;

type ResidentNumberRouteSession =
  | { ok: true; session: { residentDigits: string } }
  | { ok: false; status: number; error: string };

type ResidentNumberRouteResponseBody =
  | { error: string }
  | { ok: true; residentNumbers: ResidentNumberMap };

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
  readJson: () => Promise<{ fcIds?: unknown }>;
  normalizeFcIds: (value: unknown) => string[];
  readResidentNumbers: (options: {
    fcIds: string[];
    staffPhone: string;
    logPrefix: string;
  }) => Promise<ResidentNumberMap>;
  logInvalidJson: (error: unknown) => void;
  logReadFailure: (error: unknown) => void;
};

const RESIDENT_NUMBER_ROUTE_LOG_PREFIX = '[api/admin/resident-numbers]';
const RESIDENT_NUMBER_RATE_LIMIT = 30;
const RESIDENT_NUMBER_RATE_LIMIT_WINDOW_MS = 60_000;

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

  let body: { fcIds?: unknown };
  try {
    body = await readJson();
  } catch (error: unknown) {
    logInvalidJson(error);
    return {
      body: { error: 'Invalid JSON payload' },
      status: 400,
    };
  }

  const fcIds = normalizeFcIds(body.fcIds);
  if (fcIds.length === 0) {
    return {
      body: { ok: true, residentNumbers: {} },
      status: 200,
    };
  }

  try {
    const residentNumbers = await readResidentNumbers({
      fcIds,
      staffPhone: sessionCheck.session.residentDigits,
      logPrefix: RESIDENT_NUMBER_ROUTE_LOG_PREFIX,
    });

    return {
      body: { ok: true, residentNumbers },
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
