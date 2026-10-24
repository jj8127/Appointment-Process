import { parseQueryRows } from './query-result-contract.ts';

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
const EMPLOYEE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizePhone = (value: unknown) =>
  typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';

type AllowanceManagerQueryRow = { id: string; phone: string; active: boolean };
type AllowanceAdminQueryRow = { id: string; phone: string };
type AllowanceProfileQueryRow = {
  id: string;
  phone: string;
  affiliation: string | null;
  signup_completed: boolean;
  is_manager_referral_shadow: boolean;
};
type AllowancePilotQueryRow = {
  manager_account_id: string | null;
  beneficiary_fc_id: string;
  employee_code: string;
  enabled: boolean;
  revision: number;
};

const isAllowanceManagerQueryRow = (value: unknown): value is AllowanceManagerQueryRow =>
  isRecord(value) && typeof value.id === 'string' && UUID.test(value.id) &&
  normalizePhone(value.phone).length === 11 && typeof value.active === 'boolean';
const isAllowanceAdminQueryRow = (value: unknown): value is AllowanceAdminQueryRow =>
  isRecord(value) && typeof value.id === 'string' && UUID.test(value.id) &&
  normalizePhone(value.phone).length === 11;
const isAllowanceProfileQueryRow = (value: unknown): value is AllowanceProfileQueryRow =>
  isRecord(value) && typeof value.id === 'string' && UUID.test(value.id) &&
  normalizePhone(value.phone).length === 11 &&
  (value.affiliation === null || typeof value.affiliation === 'string') &&
  typeof value.signup_completed === 'boolean' &&
  typeof value.is_manager_referral_shadow === 'boolean';
const isAllowancePilotQueryRow = (value: unknown): value is AllowancePilotQueryRow =>
  isRecord(value) &&
  (value.manager_account_id === null ||
    (typeof value.manager_account_id === 'string' && UUID.test(value.manager_account_id))) &&
  typeof value.beneficiary_fc_id === 'string' && UUID.test(value.beneficiary_fc_id) &&
  typeof value.employee_code === 'string' && EMPLOYEE_CODE.test(value.employee_code) &&
  typeof value.enabled === 'boolean' &&
  Number.isSafeInteger(value.revision) && Number(value.revision) >= 1;

function invalidAllowanceQuery(): never {
  throw new Error('allowance_lookup_failed');
}

export function parseAllowanceManagerQuery(
  value: unknown,
  requestedPhone: string,
): AllowanceManager | null {
  const rows = parseQueryRows(value, isAllowanceManagerQueryRow);
  if (!rows || rows.length > 1 ||
    rows.some((row) => normalizePhone(row.phone) !== requestedPhone)) {
    return invalidAllowanceQuery();
  }
  const row = rows[0];
  return row ? { id: row.id, active: row.active } : null;
}

export function parseAllowanceAdminQuery(value: unknown, requestedPhone: string): boolean {
  const rows = parseQueryRows(value, isAllowanceAdminQueryRow);
  if (!rows || rows.length > 1 ||
    rows.some((row) => normalizePhone(row.phone) !== requestedPhone)) {
    return invalidAllowanceQuery();
  }
  return rows.length === 1;
}

export function parseAllowanceProfilesQuery(
  value: unknown,
  requestedPhone: string,
  requestedFcId?: string,
): AllowanceProfile[] {
  const rows = parseQueryRows(value, isAllowanceProfileQueryRow);
  if (!rows || rows.length > 1 || rows.some((row) =>
    normalizePhone(row.phone) !== requestedPhone ||
    (requestedFcId !== undefined && row.id !== requestedFcId)
  )) {
    return invalidAllowanceQuery();
  }
  return rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    affiliation: row.affiliation,
    signupCompleted: row.signup_completed,
    isManagerReferralShadow: row.is_manager_referral_shadow,
  }));
}

export function parseAllowancePilotQuery(
  value: unknown,
  requestedBeneficiaryFcId: string,
): AllowancePilot | null {
  const rows = parseQueryRows(value, isAllowancePilotQueryRow);
  if (!rows || rows.length > 1 ||
    rows.some((row) => row.beneficiary_fc_id !== requestedBeneficiaryFcId)) {
    return invalidAllowanceQuery();
  }
  const row = rows[0];
  return row
    ? {
      managerAccountId: row.manager_account_id,
      beneficiaryFcId: row.beneficiary_fc_id,
      employeeCode: row.employee_code,
      enabled: row.enabled,
      revision: row.revision,
    }
    : null;
}

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
