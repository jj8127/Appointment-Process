import {
  buildAppFcNotifyPayload,
  type FcNotifyAppActor,
} from '../../supabase/functions/_shared/fc-notify-auth-policy';

const actorId = '123e4567-e89b-42d3-a456-426614174000';
const conversationId = '223e4567-e89b-42d3-a456-426614174000';
const messageId = '323e4567-e89b-42d3-a456-426614174000';
const fc: FcNotifyAppActor = {
  actorId,
  sessionRole: 'fc',
  phone: '01011112222',
  displayName: 'FC',
  staffType: null,
  fcId: conversationId,
  isRequestBoardDesigner: false,
};

describe('Messenger V2 signed direct search policy', () => {
  test('allows a syntactically exact FC staff target for server-side eligibility resolution', () => {
    expect(buildAppFcNotifyPayload({
      type: 'resolve_garamin_direct_conversation',
      target_id: '010-2222-3333',
      role: 'admin',
      viewer_actor_id: 'forged',
    }, fc)).toEqual({
      ok: true,
      payload: {
        type: 'resolve_garamin_direct_conversation',
        conversation_id: null,
        target_id: '01022223333',
        viewer_actor_id: actorId,
        viewer_actor_role: 'fc',
      },
    });
  });

  test.each(['arbitrary', '0101234', 'admin@example.com'])(
    'rejects malformed or arbitrary FC target identity: %s',
    (targetId) => {
      expect(buildAppFcNotifyPayload({
        type: 'resolve_garamin_direct_conversation',
        target_id: targetId,
      }, fc)).toMatchObject({ ok: false, status: 400 });
    },
  );

  test('derives search authority solely from the signed actor', () => {
    expect(buildAppFcNotifyPayload({
      type: 'direct_message_search',
      q: '  계약 %_  ',
      limit: 25,
      role: 'admin',
      phone: '01099998888',
      viewer_actor_id: 'forged',
    }, fc)).toEqual({
      ok: true,
      payload: {
        type: 'direct_message_search',
        q: '계약 %_',
        limit: 25,
        viewer_actor_id: actorId,
        viewer_actor_role: 'fc',
      },
    });
  });

  test.each([
    { type: 'direct_message_search', q: '한', limit: 1 },
    { type: 'direct_message_search', q: '검색', limit: 0 },
    { type: 'direct_message_search', q: '검색', limit: 51 },
    { type: 'direct_message_context', conversation_id: 'legacy', message_id: messageId },
    { type: 'direct_message_context', conversation_id: conversationId, message_id: 'foreign' },
  ])('rejects malformed search/context input: %o', (body) => {
    expect(buildAppFcNotifyPayload(body, fc)).toMatchObject({ ok: false, status: 400 });
  });

  test('binds context to the signed actor and canonical identifiers', () => {
    expect(buildAppFcNotifyPayload({
      type: 'direct_message_context',
      conversation_id: conversationId,
      message_id: messageId,
      viewer_actor_id: 'forged',
      viewer_actor_role: 'admin',
    }, fc)).toEqual({
      ok: true,
      payload: {
        type: 'direct_message_context',
        conversation_id: conversationId,
        message_id: messageId,
        viewer_actor_id: actorId,
        viewer_actor_role: 'fc',
      },
    });
  });
});
