import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWebPushClientConfigState,
  getWebPushRegistrationFeedback,
  getWebPushServerConfigState,
} from './web-push-config.ts';

test('reports missing client VAPID key as an explicit config-needed state', () => {
  assert.deepStrictEqual(getWebPushClientConfigState(undefined), {
    isConfigured: false,
    reason: 'missing-vapid-key',
    publicKey: '',
    missingEnv: ['NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY'],
    statusText: '이 배포에는 웹 알림 설정이 없습니다.',
    buttonLabel: '배포 설정 필요',
    helpText:
      '이 배포에는 웹 푸시 설정이 없어 브라우저 등록을 건너뜁니다. 프리뷰 배포라면 정상일 수 있으며, 운영에서는 웹 푸시 환경 변수를 설정해야 합니다. 필요한 값: NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY',
  });
});

test('maps missing client config to operator-facing preview-safe guidance', () => {
  const feedback = getWebPushRegistrationFeedback('missing-vapid-key');
  assert.equal(feedback.color, 'orange');
  assert.equal(feedback.title, '웹 알림 미설정 배포');
  assert.match(feedback.message, /프리뷰 배포/);
  assert.match(feedback.message, /NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY/);
});

test('reports missing server-side VAPID env names explicitly', () => {
  assert.deepStrictEqual(
    getWebPushServerConfigState({
      publicKey: ' public ',
      privateKey: '',
      subject: undefined,
    }),
    {
      isConfigured: false,
      reason: 'missing-vapid-config',
      publicKey: 'public',
      privateKey: '',
      subject: '',
      missingEnv: ['WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_SUBJECT'],
    },
  );
});
