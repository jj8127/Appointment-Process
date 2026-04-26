const normalizeWebPushEnvValue = (value?: string | null) =>
  (value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n/g, '')
    .trim();

export const normalizeWebPushKey = (value?: string | null) =>
  normalizeWebPushEnvValue(value).replace(/\s+/g, '');

export type WebPushClientConfigState = {
  isConfigured: boolean;
  reason: 'ok' | 'missing-vapid-key';
  publicKey: string;
  missingEnv: string[];
  statusText: string;
  buttonLabel: string;
  helpText?: string;
};

export type WebPushServerConfigState = {
  isConfigured: boolean;
  reason: 'ok' | 'missing-vapid-config';
  publicKey: string;
  privateKey: string;
  subject: string;
  missingEnv: string[];
};

export type WebPushRegistrationFeedback = {
  title: string;
  message: string;
  color: 'orange' | 'red';
};

const previewSafeConfigMessage =
  '이 배포에는 웹 푸시 설정이 없어 브라우저 등록을 건너뜁니다. 프리뷰 배포라면 정상일 수 있으며, 운영에서는 웹 푸시 환경 변수를 설정해야 합니다.';

export const getWebPushClientConfigState = (publicKey?: string | null): WebPushClientConfigState => {
  const normalizedPublicKey = normalizeWebPushKey(publicKey);
  if (normalizedPublicKey) {
    return {
      isConfigured: true,
      reason: 'ok',
      publicKey: normalizedPublicKey,
      missingEnv: [],
      statusText: '웹 알림 등록 가능',
      buttonLabel: '웹 알림 허용',
    };
  }

  return {
    isConfigured: false,
    reason: 'missing-vapid-key',
    publicKey: '',
    missingEnv: ['NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY'],
    statusText: '이 배포에는 웹 알림 설정이 없습니다.',
    buttonLabel: '배포 설정 필요',
    helpText: `${previewSafeConfigMessage} 필요한 값: NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`,
  };
};

export const getWebPushServerConfigState = ({
  publicKey,
  privateKey,
  subject,
}: {
  publicKey?: string | null;
  privateKey?: string | null;
  subject?: string | null;
}): WebPushServerConfigState => {
  const normalizedPublicKey = normalizeWebPushKey(publicKey);
  const normalizedPrivateKey = normalizeWebPushKey(privateKey);
  const normalizedSubject = normalizeWebPushEnvValue(subject);
  const missingEnv = [
    !normalizedPublicKey ? 'NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY' : null,
    !normalizedPrivateKey ? 'WEB_PUSH_VAPID_PRIVATE_KEY' : null,
    !normalizedSubject ? 'WEB_PUSH_SUBJECT' : null,
  ].filter((value): value is string => Boolean(value));

  if (missingEnv.length > 0) {
    return {
      isConfigured: false,
      reason: 'missing-vapid-config',
      publicKey: normalizedPublicKey,
      privateKey: normalizedPrivateKey,
      subject: normalizedSubject,
      missingEnv,
    };
  }

  return {
    isConfigured: true,
    reason: 'ok',
    publicKey: normalizedPublicKey,
    privateKey: normalizedPrivateKey,
    subject: normalizedSubject,
    missingEnv: [],
  };
};

export const getWebPushRegistrationFeedback = (
  reason?: string,
): WebPushRegistrationFeedback => {
  if (reason === 'unsupported') {
    return {
      title: '지원되지 않음',
      message: '현재 브라우저에서는 웹 알림을 지원하지 않습니다.',
      color: 'orange',
    };
  }

  if (reason === 'permission-not-granted') {
    return {
      title: '알림 권한 필요',
      message: '브라우저 사이트 설정에서 알림을 허용한 뒤 다시 시도해주세요.',
      color: 'orange',
    };
  }

  if (reason === 'missing-session') {
    return {
      title: '세션 확인 필요',
      message: '로그인 세션을 확인한 뒤 다시 시도해주세요.',
      color: 'red',
    };
  }

  if (reason === 'missing-vapid-key') {
    return {
      title: '웹 알림 미설정 배포',
      message: `${previewSafeConfigMessage} 필요한 값: NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`,
      color: 'orange',
    };
  }

  if (reason === 'missing-subscription') {
    return {
      title: '웹 알림 등록 실패',
      message: '브라우저 구독 정보를 만들지 못했습니다. 새로고침 후 다시 시도해주세요.',
      color: 'red',
    };
  }

  if (reason === 'subscribe-api-500') {
    return {
      title: '웹 알림 서버 설정 확인 필요',
      message:
        '브라우저 구독을 서버에 저장하지 못했습니다. 프리뷰 배포라면 Supabase 또는 admin-push 관련 환경 변수가 빠졌는지 확인해주세요.',
      color: 'red',
    };
  }

  if (reason?.startsWith('subscribe-api-')) {
    return {
      title: '웹 알림 등록 실패',
      message: `서버가 브라우저 구독 등록을 거부했습니다. (${reason.replace('subscribe-api-', 'HTTP ')})`,
      color: 'red',
    };
  }

  return {
    title: '웹 알림 등록 실패',
    message: reason ?? '알림 등록 중 오류가 발생했습니다.',
    color: 'red',
  };
};
