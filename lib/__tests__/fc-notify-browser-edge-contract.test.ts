import {
  buildAppFcNotifyPayload,
  type FcNotifyAppActor,
} from '../../supabase/functions/_shared/fc-notify-auth-policy';
import {
  buildBrowserFcNotifyPayload,
  type FcNotifyBrowserSession,
} from '../../web/src/lib/fc-notify-proxy-policy';

const admin: FcNotifyBrowserSession = {
  role: 'admin',
  residentDigits: '01000000001',
  displayName: 'Synthetic administrator',
  staffType: 'admin',
};
const sessions: Record<string, FcNotifyBrowserSession> = {
  admin,
  developer: { ...admin, residentDigits: '01000000002', staffType: 'developer' },
  manager: { ...admin, role: 'manager', residentDigits: '01000000003', staffType: null },
  fc: { ...admin, role: 'fc', residentDigits: '01000000004', staffType: null },
};
const conversationId = '00000000-0000-4000-8000-000000000001';
const targetId = '01000000009';

function forwardToEdge(body: Record<string, unknown>, session: FcNotifyBrowserSession) {
  const browser = buildBrowserFcNotifyPayload({ body, session });
  expect(browser.ok).toBe(true);
  if (!browser.ok) throw new Error(browser.error);

  const actor: FcNotifyAppActor = {
    actorId: '00000000-0000-4000-8000-000000000002',
    sessionRole: session.role,
    phone: session.residentDigits,
    displayName: session.displayName,
    staffType: session.staffType,
    fcId: session.role === 'fc' ? '00000000-0000-4000-8000-000000000003' : null,
    isRequestBoardDesigner: false,
  };
  // Exercise the serialized proxy request against the real Edge policy.
  const payload = JSON.parse(JSON.stringify(browser.payload));
  const edge = buildAppFcNotifyPayload(payload, actor);
  expect(edge.ok).toBe(true);
  if (!edge.ok) throw new Error(edge.error);
  return { payload, edge: edge.payload, actor };
}

describe('FC notify browser-to-Edge contract', () => {
  describe.each(['admin', 'developer', 'fc'])('%s direct conversation resolution', (name) => {
    const session = sessions[name];

    it.each([
      ['target_id', targetId, 'conversation_id'],
      ['conversation_id', conversationId, 'target_id'],
    ])('forwards only the chosen %s selector', (key, value, unusedKey) => {
      const { payload, edge, actor } = forwardToEdge({
        type: 'resolve_garamin_direct_conversation',
        [key]: value,
      }, session);

      expect(payload[key]).toBe(value);
      expect(Object.hasOwn(payload, unusedKey)).toBe(false);
      expect(edge).toMatchObject({
        type: 'resolve_garamin_direct_conversation',
        [key]: value,
        viewer_actor_id: actor.actorId,
        viewer_actor_role: session.staffType === 'developer' ? 'developer' : session.role,
      });
    });
  });

  it.each(Object.entries(sessions))('%s unread counts use the verified personal identity', (_name, session) => {
    const { payload, edge } = forwardToEdge({ type: 'internal_unread_count' }, session);

    expect(payload.viewer_id).toBe(session.residentDigits);
    expect(edge).toEqual({
      type: 'internal_unread_count',
      viewer_id: session.residentDigits,
      viewer_role: session.role === 'fc' ? 'fc' : 'admin',
      viewer_staff_type: session.role === 'admin' ? session.staffType : null,
      viewer_read_only: session.role === 'manager',
      viewer_is_request_board_designer: false,
    });
  });

  it.each(['admin', admin.residentDigits])('normalizes the existing admin unread claim %s before Edge validation', (viewerId) => {
    const { payload, edge } = forwardToEdge({
      type: 'internal_unread_count',
      viewer_id: viewerId,
      viewer_role: 'admin',
      viewer_staff_type: 'admin',
      viewer_read_only: false,
      viewer_is_request_board_designer: false,
    }, admin);

    expect(payload.viewer_id).toBe(admin.residentDigits);
    expect(edge.viewer_id).toBe(admin.residentDigits);
  });

  it.each(Object.entries(sessions))('%s cannot claim another unread identity', (_name, session) => {
    expect(buildBrowserFcNotifyPayload({
      body: { type: 'internal_unread_count', viewer_id: targetId },
      session,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it.each(['developer', 'manager', 'fc'])('%s cannot claim the legacy admin unread identity', (name) => {
    expect(buildBrowserFcNotifyPayload({
      body: { type: 'internal_unread_count', viewer_id: 'admin' },
      session: sessions[name],
    })).toMatchObject({ ok: false, status: 403 });
  });

  it.each([
    {},
    { target_id: targetId, conversation_id: conversationId },
  ])('rejects missing or conflicting resolver selectors', (selectors) => {
    expect(buildBrowserFcNotifyPayload({
      body: { type: 'resolve_garamin_direct_conversation', ...selectors },
      session: admin,
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('keeps manager direct conversation access read-only', () => {
    expect(buildBrowserFcNotifyPayload({
      body: { type: 'resolve_garamin_direct_conversation', target_id: targetId },
      session: sessions.manager,
    })).toMatchObject({ ok: false, status: 403 });
  });
});
