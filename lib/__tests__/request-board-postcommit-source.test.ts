import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('request board create post-commit attachment flow', () => {
  it('retries attachment delivery from saved request and assignment ids only', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'request-board-create.tsx'),
      'utf8',
    );
    const apiSource = readFileSync(
      join(__dirname, '..', 'request-board-api.ts'),
      'utf8',
    );

    expect(source).toContain('setSentRequestIds((previousIds) =>');
    expect(source).toContain('Array.from(new Set([...previousIds, ...createdRequestIds]))');
    expect(source).toContain('deliverCreatedRequestAttachments(pending, attachments');
    expect(source).toContain('setPendingAttachmentDelivery(deliveryResult.pending)');
    expect(source).toContain("import { randomUUID } from 'expo-crypto'");
    expect(source).toContain('requestCreateIntentRef');
    expect(source).toContain('requestDraftFingerprint');
    expect(source).toContain('previousClientRequestKeys[jobKey]');
    expect(source).toContain('clientRequestKey:');
    expect(source).toContain('`garamin_request:${randomUUID()}`');
    expect(source).toContain('failedRequestResults.map(({ job })');
    expect(source).toContain('onPress={() => void submitRequest(true)}');
    expect(source).toContain('실패한 요청 다시 시도');
    expect(source).toContain('deliveryBatchKey: `garamin_attachment:${randomUUID()}`');
    expect(source).toContain('getRequestBoardNotificationFeedback(result)');
    expect(source).toContain('requestNotificationFeedback.title');
    expect(source).toContain(
      "batchNotificationFeedback?.title ?? '일부 설계요청만 전송되었습니다'",
    );
    expect(apiSource).toContain('deliveryKey?: string');
    expect(apiSource).toContain('...(deliveryKey ? { deliveryKey } : {})');
    expect(source).toContain('const retryAttachmentDelivery = async () =>');
    expect(source).toContain('await runAttachmentDelivery(pendingAttachmentDelivery)');
    expect(source).toContain('요청을 다시 만들지 말고 첨부 전달만 다시 시도해주세요.');
    expect(
      source.indexOf('const retryAttachmentDelivery = async () =>'),
    ).toBeGreaterThan(source.indexOf('const runAttachmentDelivery = async'));
  });
});
