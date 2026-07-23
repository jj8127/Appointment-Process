import {
  buildAppFcNotifyPayload,
  getAllowedNotificationTokenRoles,
  isTrustedFcNotifyServiceKey,
  shouldRequireActiveStaffNotificationTarget,
  type FcNotifyAppActor,
} from '../../supabase/functions/_shared/fc-notify-auth-policy';

const admin: FcNotifyAppActor = {
  sessionRole: 'admin',
  phone: '01011112222',
  displayName: '관리자',
  staffType: 'admin',
  fcId: null,
  isRequestBoardDesigner: false,
};

const developer: FcNotifyAppActor = {
  ...admin,
  phone: '01022223333',
  displayName: '개발자',
  staffType: 'developer',
};

const manager: FcNotifyAppActor = {
  ...admin,
  sessionRole: 'manager',
  phone: '01033334444',
  displayName: '본부장',
  staffType: null,
};

const fc: FcNotifyAppActor = {
  ...admin,
  sessionRole: 'fc',
  phone: '01044445555',
  displayName: 'FC 사용자',
  staffType: null,
  fcId: 'fc-own-id',
};

describe('direct Edge fc-notify authentication policy', () => {
  it('trusts only an exact non-empty service key', () => {
    expect(isTrustedFcNotifyServiceKey('service-secret', 'service-secret')).toBe(true);
    expect(isTrustedFcNotifyServiceKey('service-secreu', 'service-secret')).toBe(false);
    expect(isTrustedFcNotifyServiceKey('', '')).toBe(false);
    expect(isTrustedFcNotifyServiceKey(undefined, 'service-secret')).toBe(false);
  });

  it('derives the regular admin global inbox and rejects forged personal scope', () => {
    expect(buildAppFcNotifyPayload({ type: 'inbox_list', role: 'admin', resident_id: null }, admin)).toEqual({
      ok: true,
      payload: {
        type: 'inbox_list',
        role: 'admin',
        resident_id: null,
        limit: 80,
        include_request_board_fc: false,
        only_request_board_categories: false,
      },
    });

    expect(buildAppFcNotifyPayload({ type: 'inbox_list', role: 'admin', resident_id: fc.phone }, admin)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('derives developer and manager personal admin identities', () => {
    expect(buildAppFcNotifyPayload({ type: 'inbox_list', role: 'admin', resident_id: developer.phone }, developer)).toMatchObject({
      ok: true,
      payload: { role: 'admin', resident_id: developer.phone },
    });

    expect(buildAppFcNotifyPayload({
      type: 'internal_chat_list',
      viewer_id: manager.phone,
      viewer_role: 'admin',
      viewer_staff_type: null,
      viewer_read_only: true,
      viewer_is_request_board_designer: false,
    }, manager)).toEqual({
      ok: true,
      payload: {
        type: 'internal_chat_list',
        viewer_id: manager.phone,
        viewer_role: 'admin',
        viewer_staff_type: null,
        viewer_read_only: true,
        viewer_is_request_board_designer: false,
      },
    });

    expect(buildAppFcNotifyPayload({
      type: 'inbox_list',
      role: 'admin',
      resident_id: manager.phone,
      include_request_board_fc: true,
      only_request_board_categories: true,
    }, manager)).toMatchObject({
      ok: true,
      payload: {
        include_request_board_fc: true,
        only_request_board_categories: true,
      },
    });

    expect(buildAppFcNotifyPayload({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: manager.phone,
      include_request_board_fc: true,
      include_notices: false,
      only_request_board_categories: true,
    }, manager)).toEqual({
      ok: true,
      payload: {
        type: 'inbox_unread_count',
        role: 'admin',
        resident_id: manager.phone,
        since: null,
        include_request_board_fc: true,
        exclude_request_board_categories: false,
        include_notices: false,
        only_request_board_categories: true,
      },
    });
  });

  it('rejects viewer and inbox actor forgery', () => {
    expect(buildAppFcNotifyPayload({
      type: 'internal_unread_count',
      viewer_id: admin.phone,
      viewer_role: 'admin',
      viewer_read_only: false,
    }, fc)).toMatchObject({ ok: false, status: 403 });

    expect(buildAppFcNotifyPayload({ type: 'inbox_list', role: 'admin', resident_id: null }, fc)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('binds FC chat targets and inbox reads to the signed actor', () => {
    expect(buildAppFcNotifyPayload({ type: 'chat_targets', resident_id: fc.phone }, fc)).toEqual({
      ok: true,
      payload: { type: 'chat_targets', resident_id: fc.phone },
    });
    expect(buildAppFcNotifyPayload({ type: 'chat_targets', resident_id: admin.phone }, fc)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(buildAppFcNotifyPayload({ type: 'chat_targets', resident_id: manager.phone }, manager)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('allows admin-to-FC notify while deriving sender identity and stripping privileged controls', () => {
    const result = buildAppFcNotifyPayload({
      type: 'notify',
      target_role: 'fc',
      target_id: fc.phone,
      title: '시험 승인',
      body: '확인해주세요.',
      category: 'exam_apply',
      url: '/exam-apply',
      sender_id: 'forged',
      sender_name: 'forged',
      fc_id: 'forged',
      skip_notification_insert: false,
    }, admin);

    expect(result).toEqual({
      ok: true,
      payload: {
        type: 'notify',
        target_role: 'fc',
        target_id: fc.phone,
        title: '시험 승인',
        body: '확인해주세요.',
        category: 'exam_apply',
        url: '/exam-apply',
        sender_id: 'admin',
        sender_name: '관리자',
        skip_notification_insert: false,
      },
    });
  });

  it('allows FC-to-admin notify only with the FC actor identity', () => {
    expect(buildAppFcNotifyPayload({
      type: 'notify',
      target_role: 'admin',
      target_id: 'admin',
      title: '서류 제출',
      body: '확인해주세요.',
      category: 'app_event',
      url: '/dashboard',
    }, fc)).toEqual({
      ok: true,
      payload: {
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: '서류 제출',
        body: '확인해주세요.',
        category: 'app_event',
        url: '/dashboard',
        fc_id: 'fc-own-id',
        sender_id: fc.phone,
        sender_name: 'FC 사용자',
        skip_notification_insert: false,
      },
    });

    expect(buildAppFcNotifyPayload({
      type: 'notify', target_role: 'fc', target_id: fc.phone, title: 'x', body: 'y',
    }, fc)).toMatchObject({ ok: false, status: 403 });
  });

  it('routes FC workflow events to the shared admin inbox while preserving direct-message targeting', () => {
    expect(buildAppFcNotifyPayload({
      type: 'notify',
      target_role: 'admin',
      target_id: admin.phone,
      title: 'Workflow update',
      body: 'Please review',
      category: 'app_event',
    }, fc)).toMatchObject({
      ok: true,
      payload: { target_role: 'admin', target_id: null, category: 'app_event' },
    });

    expect(buildAppFcNotifyPayload({
      type: 'notify',
      target_role: 'admin',
      target_id: admin.phone,
      title: 'Direct message',
      body: 'Please review',
      category: 'message',
    }, fc)).toMatchObject({
      ok: true,
      payload: { target_role: 'admin', target_id: admin.phone, category: 'message' },
    });
  });

  it('binds concrete token roles to the authorized target role', () => {
    expect(getAllowedNotificationTokenRoles('admin')).toEqual(['admin', 'manager']);
    expect(getAllowedNotificationTokenRoles('fc')).toEqual(['fc']);
    expect(getAllowedNotificationTokenRoles('fc', 'request_board_message')).toEqual(['fc', 'manager']);
    expect(getAllowedNotificationTokenRoles('fc', 'REQUEST_BOARD_NEW_REQUEST')).toEqual(['fc', 'manager']);
    expect(getAllowedNotificationTokenRoles('fc', 'message')).toEqual(['fc']);
  });

  it('requires an active recipient check for concrete FC-to-staff and admin-to-FC direct messages', () => {
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'fc',
      targetRole: 'admin',
      category: 'message',
      targetId: manager.phone,
    })).toBe(true);
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'fc',
      targetRole: 'admin',
      category: 'app_event',
      targetId: manager.phone,
    })).toBe(false);
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'fc',
      targetRole: 'admin',
      category: 'message',
      targetId: null,
    })).toBe(false);
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'admin',
      targetRole: 'fc',
      category: 'message',
      targetId: fc.phone,
    })).toBe(true);
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'manager',
      targetRole: 'fc',
      category: 'message',
      targetId: fc.phone,
    })).toBe(false);
    expect(shouldRequireActiveStaffNotificationTarget({
      actorSessionRole: 'admin',
      targetRole: 'fc',
      category: 'app_event',
      targetId: fc.phone,
    })).toBe(false);
  });

  it('denies read-only managers and request-board designers from notification writes', () => {
    const payload = { type: 'notify', target_role: 'fc', target_id: fc.phone, title: 'x', body: 'y' };
    expect(buildAppFcNotifyPayload(payload, manager)).toMatchObject({ ok: false, status: 403 });
    expect(buildAppFcNotifyPayload(payload, { ...fc, isRequestBoardDesigner: true })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('binds fc_update to the signed FC profile and keeps destructive events internal-only', () => {
    expect(buildAppFcNotifyPayload({ type: 'fc_update', fc_id: fc.fcId, message: '완료' }, fc)).toEqual({
      ok: true,
      payload: { type: 'fc_update', fc_id: 'fc-own-id', message: '완료' },
    });
    expect(buildAppFcNotifyPayload({ type: 'fc_update', fc_id: 'other-fc' }, fc)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(buildAppFcNotifyPayload({ type: 'fc_delete', fc_id: fc.fcId }, admin)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(buildAppFcNotifyPayload({ type: 'admin_update', fc_id: fc.fcId }, admin)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('keeps message internal-only and blocks external notification URLs', () => {
    expect(buildAppFcNotifyPayload({ type: 'message' }, admin)).toMatchObject({ ok: false, status: 403 });
    expect(buildAppFcNotifyPayload({
      type: 'notify',
      target_role: 'fc',
      target_id: fc.phone,
      title: 'x',
      body: 'y',
      url: 'https://attacker.invalid/path',
    }, admin)).toMatchObject({ ok: false, status: 400 });
  });

  it('prevents manager notice deletion and preserves only actor-scoped notification ids', () => {
    expect(buildAppFcNotifyPayload({
      type: 'inbox_delete',
      role: 'admin',
      resident_id: manager.phone,
      notification_ids: ['own-notification'],
      notice_ids: ['global-notice'],
    }, manager)).toMatchObject({ ok: false, status: 403 });

    expect(buildAppFcNotifyPayload({
      type: 'inbox_delete',
      role: 'fc',
      resident_id: fc.phone,
      notification_ids: ['own-notification'],
      notice_ids: [],
    }, fc)).toEqual({
      ok: true,
      payload: {
        type: 'inbox_delete',
        role: 'fc',
        resident_id: fc.phone,
        notification_ids: ['own-notification'],
        notice_ids: [],
        include_request_board_fc: false,
      },
    });
  });
});
