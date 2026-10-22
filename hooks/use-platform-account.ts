import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/hooks/use-session';
import { PlatformApiError, platformRequest, type PlatformAccount } from '@/lib/platform-api';
import { useReadAttempt } from '@/lib/use-read-attempt';

/** Shared account read for account, activity, benefits and referral screens. */
export function usePlatformAccount() {
  const session = useSession();
  const token = session.platformSessionToken ?? session.appSessionToken;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const begin = useReadAttempt();
  const [data, setData] = useState<PlatformAccount | null>(null);
  const dataOwner = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    const owns = begin();
    if (!token) { setData(null); setError(null); setErrorCode(null); setSignedOut(false); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await platformRequest<PlatformAccount>('get_account', {}, token);
      if (!owns() || tokenRef.current !== token) return;
      dataOwner.current = token; setData(next); setError(null); setErrorCode(null); setSignedOut(false);
    } catch (cause) {
      if (!owns() || tokenRef.current !== token) return;
      if (cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403 || cause.code === 'consent_required' || cause.code === 'enrollment_required')) setData(null);
      setErrorCode(cause instanceof PlatformApiError ? cause.code : null);
      setSignedOut(cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403) && cause.code !== 'consent_required' && cause.code !== 'enrollment_required');
      setError(cause instanceof Error ? cause.message : '내역을 불러오지 못했습니다.');
    } finally { if (owns() && tokenRef.current === token) setLoading(false); }
  }, [begin, token]);
  useEffect(() => {
    setData(null); setError(null); setErrorCode(null); setSignedOut(false);
    if (session.hydrated) void refresh();
  }, [refresh, session.hydrated]);
  const ownedData = dataOwner.current === token ? data : null;
  return { data: ownedData, error, signedOut, needsConsent: errorCode === 'consent_required' || errorCode === 'enrollment_required' || ownedData?.member.termsAccepted === false,
    canWithdraw: Boolean(session.platformMember || ownedData || errorCode === 'consent_required'), loading: !session.hydrated || loading, refresh, token, session };
}
