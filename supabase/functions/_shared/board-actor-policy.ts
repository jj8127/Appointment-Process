export type VerifiedBoardActor = {
  role: 'admin' | 'manager' | 'fc';
  residentId: string;
  displayName: string;
};

export type BoardActorClaim = {
  role?: unknown;
  residentId?: unknown;
  displayName?: unknown;
};

export type VerifiedBoardActorResult =
  | { ok: true; actor: VerifiedBoardActor }
  | {
      ok: false;
      status: 401 | 403;
      code: 'invalid_session_actor' | 'actor_mismatch';
      message: string;
    };

const BOARD_ROLES = new Set<VerifiedBoardActor['role']>(['admin', 'manager', 'fc']);
const BOARD_AUTOMATION_ACTIONS = new Set([
  'board-categories-list',
  'board-list',
  'board-create',
]);

function normalizePhone(value: unknown) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

export function isBoardAutomationActionAllowed(action: string) {
  return BOARD_AUTOMATION_ACTIONS.has(String(action ?? '').trim());
}

export function verifyBoardAutomationToken(
  providedToken: string | null | undefined,
  expectedToken: string | null | undefined,
) {
  const provided = String(providedToken ?? '').trim();
  const expected = String(expectedToken ?? '').trim();
  if (!provided || !expected) return false;

  const encoder = new TextEncoder();
  const left = encoder.encode(provided);
  const right = encoder.encode(expected);
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export function buildVerifiedBoardActor(
  verified: VerifiedBoardActor,
  clientClaim?: BoardActorClaim | null,
): VerifiedBoardActorResult {
  const role = verified.role;
  const residentId = normalizePhone(verified.residentId);
  if (!BOARD_ROLES.has(role) || residentId.length !== 11) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_session_actor',
      message: 'Invalid signed board session actor',
    };
  }

  if (
    clientClaim
    && (
      clientClaim.role !== role
      || normalizePhone(clientClaim.residentId) !== residentId
    )
  ) {
    return {
      ok: false,
      status: 403,
      code: 'actor_mismatch',
      message: 'Board actor does not match the signed session',
    };
  }

  return {
    ok: true,
    actor: {
      role,
      residentId,
      displayName: String(verified.displayName ?? '').trim().slice(0, 120),
    },
  };
}

export function isBoardPostWritableByActor(
  actor: Pick<VerifiedBoardActor, 'role' | 'residentId'> & { displayName?: string },
  post: { authorRole?: unknown; authorResidentId?: unknown },
) {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'manager') return false;
  return (
    post.authorRole === 'manager'
    && normalizePhone(post.authorResidentId) === normalizePhone(actor.residentId)
  );
}

export function isCanonicalBoardAttachmentPath(input: {
  postId: string;
  storagePath: string;
  fileName: string;
}) {
  const postId = String(input.postId ?? '').trim();
  const storagePath = String(input.storagePath ?? '').trim();
  const sanitizedFileName = String(input.fileName ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!postId || postId.includes('/') || postId.includes('\\') || !sanitizedFileName) return false;

  const prefix = `board/${postId}/`;
  if (!storagePath.startsWith(prefix) || storagePath.includes('\\')) return false;
  const objectName = storagePath.slice(prefix.length);
  if (!objectName || objectName.includes('/') || objectName.includes('..')) return false;

  return new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_${sanitizedFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    'i',
  ).test(objectName);
}
