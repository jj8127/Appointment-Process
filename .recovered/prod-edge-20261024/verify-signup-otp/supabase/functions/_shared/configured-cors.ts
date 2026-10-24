type EdgeHandler = (request: Request) => Response | Promise<Response>;

/** Select only an explicitly configured origin; never add localhost implicitly. */
export function applyConfiguredCors(
  request: Request,
  response: Response,
  allowedOrigins: readonly string[],
): Response {
  const origin = request.headers.get('origin');
  if (!origin) return response;

  const headers = new Headers(response.headers);
  if (allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  const vary = headers.get('Vary');
  const values = (vary ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === 'origin')) {
    headers.set('Vary', [...values, 'Origin'].join(', '));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withConfiguredCors(
  handler: EdgeHandler,
  allowedOrigins: readonly string[],
): EdgeHandler {
  return async (request) => applyConfiguredCors(request, await handler(request), allowedOrigins);
}
