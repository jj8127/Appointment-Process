import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', '..', 'app', 'chat.tsx'), 'utf8');

describe('1:1 failed send bubble', () => {
  it('keeps a definitely refused bubble as failed instead of an alert that drops it', () => {
    expect(source).toContain("definiteFailureMessage = failure.message;");
    expect(source).not.toContain("Alert.alert(attachmentBatch ? '파일 전송 실패' : '전송 실패', failure.message);");
    expect(source).toMatch(/local_status: 'failed' as const/);
    expect(source).toContain('failedPayloadsRef.current.set(optimisticMessage.id');
  });

  it('keeps the same-request recheck for uncertain results, so a retry never duplicates', () => {
    expect(source).toContain("'메시지 전송 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하면 중복 전송되지 않습니다.'");
  });

  it('offers retry and delete from the bubble and hides the unread count on it', () => {
    expect(source).toContain("accessibilityLabel=\"전송 실패, 다시 보내기 또는 삭제\"");
    expect(source).toContain("{ text: '다시 보내기', onPress: () => resendFailedMessage(message.id) }");
    expect(source).toContain('const unreadReceiptCount = isFailed ? 0 : getDirectMessageUnreadCount');
  });
});
