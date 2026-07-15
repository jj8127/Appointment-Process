export const BOARD_FUNCTION_NAMES = [
  'board-attachment-delete',
  'board-attachment-finalize',
  'board-attachment-sign',
  'board-categories-list',
  'board-category-create',
  'board-category-update',
  'board-comment-create',
  'board-comment-delete',
  'board-comment-like-toggle',
  'board-comment-update',
  'board-create',
  'board-delete',
  'board-detail',
  'board-list',
  'board-pin',
  'board-reaction-toggle',
  'board-update',
] as const;

export type BoardFunctionName = (typeof BOARD_FUNCTION_NAMES)[number];

export type VerifiedBoardProxyActor = {
  role: 'admin' | 'manager' | 'fc';
  residentId: string;
  displayName: string;
};

type NormalizedBoardProxyRequest =
  | {
      ok: true;
      functionName: BoardFunctionName;
      payload: Record<string, unknown>;
    }
  | {
      ok: false;
      status: 400;
      code: 'invalid_board_request' | 'unsupported_board_function';
      message: string;
    };

const BOARD_FUNCTION_ALLOWLIST = new Set<string>(BOARD_FUNCTION_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBoardProxyRequest(
  input: unknown,
  actor: VerifiedBoardProxyActor,
): NormalizedBoardProxyRequest {
  if (!isRecord(input) || !isRecord(input.body)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_board_request',
      message: 'Invalid board request',
    };
  }

  const functionName = typeof input.functionName === 'string'
    ? input.functionName.trim()
    : '';
  if (!BOARD_FUNCTION_ALLOWLIST.has(functionName)) {
    return {
      ok: false,
      status: 400,
      code: 'unsupported_board_function',
      message: 'Unsupported board function',
    };
  }

  return {
    ok: true,
    functionName: functionName as BoardFunctionName,
    payload: {
      ...input.body,
      actor,
    },
  };
}

export function getBoardFunctionUrl(supabaseUrl: string, functionName: BoardFunctionName) {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${functionName}`;
}

export function buildBoardFunctionHeaders(serviceKey: string, appSessionToken: string) {
  return {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'x-app-session-token': appSessionToken,
  };
}
