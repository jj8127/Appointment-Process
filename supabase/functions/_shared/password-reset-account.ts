import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { resolveManagerAffiliation } from './manager-affiliation.ts';
import type { RequestBoardPasswordSyncOptions } from './request-board-password-sync.ts';
import { parseDesignerCompanyNameFromAffiliation } from './request-board-auth.ts';

type AdminAccountRow = {
  id: string;
  name: string | null;
  phone: string;
  active: boolean | null;
  staff_type?: string | null;
  password_set_at?: string | null;
  reset_token_hash?: string | null;
  reset_token_expires_at?: string | null;
  reset_sent_at?: string | null;
};

type ManagerAccountRow = {
  id: string;
  name: string | null;
  phone: string;
  active: boolean | null;
  password_set_at?: string | null;
  reset_token_hash?: string | null;
  reset_token_expires_at?: string | null;
  reset_sent_at?: string | null;
};

type FcProfileRow = {
  id: string;
  name: string | null;
  phone: string;
  affiliation?: string | null;
  signup_completed?: boolean | null;
};

type FcCredentialRow = {
  password_set_at?: string | null;
  reset_token_hash?: string | null;
  reset_token_expires_at?: string | null;
  reset_sent_at?: string | null;
};

type DecodedRow<T> =
  | { ok: true; value: T | null }
  | { ok: false; error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null;
}

function isOptionalNullableBoolean(value: unknown): value is boolean | null | undefined {
  return value === undefined || isNullableBoolean(value);
}

function invalidRow(table: string): DecodedRow<never> {
  return { ok: false, error: new Error(`Invalid ${table} row returned by Supabase`) };
}

function decodeAdminAccountRow(value: unknown): DecodedRow<AdminAccountRow> {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !isNullableString(value.name)
    || typeof value.phone !== 'string'
    || !isNullableBoolean(value.active)
    || !isOptionalNullableString(value.staff_type)
    || !isOptionalNullableString(value.password_set_at)
    || !isOptionalNullableString(value.reset_token_hash)
    || !isOptionalNullableString(value.reset_token_expires_at)
    || !isOptionalNullableString(value.reset_sent_at)
  ) {
    return invalidRow('admin_accounts');
  }

  return {
    ok: true,
    value: {
      id: value.id,
      name: value.name,
      phone: value.phone,
      active: value.active,
      staff_type: value.staff_type,
      password_set_at: value.password_set_at,
      reset_token_hash: value.reset_token_hash,
      reset_token_expires_at: value.reset_token_expires_at,
      reset_sent_at: value.reset_sent_at,
    },
  };
}

function decodeManagerAccountRow(value: unknown): DecodedRow<ManagerAccountRow> {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !isNullableString(value.name)
    || typeof value.phone !== 'string'
    || !isNullableBoolean(value.active)
    || !isOptionalNullableString(value.password_set_at)
    || !isOptionalNullableString(value.reset_token_hash)
    || !isOptionalNullableString(value.reset_token_expires_at)
    || !isOptionalNullableString(value.reset_sent_at)
  ) {
    return invalidRow('manager_accounts');
  }

  return {
    ok: true,
    value: {
      id: value.id,
      name: value.name,
      phone: value.phone,
      active: value.active,
      password_set_at: value.password_set_at,
      reset_token_hash: value.reset_token_hash,
      reset_token_expires_at: value.reset_token_expires_at,
      reset_sent_at: value.reset_sent_at,
    },
  };
}

function decodeFcProfileRow(value: unknown): DecodedRow<FcProfileRow> {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !isNullableString(value.name)
    || typeof value.phone !== 'string'
    || !isOptionalNullableString(value.affiliation)
    || !isOptionalNullableBoolean(value.signup_completed)
  ) {
    return invalidRow('fc_profiles');
  }

  return {
    ok: true,
    value: {
      id: value.id,
      name: value.name,
      phone: value.phone,
      affiliation: value.affiliation,
      signup_completed: value.signup_completed,
    },
  };
}

function decodeFcCredentialRow(value: unknown): DecodedRow<FcCredentialRow> {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value)
    || !isOptionalNullableString(value.password_set_at)
    || !isOptionalNullableString(value.reset_token_hash)
    || !isOptionalNullableString(value.reset_token_expires_at)
    || !isOptionalNullableString(value.reset_sent_at)
  ) {
    return invalidRow('fc_credentials');
  }

  return {
    ok: true,
    value: {
      password_set_at: value.password_set_at,
      reset_token_hash: value.reset_token_hash,
      reset_token_expires_at: value.reset_token_expires_at,
      reset_sent_at: value.reset_sent_at,
    },
  };
}

export type PasswordResetAccountKind = 'admin' | 'manager' | 'fc';

export type PasswordResetAccount = {
  kind: PasswordResetAccountKind;
  id: string;
  phone: string;
  name: string | null;
  active: boolean;
  staffType: 'admin' | 'developer' | null;
  affiliation: string | null;
  signupCompleted: boolean | null;
  passwordSetAt: string | null;
  resetTokenHash: string | null;
  resetTokenExpiresAt: string | null;
  resetSentAt: string | null;
};

const normalizeStaffType = (value: unknown): 'admin' | 'developer' =>
  value === 'developer' ? 'developer' : 'admin';

const ADMIN_RESET_SELECT = [
  'id',
  'name',
  'phone',
  'active',
  'staff_type',
  'password_set_at',
  'reset_token_hash',
  'reset_token_expires_at',
  'reset_sent_at',
].join(',');

const MANAGER_RESET_SELECT = [
  'id',
  'name',
  'phone',
  'active',
  'password_set_at',
  'reset_token_hash',
  'reset_token_expires_at',
  'reset_sent_at',
].join(',');

const FC_PROFILE_RESET_SELECT = 'id,name,phone,affiliation,signup_completed';
const FC_CREDENTIAL_RESET_SELECT = 'password_set_at,reset_token_hash,reset_token_expires_at,reset_sent_at';

export async function findPasswordResetAccount(
  supabase: SupabaseClient,
  phone: string,
): Promise<{ account: PasswordResetAccount | null; error: unknown | null }> {
  const { data: rawAdmin, error: adminError } = await supabase
    .from('admin_accounts')
    .select(ADMIN_RESET_SELECT)
    .eq('phone', phone)
    .maybeSingle();

  if (adminError) {
    return { account: null, error: adminError };
  }

  const decodedAdmin = decodeAdminAccountRow(rawAdmin);
  if (decodedAdmin.ok === false) {
    return { account: null, error: decodedAdmin.error };
  }
  const admin = decodedAdmin.value;

  if (admin?.id) {
    return {
      account: {
        kind: 'admin',
        id: admin.id,
        phone: admin.phone,
        name: admin.name ?? null,
        active: admin.active !== false,
        staffType: normalizeStaffType(admin.staff_type),
        affiliation: null,
        signupCompleted: null,
        passwordSetAt: admin.password_set_at ?? null,
        resetTokenHash: admin.reset_token_hash ?? null,
        resetTokenExpiresAt: admin.reset_token_expires_at ?? null,
        resetSentAt: admin.reset_sent_at ?? null,
      },
      error: null,
    };
  }

  const { data: rawManager, error: managerError } = await supabase
    .from('manager_accounts')
    .select(MANAGER_RESET_SELECT)
    .eq('phone', phone)
    .maybeSingle();

  if (managerError) {
    return { account: null, error: managerError };
  }

  const decodedManager = decodeManagerAccountRow(rawManager);
  if (decodedManager.ok === false) {
    return { account: null, error: decodedManager.error };
  }
  const manager = decodedManager.value;

  if (manager?.id) {
    return {
      account: {
        kind: 'manager',
        id: manager.id,
        phone: manager.phone,
        name: manager.name ?? null,
        active: manager.active !== false,
        staffType: null,
        affiliation: null,
        signupCompleted: null,
        passwordSetAt: manager.password_set_at ?? null,
        resetTokenHash: manager.reset_token_hash ?? null,
        resetTokenExpiresAt: manager.reset_token_expires_at ?? null,
        resetSentAt: manager.reset_sent_at ?? null,
      },
      error: null,
    };
  }

  const { data: rawProfile, error: profileError } = await supabase
    .from('fc_profiles')
    .select(FC_PROFILE_RESET_SELECT)
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return { account: null, error: profileError };
  }

  const decodedProfile = decodeFcProfileRow(rawProfile);
  if (decodedProfile.ok === false) {
    return { account: null, error: decodedProfile.error };
  }
  const profile = decodedProfile.value;

  if (!profile?.id) {
    return { account: null, error: null };
  }

  const { data: rawCreds, error: credsError } = await supabase
    .from('fc_credentials')
    .select(FC_CREDENTIAL_RESET_SELECT)
    .eq('fc_id', profile.id)
    .maybeSingle();

  if (credsError) {
    return { account: null, error: credsError };
  }

  const decodedCreds = decodeFcCredentialRow(rawCreds);
  if (decodedCreds.ok === false) {
    return { account: null, error: decodedCreds.error };
  }
  const creds = decodedCreds.value;

  return {
    account: {
      kind: 'fc',
      id: profile.id,
      phone: profile.phone,
      name: profile.name ?? null,
      active: true,
      staffType: null,
      affiliation: profile.affiliation ?? null,
      signupCompleted: profile.signup_completed ?? null,
      passwordSetAt: creds?.password_set_at ?? null,
      resetTokenHash: creds?.reset_token_hash ?? null,
      resetTokenExpiresAt: creds?.reset_token_expires_at ?? null,
      resetSentAt: creds?.reset_sent_at ?? null,
    },
    error: null,
  };
}

export function buildRequestBoardPasswordSyncOptions(
  account: PasswordResetAccount,
): RequestBoardPasswordSyncOptions | null {
  if (account.kind === 'admin') {
    if (account.staffType === 'developer') {
      return {
        role: 'fc',
        name: '개발자',
      };
    }

    return null;
  }

  if (account.kind === 'manager') {
    return {
      role: 'manager',
      name: account.name ?? '',
      affiliation: resolveManagerAffiliation(account.name),
    };
  }

  const designerCompanyName = parseDesignerCompanyNameFromAffiliation(account.affiliation);
  if (designerCompanyName) {
    return {
      role: 'designer',
      name: account.name ?? '',
      companyName: designerCompanyName,
    };
  }

  return {
    role: 'fc',
    name: account.name ?? '',
    affiliation: account.affiliation ?? null,
  };
}
