type FunctionErrorContext = {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  status?: number;
  clone?: () => FunctionErrorContext;
  response?: FunctionErrorContext;
};

export function getSupabaseFunctionErrorResponse(error: unknown): FunctionErrorContext | undefined {
  const context = (error as { context?: FunctionErrorContext } | null)?.context;
  return context?.response ?? context;
}

export async function readSupabaseFunctionErrorCode(error: unknown): Promise<string | undefined> {
  const response = getSupabaseFunctionErrorResponse(error);
  try {
    const context = response?.clone?.() ?? response;
    if (typeof context?.json !== 'function') return undefined;
    const payload = await context.json();
    if (!payload || typeof payload !== 'object') return undefined;
    const code = (payload as { code?: unknown }).code;
    return typeof code === 'string' && code.length <= 64 ? code : undefined;
  } catch {
    return undefined;
  }
}
