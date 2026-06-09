const REFERRAL_GRAPH_PATH = '/dashboard/referrals/graph';

export function buildReferralGraphWebUrl(adminWebUrl: string | null | undefined) {
  const baseUrl = adminWebUrl?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}${REFERRAL_GRAPH_PATH}`;
}
