export type AllowanceSession = { role: string; phone: string; fcId?: string };
export type AllowanceManager = { id: string; active: boolean };
export type AllowanceProfile = {
  id: string;
  phone: string;
  affiliation: string | null;
  signupCompleted: boolean;
  isManagerReferralShadow: boolean;
};
export type AllowancePilot = {
  managerAccountId: string | null;
  beneficiaryFcId: string;
  employeeCode: string;
  enabled: boolean;
  revision: number;
};
export type AllowanceIdentity = { managerAccountId: string | null; beneficiaryFcId: string };
export type AllowanceReadRequest = { action: 'access' | 'statement'; month?: string };

export type AllowanceAuthRepository = {
  managerByPhone(phone: string): Promise<AllowanceManager | null>;
  hasAdminAccount(phone: string): Promise<boolean>;
  profilesForSession(phone: string, fcId?: string): Promise<AllowanceProfile[]>;
  pilot(beneficiaryFcId: string): Promise<AllowancePilot | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALLOWANCE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseAllowanceReadRequest(value: unknown): AllowanceReadRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'action' && key !== 'month')) return null;
  if (body.action !== 'access' && body.action !== 'statement') return null;
  if (body.month !== undefined && (typeof body.month !== 'string' || !ALLOWANCE_MONTH.test(body.month))) return null;
  return body.month === undefined ? { action: body.action } : { action: body.action, month: body.month as string };
}

/** Resolve the signed person and their current recipient permission on every request. */
export async function authorizeReferralAllowance(
  session: AllowanceSession,
  repository: AllowanceAuthRepository,
): Promise<{ enabled: false } | { enabled: true; identity: AllowanceIdentity; pilot: AllowancePilot }> {
  if (session.role !== 'manager' && session.role !== 'fc') return { enabled: false };
  const phone = session.phone.replace(/[^0-9]/g, '');
  if (phone.length !== 11 || (session.fcId !== undefined && !UUID.test(session.fcId))) return { enabled: false };
  const manager = await repository.managerByPhone(phone);
  if (await repository.hasAdminAccount(phone)) return { enabled: false };
  if (session.role === 'manager' ? !manager?.active || !UUID.test(manager.id) : manager !== null) return { enabled: false };

  const profiles = await repository.profilesForSession(phone, session.fcId);
  if (profiles.length !== 1) return { enabled: false };
  const profile = profiles[0];
  if (!UUID.test(profile.id)
    || profile.phone.replace(/[^0-9]/g, '') !== phone
    || (session.fcId !== undefined && profile.id !== session.fcId)
    || (profile.affiliation ?? '').includes('설계매니저')
    || (session.role === 'fc' ? !profile.signupCompleted || profile.isManagerReferralShadow
      : !profile.signupCompleted && !profile.isManagerReferralShadow)) return { enabled: false };

  const managerAccountId = manager?.id ?? null;
  const pilot = await repository.pilot(profile.id);
  if (!pilot?.enabled || pilot.managerAccountId !== managerAccountId || pilot.beneficiaryFcId !== profile.id
    || !pilot.employeeCode.trim() || !Number.isSafeInteger(pilot.revision) || pilot.revision < 1) return { enabled: false };
  return { enabled: true, identity: { managerAccountId, beneficiaryFcId: profile.id }, pilot };
}

/** Read small command bodies without trusting Content-Length or buffering a large upload. */
export async function readAllowanceCommand(req: Request): Promise<AllowanceReadRequest | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseAllowanceReadRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
