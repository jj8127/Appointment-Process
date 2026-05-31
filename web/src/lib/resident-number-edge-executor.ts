type ResidentNumberMap = Record<string, string | null>;

type ResidentNumberEdgeFallbackFetch = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type ResidentNumberEdgeFallbackRequestBuilder = (options: {
  supabaseUrl: string;
  serviceKey: string;
  staffPhone: string;
  fcIds: string[];
}) => { url: string; init: RequestInit };

type ResidentNumberEdgeFallbackResponseParser = (options: {
  responseOk: boolean;
  data: unknown;
}) => {
  ok: true;
  residentNumbers: ResidentNumberMap;
} | {
  ok: false;
  message: string;
};

type ReadResidentNumbersFromEdgeFallbackOptions = {
  fcIds: string[];
  staffPhone: string;
  supabaseUrl: string;
  serviceKey: string;
  directFallbackDescription: string;
  runtimeDetails: Record<string, unknown>;
  logPrefix: string;
  fetcher?: ResidentNumberEdgeFallbackFetch;
  logError: (message: string, details: Record<string, unknown>) => void;
  buildRequest: ResidentNumberEdgeFallbackRequestBuilder;
  parseResponse: ResidentNumberEdgeFallbackResponseParser;
};

export async function readResidentNumbersFromEdgeFallback({
  fcIds,
  staffPhone,
  supabaseUrl,
  serviceKey,
  directFallbackDescription,
  runtimeDetails,
  logPrefix,
  fetcher = fetch,
  logError,
  buildRequest,
  parseResponse,
}: ReadResidentNumbersFromEdgeFallbackOptions): Promise<ResidentNumberMap> {
  if (!supabaseUrl || !serviceKey) {
    const missingEnv = [
      !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean);
    const message = `Resident-number runtime misconfigured: ${directFallbackDescription} and edge fallback is unavailable (${missingEnv.join(', ')})`;

    logError(`${logPrefix} edge fallback unavailable`, {
      ...runtimeDetails,
      missingEnv,
    });

    throw new Error(message);
  }

  const fallbackRequest = buildRequest({
    supabaseUrl,
    serviceKey,
    staffPhone,
    fcIds,
  });
  const resp = await fetcher(fallbackRequest.url, fallbackRequest.init);

  const data: unknown = await resp.json().catch(() => null);
  const parsed = parseResponse({
    responseOk: resp.ok,
    data,
  });

  if (!parsed.ok) {
    logError(`${logPrefix} resident-number edge function failed`, {
      ...runtimeDetails,
      status: resp.status,
      body: data,
    });

    throw new Error(`Resident-number edge fallback failed after ${directFallbackDescription}: ${parsed.message}`);
  }

  return parsed.residentNumbers;
}
