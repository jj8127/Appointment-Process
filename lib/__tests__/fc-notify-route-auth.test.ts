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
const serverSessionPath = join(root, 'web', 'src', 'lib', 'server-session.ts');
const examApplicantsPath = join(root, 'web', 'src', 'app', 'dashboard', 'exam', 'applicants', 'page.tsx');
const examApplicantNotificationClientPath = join(root, 'web', 'src', 'lib', 'exam-applicant-notification-client.ts');

describe('FC notify proxy ingress authentication', () => {
  it('requires the public route to authenticate browser and Request Board ingress before proxying', () => {
    const route = readFileSync(routePath, 'utf8');

    expect(route).toContain('getVerifiedServerSession');
    expect(route).toContain('verifyRequestBoardBridgeToken');
    expect(route).toContain('buildBrowserFcNotifyPayload');
    expect(route).toContain('buildRequestBoardNotifyPayload');
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
      route.indexOf('isEligibleFcTarget(browserPolicy.payload.target_id)'),
    );
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
        skip_notification_insert: true,
        sender_id: 'forged',
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
        url: '/notifications?source=request-board',
      },
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
      body: { type: 'inbox_list', role: 'admin', resident_id: null, limit: 999 },
    })).toEqual({
      ok: true,
      payload: { type: 'inbox_list', role: 'admin', resident_id: null, limit: 200 },
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
      payload: { type: 'inbox_list', role: 'fc', resident_id: '01033334444', limit: 80 },
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
      },
    });
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
    const examNotificationClient = readFileSync(examApplicantNotificationClientPath, 'utf8');
    expect(examApplicants).toContain("from '@/lib/exam-applicant-notification-client'");
    expect(examApplicants).toContain('notifyFcExamApprovalStatus(');
    expect(examNotificationClient).toContain("fetch('/api/fc-notify'");
    expect(examNotificationClient).toContain("type: 'exam_approval_notify'");
    expect(examApplicants).not.toContain("functions.invoke('fc-notify'");
    expect(examNotificationClient).not.toContain("functions.invoke('fc-notify'");
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

  it('keeps the existing new-message web-push copy', () => {
    const route = readFileSync(routePath, 'utf8');
    expect(route).toContain("title: '새 메시지'");
  });
});
