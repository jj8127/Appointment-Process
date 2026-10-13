import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { buildPhoneCandidates, type VerifiedServerSession } from '@/lib/server-session';
import {
  collectSupabaseRows,
  requireSupabaseRowMatching,
  requireSupabaseRowsMatching,
} from '@/lib/supabase-query-contract';

export const ALLOWANCE_IMPORT_COLUMNS = 'id,status,revision,source_sha256,policy_version,performance_month,payment_date,genealogy_as_of,pilot_revision,created_at,published_at,snapshot';

export async function allowanceAdminId(session: VerifiedServerSession): Promise<string> {
  const { data, error } = await adminSupabase.from('admin_accounts').select('id').eq('active', true)
    .in('phone', buildPhoneCandidates(session.residentId, session.residentDigits)).maybeSingle();
  if (error || !data?.id) throw new Error('admin_unavailable');
  return data.id;
}

export type AllowanceRecipient = { manager_account_id: string | null; beneficiary_fc_id: string; employee_code: string; enabled: boolean; revision: number };

type AllowanceRecipientQueryRow = AllowanceRecipient & {
  fc_profiles: { name: string };
};

type AllowanceCandidateProfileRow = {
  id: string;
  name: string;
  phone: string;
  signup_completed: boolean | null;
  is_manager_referral_shadow: boolean | null;
  affiliation: string | null;
};

type AllowanceCandidateManagerRow = {
  id: string;
  phone: string;
  active: boolean;
};

type AllowanceCandidateAdminRow = {
  phone: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAllowanceRecipient(value: unknown): value is AllowanceRecipient {
  return isRecord(value)
    && (value.manager_account_id === null || typeof value.manager_account_id === 'string')
    && typeof value.beneficiary_fc_id === 'string'
    && typeof value.employee_code === 'string'
    && typeof value.enabled === 'boolean'
    && Number.isSafeInteger(value.revision);
}

function isAllowanceRecipientQueryRow(value: unknown): value is AllowanceRecipientQueryRow {
  if (!isAllowanceRecipient(value)) return false;
  const joined = value as AllowanceRecipient & { fc_profiles?: unknown };
  return isRecord(joined.fc_profiles)
    && typeof joined.fc_profiles.name === 'string';
}

function isAllowanceCandidateProfileRow(value: unknown): value is AllowanceCandidateProfileRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.phone === 'string'
    && (value.signup_completed === null || typeof value.signup_completed === 'boolean')
    && (value.is_manager_referral_shadow === null || typeof value.is_manager_referral_shadow === 'boolean')
    && (value.affiliation === null || typeof value.affiliation === 'string');
}

function isAllowanceCandidateManagerRow(value: unknown): value is AllowanceCandidateManagerRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.phone === 'string'
    && typeof value.active === 'boolean';
}

function isAllowanceCandidateAdminRow(value: unknown): value is AllowanceCandidateAdminRow {
  return isRecord(value) && typeof value.phone === 'string';
}

export async function getAllowancePilot(beneficiaryFcId: string) {
  const { data, error } = await adminSupabase.from('referral_allowance_recipients')
    .select('manager_account_id,beneficiary_fc_id,employee_code,enabled,revision').eq('beneficiary_fc_id', beneficiaryFcId).maybeSingle();
  if (error) throw new Error('pilot_unavailable');
  if (data === null) return null;
  try {
    return requireSupabaseRowMatching(data, 'referral_allowance_pilot', isAllowanceRecipient);
  } catch {
    throw new Error('pilot_unavailable');
  }
}

export async function listAllowanceRecipients() {
  const rows = await collectSupabaseRows<AllowanceRecipientQueryRow>({
    queryName: 'referral_allowance_recipients',
    fetchPage: (from, to) => adminSupabase.from('referral_allowance_recipients')
      .select('manager_account_id,beneficiary_fc_id,employee_code,enabled,revision,fc_profiles!beneficiary_fc_id(name)')
      .order('created_at')
      .order('beneficiary_fc_id')
      .range(from, to),
    isRow: isAllowanceRecipientQueryRow,
    rowKey: (row) => row.beneficiary_fc_id,
  }).catch(() => {
    throw new Error('recipients_unavailable');
  });

  return rows.map((row) => {
    const profile = row.fc_profiles;
    return { manager_account_id: row.manager_account_id, beneficiary_fc_id: row.beneficiary_fc_id,
      employee_code: row.employee_code, enabled: row.enabled, revision: row.revision,
      name: profile.name } as AllowanceRecipient & { name: string };
  });
}

export async function findAllowanceCandidates(search: string) {
  if (search.trim().length < 2) return [];
  const literal = search.trim().replace(/[\\%_]/g, '\\$&');
  const { data: profiles, error: profileError } = await adminSupabase.from('fc_profiles')
    .select('id,name,phone,signup_completed,is_manager_referral_shadow,affiliation').ilike('name', `%${literal}%`).order('id').limit(20);
  if (profileError) throw new Error('profile_unavailable');
  const profileRows = requireSupabaseRowsMatching(
    profiles,
    'referral_allowance_candidate_profiles',
    isAllowanceCandidateProfileRow,
  );
  if (profileRows.length === 0) return [];
  const { data: managers, error } = await adminSupabase.from('manager_accounts').select('id,phone,active').in('phone', profileRows.map((p) => p.phone));
  if (error) throw new Error('manager_unavailable');
  const { data: admins, error: adminError } = await adminSupabase.from('admin_accounts').select('phone').in('phone', profileRows.map((p) => p.phone));
  if (adminError) throw new Error('admin_unavailable');
  const managerRows = requireSupabaseRowsMatching(
    managers,
    'referral_allowance_candidate_managers',
    isAllowanceCandidateManagerRow,
  );
  const adminRows = requireSupabaseRowsMatching(
    admins,
    'referral_allowance_candidate_admins',
    isAllowanceCandidateAdminRow,
  );
  return profileRows.flatMap((profile) => {
    const manager = managerRows.find((item) => item.phone === profile.phone);
    if (adminRows.some((admin) => admin.phone === profile.phone)
      || String(profile.affiliation ?? '').includes('설계매니저')
      || (manager ? !manager.active || !(profile.signup_completed || profile.is_manager_referral_shadow)
        : !profile.signup_completed || profile.is_manager_referral_shadow)) return [];
    return [{ managerAccountId: manager?.id ?? null, beneficiaryFcId: profile.id, name: profile.name, affiliation: profile.affiliation ?? '' }];
  });
}
