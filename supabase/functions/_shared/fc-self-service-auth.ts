import { requireAppSessionFromRequest } from './request-board-auth.ts';

export type FcSelfServiceActor = {
  id: string;
  phone: string;
};

type FcSelfServiceAuthResult =
  | { ok: true; actor: FcSelfServiceActor }
  | { ok: false; code: string; message: string; status: number };

type CurrentAppSession = {
  role?: string;
  accountKind?: string;
  accountId?: string;
  fcId?: string;
  phone?: string;
};

export function cleanFcPhone(input: unknown): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

export async function requireFcSelfServiceActor(req: Request): Promise<FcSelfServiceAuthResult> {
  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return sessionResult;
  }

  const session = sessionResult.session as CurrentAppSession;
  const accountId = String(session.accountId ?? '').trim();
  const phone = cleanFcPhone(session.phone);
  const fcId = String(session.fcId ?? '').trim();
  if (
    session.role !== 'fc' ||
    session.accountKind !== 'fc' ||
    !accountId ||
    phone.length !== 11 ||
    (fcId && fcId !== accountId)
  ) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'FC 본인 계정으로 다시 로그인해주세요.',
      status: 403,
    };
  }

  return { ok: true, actor: { id: accountId, phone } };
}

export function hasMismatchedClaimedPhone(
  actor: FcSelfServiceActor,
  claimedPhone: unknown,
): boolean {
  if (claimedPhone === undefined) return false;
  return cleanFcPhone(claimedPhone) !== actor.phone;
}

export function isExactYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function getKoreanYmd(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
