import 'server-only';

import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { adminSupabase } from '@/lib/admin-supabase';
import type { AdminAssistedSignupInput } from '@/lib/admin-assisted-signup-contract';
import type { VerifiedServerSession } from '@/lib/server-session';

type AssistedSignupRpcResult = {
  ok?: boolean;
  fcId?: string;
  verificationMethod?: string;
  requiresPasswordChange?: boolean;
  alreadyApplied?: boolean;
};

function hashTemporaryPassword(password: string) {
  const salt = randomBytes(16);
  return {
    passwordHash: pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('base64'),
    passwordSalt: salt.toString('base64'),
  };
}

export async function createAdminAssistedSignup(
  input: AdminAssistedSignupInput,
  session: VerifiedServerSession,
) {
  if (
    session.role !== 'admin'
    || (session.staffType !== 'admin' && session.staffType !== 'developer')
  ) {
    throw new Error('assisted_signup_forbidden');
  }

  const { passwordHash, passwordSalt } = hashTemporaryPassword(input.password);
  const { data, error } = await adminSupabase.rpc('admin_create_assisted_signup_v1', {
    p_request_id: input.requestId,
    p_actor_phone: session.residentDigits,
    p_actor_staff_type: session.staffType,
    p_name: input.name,
    p_phone: input.phone,
    p_affiliation: input.affiliation,
    p_email: input.email,
    p_carrier: input.carrier,
    p_license_statuses: input.licenseStatuses,
    p_inviter_fc_id: input.inviterFcId,
    p_consent_obtained_on: input.consentObtainedOn,
    p_evidence_reference: input.evidenceReference,
    p_password_hash: passwordHash,
    p_password_salt: passwordSalt,
  });

  if (error) {
    throw error;
  }

  const result = (data ?? {}) as AssistedSignupRpcResult;
  if (
    result.ok !== true
    || typeof result.fcId !== 'string'
    || result.verificationMethod !== 'admin_written_consent'
    || result.requiresPasswordChange !== true
  ) {
    throw new Error('assisted_signup_invalid_result');
  }

  return {
    fcId: result.fcId,
    verificationMethod: 'admin_written_consent' as const,
    requiresPasswordChange: true as const,
    alreadyApplied: result.alreadyApplied === true,
  };
}
