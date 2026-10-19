import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useSession } from '@/hooks/use-session';
import { normalizeReferralInviteCode, savePendingReferralCode } from '@/lib/referral-deeplink';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { resolveLegacyAuthRoute } from '@/lib/session-landing';

/** Keep old FC invitation links separate from the common member referrer. */
export default function LegacySignupRedirect() {
  const params = useLocalSearchParams<{ service?: string; code?: string; skipAuto?: string; referralNonce?: string }>();
  const { hydrated, role, residentId, platformMember } = useSession();
  const invitationKey = JSON.stringify([params.code, params.service, role, residentId, platformMember?.id]);
  const [preparedKey, setPreparedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    const ownsSession = captureAppSessionOwner();
    const code = normalizeReferralInviteCode(params.code);
    const save = !role && code && (params.service === undefined || params.service === 'insurance')
      ? savePendingReferralCode(code) : Promise.resolve();
    void save.catch(() => undefined).then(() => { if (active && ownsSession()) setPreparedKey(invitationKey); });
    return () => { active = false; };
  }, [hydrated, role, params.code, params.service, invitationKey]);
  return hydrated && preparedKey === invitationKey ? <Redirect href={resolveLegacyAuthRoute(params, 'signup')} /> : null;
}
