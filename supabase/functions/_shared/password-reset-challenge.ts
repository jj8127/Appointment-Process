import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import type { PasswordResetAccount } from './password-reset-account.ts';

const failureMessages: Record<string, string> = {
  invalid_request: '비밀번호 변경 요청을 확인해주세요.',
  account_unavailable: '비밀번호를 변경할 수 없는 계정입니다.',
  cooldown: '잠시 후 다시 시도해주세요.',
  invalid_token: '인증 코드가 유효하지 않습니다.',
  expired_token: '인증 코드가 만료되었습니다. 새 코드를 요청해주세요.',
  attempts_exhausted: '인증 코드 확인 횟수를 초과했습니다. 새 코드를 요청해주세요.',
};

export type PasswordResetChallengeResult =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number };

/** The database alone owns expiry, failure limits, cooldown and consumption. */
export async function processPasswordResetChallenge(
  supabase: SupabaseClient,
  account: PasswordResetAccount,
  input: { action: 'issue' | 'consume'; tokenHash: string; passwordHash?: string; passwordSalt?: string },
): Promise<PasswordResetChallengeResult> {
  const databaseFailure: PasswordResetChallengeResult = {
    ok: false, code: 'db_error', message: '비밀번호 변경 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', status: 500,
  };
  try {
    const { data, error } = await supabase.rpc('process_password_reset_challenge', {
      p_action: input.action,
      p_account_kind: account.kind,
      p_account_id: account.id,
      p_phone: account.phone,
      p_token_hash: input.tokenHash,
      p_password_hash: input.passwordHash ?? null,
      p_password_salt: input.passwordSalt ?? null,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return databaseFailure;
    if (data.ok === true) return { ok: true };
    if (data.ok !== false || typeof data.code !== 'string' || !Object.prototype.hasOwnProperty.call(failureMessages, data.code)) {
      return databaseFailure;
    }
    return { ok: false, code: data.code, message: failureMessages[data.code], status: data.code === 'cooldown' ? 429 : 200 };
  } catch {
    return databaseFailure;
  }
}
