import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import type { SignupSmsResult } from './signup-sms.ts';

export type TrackedSmsPurpose = 'fc_signup' | 'password_reset';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function beginSmsDeliveryAttempt(
  supabase: SupabaseClient,
  purpose: TrackedSmsPurpose,
): Promise<{ ok: true; deliveryId: string } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc('begin_platform_sms_delivery_attempt', {
      p_purpose: purpose,
    });
    if (
      error
      || !data
      || typeof data !== 'object'
      || Array.isArray(data)
      || data.ok !== true
      || typeof data.deliveryId !== 'string'
      || !UUID.test(data.deliveryId)
    ) {
      return { ok: false };
    }
    return { ok: true, deliveryId: data.deliveryId };
  } catch {
    return { ok: false };
  }
}

export async function finalizeSmsDeliveryAttempt(
  supabase: SupabaseClient,
  purpose: TrackedSmsPurpose,
  deliveryId: string,
  result: SignupSmsResult,
): Promise<boolean> {
  try {
    const failureReason = 'reason' in result ? result.reason : null;
    const { data, error } = await supabase.rpc('finalize_platform_sms_delivery_attempt', {
      p_delivery_id: deliveryId,
      p_purpose: purpose,
      p_state: result.ok ? 'accepted' : result.deliveryState,
      p_provider_request_id: result.providerRequestId,
      p_provider_status_code: result.providerStatusCode,
      p_failure_reason: failureReason,
    });
    return Boolean(
      !error
      && data
      && typeof data === 'object'
      && !Array.isArray(data)
      && data.ok === true,
    );
  } catch {
    return false;
  }
}

export async function finalizeFcSignupDeliveryAttempt(
  supabase: SupabaseClient,
  phone: string,
  deliveryId: string,
  result: SignupSmsResult,
): Promise<boolean> {
  try {
    const failureReason = 'reason' in result ? result.reason : null;
    const { data, error } = await supabase.rpc('finalize_fc_signup_otp_delivery_v1', {
      p_phone: phone,
      p_delivery_id: deliveryId,
      p_state: result.ok ? 'accepted' : result.deliveryState,
      p_provider_request_id: result.providerRequestId,
      p_provider_status_code: result.providerStatusCode,
      p_failure_reason: failureReason,
    });
    return Boolean(
      !error
      && data
      && typeof data === 'object'
      && !Array.isArray(data)
      && data.ok === true,
    );
  } catch {
    return false;
  }
}
