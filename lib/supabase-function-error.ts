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
