import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildBrowserFcNotifyPayload,
  buildRequestBoardNotifyPayload,
  classifyFcNotifyIngress,
  REQUEST_BOARD_NOTIFY_CATEGORIES,
  verifyBrowserSameOrigin,
  verifyRequestBoardBridgeToken,
} from '../../web/src/lib/fc-notify-proxy-policy';
import { getWebStaffSenderName } from '../../web/src/lib/staff-identity';

const root = join(__dirname, '..', '..');
const routePath = join(root, 'web', 'src', 'app', 'api', 'fc-notify', 'route.ts');
const fcNotifyEdgePath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');
const serverSessionPath = join(root, 'web', 'src', 'lib', 'server-session.ts');
const examApplicantsPath = join(root, 'web', 'src', 'app', 'dashboard', 'exam', 'applicants', 'page.tsx');
const examApplicantsApiPath = join(
  root,
  'web',
  'src',
  'app',
  'api',
  'admin',
  'exam-applicants',
  'route.ts',
);

describe('FC notify proxy ingress authentication', () => {
  it('requires the public route to authenticate browser and Request Board ingress before proxying', () => {
    const route = readFileSync(routePath, 'utf8');

    expect(route).toContain('getVerifiedServerSession');
    expect(route).toContain('verifyRequestBoardBridgeToken');
    expect(route).toContain('buildBrowserFcNotifyPayload');
    expect(route).toContain('buildRequestBoardNotifyPayload');
    expect(route).toContain('resolveCompletedFcTargetActorId');
    expect(route).toContain('resolveEligibleAdminChatTargetActorId');
    expect(route).toContain('recipient_actor_id: recipientActorId');
    expect(route).not.toContain('body: JSON.stringify(body)');
    expect(route).not.toContain('JSON.stringify(rawBody)');
    expect(route).toContain('body: JSON.stringify(payload)');
    expect(route).toContain('signal: AbortSignal.timeout(FC_NOTIFY_PROXY_TIMEOUT_MS)');
    expect(route).toContain('ok: response.ok && downstreamOk');
    expect(route).toContain("reason: timedOut ? 'timeout' : 'network_error'");
    expect(route).not.toMatch(/catch \{\s*data = text;\s*\}/);
    expect(route).toContain('headers: SECURITY_HEADERS');
    expect(route.indexOf('classifyFcNotifyIngress(rawBody')).toBeLessThan(
      route.indexOf('getVerifiedServerSession({'),
    );
    expect(route.indexOf('buildBrowserFcNotifyPayload({')).toBeLessThan(
      route.indexOf('resolveEligibleAdminChatTargetActorId(browserPolicy.payload.target_id)'),
    );
    expect(route.indexOf('buildRequestBoardNotifyPayload({')).toBeLessThan(
      route.indexOf('resolveCompletedFcTargetActorId(bridgePolicy.payload.target_id)'),
    );
    expect(route.indexOf('resolveCompletedFcTargetActorId(bridgePolicy.payload.target_id)')).toBeLessThan(
      route.indexOf('recipient_actor_id: recipientActorId'),
    );
    const bridgeResolver = route
      .split('async function resolveCompletedFcTargetActorId')[1]
      ?.split('async function resolveEligibleAdminChatTargetActorId')[0] ?? '';
    expect(bridgeResolver).not.toContain('buildAdminChatTargets');
    expect(bridgeResolver).toContain('matches.length === 1');
  });

  it('verifies the Request Board secret in constant time and emits only the narrow notify payload', () => {
    expect(REQUEST_BOARD_NOTIFY_CATEGORIES).toEqual([
      'request_board_new_request',
      'request_board_accepted',
      'request_board_rejected',
      'request_board_completed',
      'request_board_cancelled',
      'request_board_fc-accepted',
      'request_board_fc-rejected',
      'request_board_message',
    ]);
    expect(verifyRequestBoardBridgeToken('shared-secret', 'shared-secret')).toBe(true);
    expect(verifyRequestBoardBridgeToken('wrong', 'shared-secret')).toBe(false);
    expect(verifyRequestBoardBridgeToken('', 'shared-secret')).toBe(false);

    const result = buildRequestBoardNotifyPayload({
      providedToken: 'shared-secret',
      expectedToken: 'shared-secret',
      body: {
        type: 'notify',
        target_role: 'fc',
        target_id: '01012345678',
        title: ' Request updated ',
        body: ' Open the request. SENTRY_READ_AUTH_TOKEN=bridge-secret ',
        category: 'request_board_completed',
        url: '/notifications?source=request-board',
        target: { version: 1, kind: 'request', requestId: 321 },
        skip_notification_insert: true,
        sender_id: 'forged',
        recipient_actor_id: '00000000-0000-4000-8000-000000000099',
      },
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        type: 'notify',
        target_role: 'fc',
        target_id: '01012345678',
        title: 'Request updated',
        body: 'Open the request. SENTRY_READ_AUTH_TOKEN=[redacted]',
        category: 'request_board_completed',
        target: { version: 1, kind: 'request', requestId: 321 },
      },
    });
    expect(buildRequestBoardNotifyPayload({
      providedToken: 'shared-secret',
      expectedToken: 'shared-secret',
      body: {
        type: 'notify',
        target_role: 'fc',
        target_id: '01012345678',
        title: 'Request updated',
        body: 'Open the request.',
        category: 'request_board_completed',
        url: '/notifications?source=request-board',
        target: {
          version: 1,
          kind: 'board_post',
          postId: '00000000-0000-4000-8000-000000000321',
        },
      },
    })).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid Request Board notification target',
    });
  });

  it('rejects missing bridge configuration, non-allowlisted categories, and external URLs', () => {
    const base = {
      type: 'notify',
      target_role: 'fc',
      target_id: '01012345678',
      title: 'Request updated',
      body: 'Open the request.',
      category: 'request_board_completed',
      url: '/notifications',
    };

    expect(buildRequestBoardNotifyPayload({
      body: base,
      providedToken: 'secret',
      expectedToken: '',
    })).toMatchObject({ ok: false, status: 503 });
    expect(buildRequestBoardNotifyPayload({
      body: { ...base, category: 'request_board_arbitrary' },
      providedToken: 'secret',
      expectedToken: 'secret',
    })).toMatchObject({ ok: false, status: 403 });
    expect(buildRequestBoardNotifyPayload({
      body: { ...base, url: 'https://attacker.invalid/notifications' },
      providedToken: 'secret',
      expectedToken: 'secret',
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects traversal before URL normalization and never forwards the legacy URL', () => {
    const target = { version: 1, kind: 'request' as const, requestId: 321 };
    const base = {
      type: 'notify',
      target_role: 'fc',
      target_id: '01012345678',
      title: 'Request updated',
      body: 'Open the request.',
      category: 'request_board_completed',
      target,
    };
    for (const url of [
      '/a/../b',
      '/%2e%2e/b',
      '/%252e%252e/b',
      '/a\\..\\b',
      '//attacker.invalid/b',
    ]) {
      expect(buildRequestBoardNotifyPayload({
        body: { ...base, url },
        providedToken: 'secret',
        expectedToken: 'secret',
      })).toMatchObject({ ok: false, status: 400 });
    }

    const benign = buildRequestBoardNotifyPayload({
      body: { ...base, url: '/request/321?source=notification' },
      providedToken: 'secret',
      expectedToken: 'secret',
    });
    expect(benign).toMatchObject({ ok: true });
    if (!benign.ok) return;
    expect(benign.payload).not.toHaveProperty('url');
    expect(benign.payload.target).toEqual(target);
  });

  it('redacts the complete bridge text before applying notification bounds', () => {
    const result = buildRequestBoardNotifyPayload({
      providedToken: 'shared-secret',
      expectedToken: 'shared-secret',
      body: {
        type: 'notify',
        target_role: 'fc',
        target_id: '01012345678',
        title: 'Request updated',
        body: `${'X'.repeat(1979)} ${'a'.repeat(40)}`,
        category: 'request_board_completed',
        url: '/notifications',
        target: { version: 1, kind: 'request', requestId: 321 },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.body).toHaveLength(1990);
    expect(result.payload.body).toContain('[redacted]');
    expect(result.payload.body).not.toContain('a'.repeat(20));
  });

  it('requires browser same-origin evidence', () => {
    expect(verifyBrowserSameOrigin({
      origin: 'https://admin.example.com',
      host: 'admin.example.com',
      requestUrl: 'https://admin.example.com/api/fc-notify',
    })).toEqual({ ok: true });
    expect(verifyBrowserSameOrigin({
      host: 'admin.example.com',
      requestUrl: 'https://admin.example.com/api/fc-notify',
    }))
      .toMatchObject({ ok: false, status: 403 });
    expect(verifyBrowserSameOrigin({
      origin: 'https://attacker.invalid',
      host: 'admin.example.com',
      requestUrl: 'https://admin.example.com/api/fc-notify',
    })).toMatchObject({ ok: false, status: 403 });
    expect(verifyBrowserSameOrigin({
      origin: 'https://attacker.invalid',
      host: 'admin.example.com',
      forwardedHost: 'attacker.invalid',
      requestUrl: 'https://admin.example.com/api/fc-notify',
    })).toMatchObject({ ok: false, status: 403 });
    expect(verifyBrowserSameOrigin({
      origin: 'https://attacker.invalid',
      forwardedHost: 'attacker.invalid',
      requestUrl: 'https://attacker.invalid/api/fc-notify',
    })).toMatchObject({ ok: false, status: 403 });
    expect(verifyBrowserSameOrigin({
      origin: 'http://admin.example.com',
      host: 'admin.example.com',
      requestUrl: 'https://admin.example.com/api/fc-notify',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('binds signed FC sessions to the same completed profile before authorizing', () => {
    const serverSession = readFileSync(serverSessionPath, 'utf8');

    expect(serverSession).toContain(".eq('id', expectedFcId)");
    expect(serverSession).toContain("query = query.eq('signup_completed', true)");
    expect(serverSession).toContain('fcGraphSession.fcId');
  });

  it('rebuilds inbox and unread identities from verified browser sessions', () => {
    const regularAdmin = {
      role: 'admin' as const,
      residentDigits: '01011112222',
      displayName: 'Admin One',
      staffType: 'admin' as const,
    };
    const manager = {
      role: 'manager' as const,
      residentDigits: '01033334444',
      displayName: 'Manager One',
      staffType: null,
    };

    expect(buildBrowserFcNotifyPayload({
      session: regularAdmin,
      body: {
        type: 'inbox_list',
        role: 'admin',
        resident_id: null,
        limit: 999,
        viewer_actor_role: 'fc',
        viewer_actor_phone: '01099999999',
      },
    })).toEqual({
      ok: true,
      payload: {
        type: 'inbox_list',
        role: 'admin',
        resident_id: null,
        limit: 200,
        viewer_actor_role: 'admin',
        viewer_actor_phone: '01011112222',
      },
    });
    expect(buildBrowserFcNotifyPayload({
      session: regularAdmin,
      body: { type: 'inbox_list', role: 'fc', resident_id: '01011112222' },
    })).toMatchObject({ ok: false, status: 403 });
    expect(buildBrowserFcNotifyPayload({
      session: manager,
      body: { type: 'inbox_list', role: 'fc', resident_id: '01033334444' },
    })).toEqual({
      ok: true,
      payload: {
        type: 'inbox_list',
        role: 'fc',
        resident_id: '01033334444',
        limit: 80,
        viewer_actor_role: 'manager',
        viewer_actor_phone: '01033334444',
      },
    });
    expect(buildBrowserFcNotifyPayload({
      session: manager,
      body: {
        type: 'internal_unread_count',
        viewer_id: '01033334444',
        viewer_role: 'admin',
        viewer_staff_type: null,
        viewer_read_only: true,
        viewer_is_request_board_designer: false,
      },
    })).toEqual({
      ok: true,
      payload: {
        type: 'internal_unread_count',
        viewer_id: '01033334444',
        viewer_role: 'admin',
        viewer_staff_type: null,
        viewer_read_only: true,
        viewer_is_request_board_designer: false,
      },
    });
  });

  it('allows admin/developer-to-FC messages and rejects forged sender identity', () => {
    const developer = {
      role: 'admin' as const,
      residentDigits: '01055556666',
      displayName: 'Developer One',
      staffType: 'developer' as const,
    };
    const valid = buildBrowserFcNotifyPayload({
      session: developer,
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Hello',
        sender_id: '01055556666',
        sender_name: 'Developer One',
        category: 'forged-control-field',
      },
    });
    expect(valid).toEqual({
      ok: true,
      payload: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Hello',
        sender_id: '01055556666',
        sender_name: 'Developer One',
      },
    });
    expect(buildBrowserFcNotifyPayload({
      session: developer,
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Please check SERVICE_API_TOKEN=do-not-expose',
        sender_id: '01055556666',
        sender_name: 'Developer One',
      },
    })).toMatchObject({
      ok: true,
      payload: {
        message: 'Please check SERVICE_API_TOKEN=[redacted]',
      },
    });
    const longMessage = buildBrowserFcNotifyPayload({
      session: developer,
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'M'.repeat(4_001),
      },
    });
    expect(longMessage.ok).toBe(true);
    if (longMessage.ok && longMessage.payload.type === 'message') {
      expect(longMessage.payload.message).toHaveLength(4_000);
    }
    expect(buildBrowserFcNotifyPayload({
      session: developer,
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Hello',
        sender_id: 'admin',
        sender_name: 'Developer One',
      },
    })).toMatchObject({ ok: false, status: 403 });
    expect(buildBrowserFcNotifyPayload({
      session: { ...developer, role: 'manager', staffType: null },
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Hello',
      },
    })).toMatchObject({ ok: false, status: 403 });

    const regularAdmin = {
      role: 'admin' as const,
      residentDigits: '01011112222',
      displayName: 'Admin One',
      staffType: 'admin' as const,
    };
    expect(buildBrowserFcNotifyPayload({
      session: regularAdmin,
      body: {
        type: 'message',
        target_role: 'fc',
        target_id: '01077778888',
        message: 'Hello',
        sender_id: 'admin',
        sender_name: getWebStaffSenderName(regularAdmin),
      },
    })).toMatchObject({
      ok: true,
      payload: {
        sender_id: 'admin',
        sender_name: '총무팀',
      },
    });
  });

  it('rebuilds the web exam approval notification from a narrow admin-only action', () => {
    const admin = {
      role: 'admin' as const,
      residentDigits: '01011112222',
      displayName: 'Admin One',
      staffType: 'admin' as const,
    };
    expect(classifyFcNotifyIngress({ type: 'exam_approval_notify' }, null)).toEqual({
      ok: true,
      ingress: 'browser',
    });
    expect(buildBrowserFcNotifyPayload({
      session: admin,
      body: {
        type: 'exam_approval_notify',
        target_id: '01077778888',
        is_confirmed: true,
        exam_info: '2026-07-20 (3회차) [서울]',
        exam_type: 'life',
        target: {
          version: 1,
          kind: 'exam',
          examType: 'life',
          examRegistrationId: '00000000-0000-4000-8000-000000000371',
        },
        title: 'forged',
        category: 'forged',
        url: 'https://attacker.invalid',
      },
    })).toEqual({
      ok: true,
      payload: {
        type: 'notify',
        target_role: 'fc',
        target_id: '01077778888',
        title: '시험 신청이 승인되었습니다.',
        body: '2026-07-20 (3회차) [서울] 접수가 승인되었습니다. 시험 신청 화면에서 상태를 확인해주세요.',
        category: 'exam_apply',
        url: '/exam-apply',
        target: {
          version: 1,
          kind: 'exam',
          examType: 'life',
          examRegistrationId: '00000000-0000-4000-8000-000000000371',
        },
      },
    });
    expect(buildBrowserFcNotifyPayload({
      session: admin,
      body: {
        type: 'exam_approval_notify',
        target_id: '01077778888',
        is_confirmed: true,
        exam_info: '2026-07-20',
        exam_type: 'life',
        target: {
          version: 1,
          kind: 'exam',
          examType: 'nonlife',
          examRegistrationId: '00000000-0000-4000-8000-000000000371',
        },
      },
    })).toMatchObject({ ok: false, status: 400 });
    expect(buildBrowserFcNotifyPayload({
      session: { ...admin, role: 'manager', staffType: null },
      body: {
        type: 'exam_approval_notify',
        target_id: '01077778888',
        is_confirmed: false,
        exam_info: '2026-07-20',
        exam_type: 'nonlife',
      },
    })).toMatchObject({ ok: false, status: 403 });

    const examApplicants = readFileSync(examApplicantsPath, 'utf8');
    const examApplicantsApi = readFileSync(examApplicantsApiPath, 'utf8');
    expect(examApplicants).not.toContain('notifyFcExamApprovalStatus(');
    expect(examApplicantsApi).toContain(".rpc('transition_exam_registration'");
    expect(examApplicantsApi).toContain("functions.invoke('fc-notify'");
    expect(examApplicantsApi).toContain('skip_notification_insert: true');
    const patchHandler = examApplicantsApi
      .split('export async function PATCH')[1]
      ?.split('export async function DELETE')[0] ?? '';
    expect(patchHandler.indexOf(".rpc('transition_exam_registration'"))
      .toBeLessThan(patchHandler.indexOf('sendExamDecisionPush('));
  });

  it('preserves the authenticated FC-to-admin message path without trusting browser identity', () => {
    const fc = {
      role: 'fc' as const,
      residentDigits: '01077778888',
      displayName: 'FC One',
      staffType: null,
    };

    expect(getWebStaffSenderName({
      role: 'fc',
      residentId: fc.residentDigits,
      displayName: fc.displayName,
    })).toBe('FC One');
    expect(buildBrowserFcNotifyPayload({
      session: fc,
      body: {
        type: 'message',
        target_role: 'admin',
        target_id: null,
        message: 'Need help',
        sender_id: fc.residentDigits,
        sender_name: fc.displayName,
      },
    })).toEqual({
      ok: true,
      payload: {
        type: 'message',
        target_role: 'admin',
        target_id: null,
        message: 'Need help',
        sender_id: fc.residentDigits,
        sender_name: fc.displayName,
      },
    });
    expect(buildBrowserFcNotifyPayload({
      session: fc,
      body: {
        type: 'message',
        target_role: 'admin',
        target_id: null,
        message: 'Need help',
        sender_id: '01000000000',
        sender_name: fc.displayName,
      },
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('keeps direct-message inbox, Expo push, and admin web push on the same typed target', () => {
    const edge = readFileSync(fcNotifyEdgePath, 'utf8');

    expect(edge).toContain("body.title ?? '\\uba54\\uc2dc\\uc9c0'");
    expect(edge).toContain(
      "body.body ?? body.message ?? '\\uc0c8\\ub85c\\uc6b4 \\uba54\\uc2dc\\uc9c0\\uac00 \\ub3c4\\ucc29\\ud588\\uc2b5\\ub2c8\\ub2e4.'",
    );
    expect(edge).toContain("kind: 'garamin_direct_chat'");
    expect(edge).toContain('target: notificationTarget');
    expect(edge).toContain('notificationId');
    expect(edge).toMatch(
      /notifyAdminWebPush\(\s*pushTitle,\s*message,\s*url,\s*target_id \|\| null,\s*notificationId,\s*notificationTarget,\s*\)/,
    );
    expect(edge).toMatch(
      /const pushPayload = tokens\.map[\s\S]*?title: pushTitle,[\s\S]*?body: message,[\s\S]*?notificationId,[\s\S]*?target: notificationTarget,/,
    );
  });
});
