import fs from 'node:fs';
import path from 'node:path';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8').replace(/\r\n/g, '\n');

describe('admin web exam and notice notification completion contract', () => {
  const examAction = readRepoFile('web/src/app/dashboard/exam/schedule/actions.ts');
  const examPage = readRepoFile('web/src/app/dashboard/exam/schedule/page.tsx');
  const noticeAction = readRepoFile('web/src/app/dashboard/notifications/actions.ts');
  const noticeCreatePage = readRepoFile('web/src/app/dashboard/notifications/create/page.tsx');

  it('keeps an exam save successful once the notification is logged, even without a registered device', () => {
    const saveStart = examAction.indexOf('export async function saveExamRoundAction');
    const fetchStart = examAction.indexOf('export async function fetchExamRoundsAction');
    const saveSource = examAction.slice(saveStart, fetchStart);

    expect(examAction).toContain('response.ok !== true');
    expect(examAction).toContain('response.logged !== true');
    expect(examAction).toContain('const accepted = readNonNegativeInteger(delivery?.accepted)');
    expect(examAction).toContain('readNonNegativeInteger(response.sent) !== accepted');
    expect(examAction).toContain("getNotificationDeliveryFeedback('no_registered_device')");
    expect(examAction).not.toContain("reason: 'no_accepted_target'");
    expect(saveSource).toContain('const notificationResult = await notifyExamRoundChanged');
    const saveRpcIndex = saveSource.indexOf("'save_exam_round_atomic_v2'");
    const notifyIndex = saveSource.indexOf('await notifyExamRoundChanged');
    expect(saveRpcIndex).toBeGreaterThan(-1);
    expect(notifyIndex).toBeGreaterThan(saveRpcIndex);
    expect(saveSource).toContain('success: true');
    expect(saveSource).toContain(
      "notificationResult.feedback.severity === 'warning'",
    );
    expect(saveSource).toContain(
      "notificationResult.feedback.severity === 'error'",
    );
    expect(saveSource).not.toContain("logger.warn('[saveExamRound] fc-notify invoke failed', error)");
    expect(saveSource).not.toContain("logger.warn('[saveExamRound] fc-notify returned failure', data)");
  });

  it('keeps non-fatal exam notification diagnostics out of operator feedback', () => {
    expect(examPage).toContain('return result;');
    expect(examPage).not.toContain('if (result.notificationWarning)');
    expect(examPage).not.toContain("title: '알림 전달 확인 필요'");
  });

  it('classifies Expo HTTP and ticket failures without browser Web Push delivery', () => {
    expect(noticeAction).toContain('classifyExpoPushDelivery(chunk.length, resp.status, responseBody)');
    expect(noticeAction).toContain('mergeExpoPushDeliverySummaries([mobileDelivery, chunkDelivery])');
    expect(noticeAction).toContain('const acceptedTargets = mobileDelivery.accepted');
    expect(noticeAction).toContain('const failedTargets = mobileDelivery.rejected');
    expect(noticeAction).not.toContain('sendWebPush');
    expect(noticeAction).not.toContain('web_push_subscriptions');
    expect(noticeAction).toContain('if (notifError && acceptedTargets < 1)');
    expect(noticeAction).toContain('else if (targetQueriesFailed || acceptedTargets < 1)');
    expect(noticeAction).toContain('else if (failedTargets > 0)');
    expect(noticeAction).not.toContain('tokens,\n    });');
    expect(noticeAction).not.toContain('body: text');
  });

  it('keeps the notice saved and logs delivery diagnostics without a second warning toast', () => {
    const saveStart = noticeAction.indexOf(".from('notices')");
    const notificationStart = noticeAction.indexOf(".from('notifications')", saveStart);
    const returnStart = noticeAction.indexOf('return {\n        success: true', notificationStart);

    expect(saveStart).toBeGreaterThan(-1);
    expect(notificationStart).toBeGreaterThan(saveStart);
    expect(returnStart).toBeGreaterThan(notificationStart);
    expect(noticeAction).toContain("message: notificationWarning");
    expect(noticeAction).toContain("'공지사항이 등록되었습니다.'");
    expect(noticeAction).not.toContain('공지사항이 등록 및 발송되었습니다.');
    expect(noticeCreatePage).not.toContain('if (result.notificationWarning)');
    expect(noticeCreatePage).not.toContain("title: '알림 전달 확인 필요'");
  });
});
