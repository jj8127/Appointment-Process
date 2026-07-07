const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';
const DEFAULT_INVITE_BASE_URL = 'https://garam-invite.vercel.app';

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return (trimmed || DEFAULT_INVITE_BASE_URL).replace(/\/$/, '');
}

export function buildReferralInviteUrl(code: string, baseUrl?: string) {
  const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${normalizeBaseUrl(baseUrl)}/?code=${encodeURIComponent(normalizedCode)}`;
}

export function buildReferralShareText({
  code,
  inviteBaseUrl,
  appStoreUrl,
}: {
  code: string;
  inviteBaseUrl?: string;
  appStoreUrl?: string;
}) {
  const iosInstallLine = appStoreUrl?.trim()
    ? `iOS: ${appStoreUrl.trim()}`
    : 'iOS: App Store에서 "가람in" 검색';
  const inviteUrl = buildReferralInviteUrl(code, inviteBaseUrl);

  return [
    '가람in에서 보험 위촉을 함께 시작해요!',
    '',
    '아래 링크를 눌러 가입하세요 (추천 코드 자동 입력):',
    inviteUrl,
    '',
    '앱이 없으시면:',
    `Android: ${PLAY_STORE_URL}`,
    iosInstallLine,
  ].join('\n');
}
