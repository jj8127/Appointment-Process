type FunctionErrorContext = {
  json?: () => Promise<unknown>;
};

export async function readSupabaseFunctionErrorCode(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: FunctionErrorContext } | null)?.context;
  if (typeof context?.json !== 'function') return undefined;

  try {
    const payload = await context.json();
    if (!payload || typeof payload !== 'object') return undefined;
    const code = (payload as { code?: unknown }).code;
    return typeof code === 'string' && code.length <= 64 ? code : undefined;
  } catch {
    return undefined;
  }
}
