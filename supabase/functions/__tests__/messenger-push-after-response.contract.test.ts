import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runAfterResponse } from '../_shared/run-after-response';

const root = join(__dirname, '..');
const fcNotify = readFileSync(join(root, 'fc-notify', 'index.ts'), 'utf8');
const groupChat = readFileSync(join(root, 'group-chat', 'index.ts'), 'utf8');

describe('messenger send answers before push', () => {
  afterEach(() => {
    delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  });

  it('hands the task to EdgeRuntime.waitUntil and never rejects', async () => {
    const waited: Promise<unknown>[] = [];
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
    const errors: unknown[] = [];
    const done = runAfterResponse(async () => { throw new Error('push down'); }, (error) => errors.push(error));
    expect(waited).toHaveLength(1);
    await expect(done).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    await expect(runAfterResponse(async () => { throw new Error('x'); }, () => { throw new Error('reporter'); })).resolves.toBeUndefined();
  });

  it('still runs the task where no Edge runtime exists', async () => {
    let ran = false;
    await runAfterResponse(async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('1:1 send returns once the message and notification rows are saved, and pushes afterwards', () => {
    const start = fcNotify.indexOf('const deliverPush = async () => {');
    const schedule = fcNotify.indexOf('if (recipientCount > 0) runAfterResponse(deliverPush);');
    expect(start).toBeGreaterThan(0);
    expect(schedule).toBeGreaterThan(start);
    const pushBody = fcNotify.slice(start, schedule);
    expect(pushBody).toContain(".from('device_tokens')");
    expect(pushBody).toContain('await sendExpoPushPayloads(pushPayload)');
    // Persistence and mute suppression stay before the response.
    expect(fcNotify.indexOf("'send_garamin_direct_message_with_notification'")).toBeLessThan(start);
    expect(fcNotify.indexOf('applyDirectMessageNotificationPreferences(')).toBeLessThan(start);
    const response = fcNotify.slice(schedule, schedule + 900);
    expect(response).toContain("pushStatus: recipientCount > 0 ? 'not_attempted' : 'no_registered_device'");
    expect(response).not.toContain('expoDelivery');
  });

  it('group send saves inbox rows first and defers only the native push', () => {
    expect(groupChat).toContain('deferNativePush: true,');
    const notify = groupChat.slice(groupChat.indexOf('async function notifyRecipients('), groupChat.indexOf('async function sendGroupChatNativePush('));
    expect(notify.indexOf('if (notificationInsert.failed)')).toBeLessThan(notify.indexOf('if (input.deferNativePush)'));
    expect(notify).toContain('() => sendGroupChatNativePush(input, recipients, notificationInsert)');
    expect(notify).not.toContain(".from('device_tokens')");
    const push = groupChat.slice(groupChat.indexOf('async function sendGroupChatNativePush('), groupChat.indexOf('function notificationFanoutFailureSummary('));
    expect(push).toContain(".from('device_tokens')");
    expect(push).toContain('await sendExpoPushPayloads(pushPayload)');
    // The notification-only retry keeps waiting for the push result.
    const retryCalls = groupChat.split('notifyRecipients({').length - 1;
    expect(retryCalls).toBe(2);
    expect(groupChat.split('deferNativePush: true').length - 1).toBe(1);
  });
});
