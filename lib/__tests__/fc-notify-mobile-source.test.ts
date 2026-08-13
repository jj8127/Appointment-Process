import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const wrapperPath = join(root, 'lib', 'fc-notify-client.ts');
const edgeFunctionPath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return collectSourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('fc-notify mobile source ownership', () => {
  it('keeps every app/lib Edge invocation behind the authenticated wrapper', () => {
    const directInvokePattern = /functions\s*\.\s*invoke(?:\s*<[^;]*?>)?\s*\(\s*['"]fc-notify['"]/m;
    const directEndpointPattern = /functions\/v1\/fc-notify/;
    const offenders = [
      ...collectSourceFiles(join(root, 'app')),
      ...collectSourceFiles(join(root, 'lib')),
    ]
      .filter((path) => path !== wrapperPath)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return directInvokePattern.test(source) || directEndpointPattern.test(source);
      });

    expect(offenders).toEqual([]);
  });

  it('keeps direct-message rows and Realtime changes behind the trusted service boundary', () => {
    const productionPaths = [
      ...collectSourceFiles(join(root, 'app')),
      ...collectSourceFiles(join(root, 'components')),
      ...collectSourceFiles(join(root, 'hooks')),
      ...collectSourceFiles(join(root, 'lib')),
    ];
    const offenders = productionPaths.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return (
        /\.from\(\s*['"]messages['"]\s*\)/.test(source)
        || /table:\s*['"]messages['"]/.test(source)
      );
    });

    expect(offenders).toEqual([]);

    const chatSource = readFileSync(join(root, 'app', 'chat.tsx'), 'utf8');
    const adminMessengerSource = readFileSync(
      join(root, 'app', 'admin-messenger.tsx'),
      'utf8',
    );
    expect(chatSource).toContain("from '@/lib/direct-message-api'");
    expect(adminMessengerSource).toContain(
      'conversationId: item.conversation_id',
    );
  });

  it('keeps the wrapper on the anon Supabase client while adding a separate session header', () => {
    const source = readFileSync(wrapperPath, 'utf8');

    expect(source).toContain("import { supabase } from './supabase'");
    expect(source).toContain("'x-app-session-token'");
    expect(source).toContain('supabase.functions.invoke<TResponse>');
    expect(source).not.toContain('functions.setAuth');
    expect(source).not.toContain('Authorization:');
  });

  it('shows post-commit warnings only for canonical inbox persistence failures', () => {
    const readApp = (relativePath: string) =>
      readFileSync(join(root, 'app', relativePath), 'utf8');
    const sources = [
      readApp('admin-notice.tsx'),
      readApp('docs-upload.tsx'),
      readApp(join('fc', 'new.tsx')),
      readApp('exam-apply.tsx'),
      readApp('exam-apply2.tsx'),
      readApp('exam-register.tsx'),
      readApp('exam-register2.tsx'),
    ];

    for (const source of sources) {
      expect(source).toContain('invokeFcNotifyForDelivery');
      expect(source).not.toContain('알림 확인 필요');
    }

    const dashboardSource = readApp('dashboard.tsx');
    expect(dashboardSource).toContain("'sendNotification'");
    expect(dashboardSource).toContain('classifyFcNotifyDeliveryResult');
    expect(dashboardSource).toContain('push.notificationStored === false');
    expect(dashboardSource).toContain('confirmed: push.notificationStored !== false');
    expect(dashboardSource).not.toContain('inboxRecorded && push.confirmed');
    expect(dashboardSource).not.toContain('rawPush.sent > 0');
    expect(dashboardSource).not.toContain("rawPush?.reason === 'no_device_target'");
    expect(dashboardSource).not.toContain('알림 확인 필요');
    expect(dashboardSource).toContain('if (!notificationResult.confirmed)');
    expect(dashboardSource).toContain("notificationResult.push.notificationStored === false");
    expect(dashboardSource).not.toContain("Alert.alert('전송 실패'");
    expect(readFileSync(wrapperPath, 'utf8')).toContain(
      "logger.warn('[fc-notify] delivery unconfirmed'",
    );
    expect(dashboardSource).not.toContain('ignore notification failures');
    expect(dashboardSource).not.toContain('ignore push failures');
    expect(readApp('docs-upload.tsx')).not.toContain('Promise.allSettled(notificationJobs)');
    expect(readApp('docs-upload.tsx')).toMatch(/sendNotificationAndPush\(\s*'admin',\s*null,/);
    expect(readApp(join('fc', 'new.tsx'))).not.toMatch(/void sendNotificationAndPush\(/);
    expect(readApp(join('fc', 'new.tsx'))).toMatch(/sendNotificationAndPush\(\s*'admin',\s*null,/);
    for (const path of ['exam-register.tsx', 'exam-register2.tsx']) {
      expect(readApp(path)).not.toMatch(/void notifyExamFlow\(/);
    }
  });

  it('requires confirmed delivery for mobile exam approval notifications', () => {
    const source = readFileSync(join(root, 'lib', 'exam-approval-notify.ts'), 'utf8');

    expect(source).toContain('invokeFcNotifyForDelivery');
    expect(source).toContain("delivery.reason === 'invalid_recipient'");
    expect(source).toContain('delivery.notificationStored === false');
    expect(source).toContain('reason: delivery.reason');
    expect(source).not.toContain('return false;');
    expect(source).not.toMatch(/\binvokeFcNotify\s*\(/);
    expect(source).not.toContain('if (!data?.ok)');
  });

  it('builds direct-chat URLs and sender metadata for every message recipient role', () => {
    const source = readFileSync(edgeFunctionPath, 'utf8');

    expect(source).toContain("body.type === 'message' && !body.url && body.sender_id?.trim()");
    expect(source).not.toContain("body.type === 'message' && target_role === 'admin' && !body.url");
    expect(source).toContain('url = `/chat?targetId=${encodeURIComponent(body.sender_id)}&targetName=${encodeURIComponent(resolvedSenderName)}`');
    expect(source).toContain('sender_id: body.sender_id.trim()');
    expect(source).toContain("sender_name: redactSensitiveText(body.sender_name ?? '', '')");
  });

  it('routes approval and approval release through the server transition that sends push after commit', () => {
    for (const path of ['exam-manage.tsx', 'exam-manage2.tsx']) {
      const source = readFileSync(join(root, 'app', path), 'utf8');

      expect(source).toContain('transitionExamRegistrationAsAdmin');
      expect(source).toContain("action: params.value ? 'confirm' : 'unconfirm'");
      expect(source).not.toContain('알림 확인 필요');
      expect(source).not.toContain('notifyFcExamApprovalStatus');
    }

    const edgeSource = readFileSync(
      join(root, 'supabase', 'functions', 'admin-action', 'index.ts'),
      'utf8',
    );
    const transitionBlock =
      edgeSource.split("if (action === 'transitionExamRegistration'")[1]
        ?.split("if (action === 'deleteFc')")[0] ?? '';
    expect(transitionBlock).toContain(".rpc('transition_exam_registration'");
    expect(transitionBlock).toContain('sendCanonicalFcPush');
    expect(transitionBlock.indexOf(".rpc('transition_exam_registration'"))
      .toBeLessThan(transitionBlock.indexOf('sendCanonicalFcPush'));
  });
});
