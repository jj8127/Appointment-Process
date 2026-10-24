import { createRequestBoardAccountRetirementAssertion, getEnv, sha256Hex } from './request-board-auth.ts';

export type RequestBoardFcRetirement =
  | { ok: true; affiliateState: 'erased' | 'company_account_preserved'; preservedRole: 'designer' | null }
  | { ok: false; reason: 'affiliate_identity_unbound' | 'affiliate_unavailable' };

type RetirementFetch = (input: URL, init: RequestInit) => Promise<Response>;

// GaramLink keeps its own users row bound to the FC id. Only an exact receipt
// for this FC and operation lets local erasure proceed; anything else stays put.
export async function retireRequestBoardFcAccount(
  fcId: string,
  operationId: string,
  phone?: string | null,
  fetchImpl: RetirementFetch = fetch,
): Promise<RequestBoardFcRetirement> {
  const unavailable = { ok: false, reason: 'affiliate_unavailable' } as const;
  const syncUrl = getEnv('REQUEST_BOARD_PASSWORD_SYNC_URL')?.trim() ?? '';
  const bridgeSecret = getEnv('REQUEST_BOARD_PASSWORD_SYNC_TOKEN')?.trim() ?? '';
  const sourcePhone = typeof phone === 'string' && /^01[0-9]{9}$/.test(phone) ? phone : undefined;
  const assertion = await createRequestBoardAccountRetirementAssertion(fcId, operationId, sourcePhone);
  if (!syncUrl || !bridgeSecret || !assertion) return unavailable;
  try {
    const endpoint = new URL(syncUrl);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return unavailable;
    endpoint.pathname = '/api/auth/retire-affiliate-account'; endpoint.search = ''; endpoint.hash = '';
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-request-bridge-token': bridgeSecret },
      body: JSON.stringify({ authAssertion: assertion }), signal: AbortSignal.timeout(10000) });
    const receipt = await response.json();
    if (response.status === 409 && ['AFFILIATE_IDENTITY_UNBOUND', 'AFFILIATE_COMPANY_IDENTITY_REVIEW_REQUIRED'].includes(receipt?.code))
      return { ok: false, reason: 'affiliate_identity_unbound' };
    const data = receipt?.data;
    if (!response.ok || receipt?.success !== true || data?.operationId !== operationId
      || data?.upstreamAccountId !== fcId || data?.policyVersion !== '2026-10-14'
      || typeof data?.alreadyApplied !== 'boolean') return unavailable;
    if (data.accountErased === true && data.runtimeRevoked === true
      && data.runtimeRevocationScope === 'persisted_auth_and_local_runtime'
      && data.remoteSocketRevalidationIntervalMs === 5000) return { ok: true, affiliateState: 'erased', preservedRole: null };
    // GaramLink holds no account for the signed phone: nothing remains to erase.
    if (sourcePhone && data.status === 'no_affiliate_account' && data.accountErased === false && data.runtimeRevoked === false)
      return { ok: true, affiliateState: 'erased', preservedRole: null };
    if (data.status === 'company_account_preserved' && data.accountErased === false && data.runtimeRevoked === false
      && data.preservedRole === 'designer' && data.independentLoginAvailable === true)
      return { ok: true, affiliateState: 'company_account_preserved', preservedRole: 'designer' };
    return unavailable;
  } catch { return unavailable; }
}

// GaramLink records one operation per retired FC, so a retry after a committed
// retirement must replay the same operation id to receive its receipt again.
export async function fcAccountDeletionRetirementOperationId(fcId: string) {
  const hex = await sha256Hex(`fc-account-deletion-retirement-v1:${fcId.toLowerCase()}`);
  const variant = (8 | (parseInt(hex[16], 16) & 3)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Hard FC deletion replaces the id on re-signup, so it must retire GaramLink first.
export async function retireFcBeforeAccountDeletion(
  fcId: string,
  phone: string | null | undefined,
  fetchImpl?: RetirementFetch,
) {
  return retireRequestBoardFcAccount(fcId, await fcAccountDeletionRetirementOperationId(fcId),
    typeof phone === 'string' ? phone.replace(/\D/g, '') : null, fetchImpl);
}

export function fcRetirementBlockedResponse(reason: 'affiliate_identity_unbound' | 'affiliate_unavailable') {
  return reason === 'affiliate_identity_unbound'
    ? { status: 409, code: 'affiliate_identity_unbound', message: '가람Link 계정 확인이 필요해 삭제할 수 없습니다.' }
    : { status: 503, code: 'affiliate_unavailable', message: '가람Link 계정을 정리하지 못해 삭제하지 않았습니다. 다시 시도해 주세요.' };
}
