import {
  assert,
  assertEquals,
  assertFalse,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  buildDirectMessageIdentity,
  canAccessDirectConversation,
  canDeleteDirectMessage,
  isCurrentDirectMessageVisible,
  isLegacyDirectMessageVisible,
  type DirectMessageActor,
} from '../direct-message-policy.ts';

const FC_ID = '00000000-0000-4000-8000-000000000101';
const OTHER_FC_ID = '00000000-0000-4000-8000-000000000102';
const ADMIN_ID = '00000000-0000-4000-8000-000000000201';
const DEVELOPER_ID = '00000000-0000-4000-8000-000000000202';
const MANAGER_ID = '00000000-0000-4000-8000-000000000203';

const fc: DirectMessageActor = {
  actorId: FC_ID,
  sessionRole: 'fc',
  phone: '01011112222',
  staffType: null,
  fcId: FC_ID,
  isRequestBoardDesigner: false,
};
const admin: DirectMessageActor = {
  actorId: ADMIN_ID,
  sessionRole: 'admin',
  phone: '01033334444',
  staffType: 'admin',
  fcId: null,
  isRequestBoardDesigner: false,
};
const developer: DirectMessageActor = {
  actorId: DEVELOPER_ID,
  sessionRole: 'admin',
  phone: '01055556666',
  staffType: 'developer',
  fcId: null,
  isRequestBoardDesigner: false,
};
const manager: DirectMessageActor = {
  actorId: MANAGER_ID,
  sessionRole: 'manager',
  phone: '01077778888',
  staffType: null,
  fcId: null,
  isRequestBoardDesigner: false,
};

Deno.test('conversation membership rejects foreign FC and accepts canonical staff', () => {
  assert(canAccessDirectConversation(fc, FC_ID));
  assertFalse(canAccessDirectConversation(fc, OTHER_FC_ID));
  assert(canAccessDirectConversation(admin, FC_ID));
  assert(canAccessDirectConversation(manager, FC_ID));
});

Deno.test('new message identities are server-derived and actor-bound', () => {
  assertEquals(buildDirectMessageIdentity({
    actor: fc,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
  }), {
    senderId: fc.phone,
    receiverId: 'admin',
    senderActorId: FC_ID,
    receiverActorId: null,
  });
  assertEquals(buildDirectMessageIdentity({
    actor: developer,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
  }), {
    senderId: developer.phone,
    receiverId: fc.phone,
    senderActorId: DEVELOPER_ID,
    receiverActorId: FC_ID,
  });
  assertEquals(buildDirectMessageIdentity({
    actor: manager,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
  }), {
    senderId: manager.phone,
    receiverId: fc.phone,
    senderActorId: MANAGER_ID,
    receiverActorId: FC_ID,
  });
});

Deno.test('current rows require the stable sender/receiver pair and immutable FC binding', () => {
  assert(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    row: {
      sender_id: 'admin',
      receiver_id: fc.phone,
      sender_actor_id: ADMIN_ID,
      receiver_actor_id: FC_ID,
    },
  }));
  assertFalse(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    row: {
      sender_id: 'admin',
      receiver_id: '01099999999',
      sender_actor_id: ADMIN_ID,
      receiver_actor_id: FC_ID,
    },
  }));
  assertFalse(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    row: {
      sender_id: fc.phone,
      receiver_id: 'admin',
      sender_actor_id: OTHER_FC_ID,
      receiver_actor_id: null,
    },
  }));
});

Deno.test('legacy rows are exact-pair visible and ambiguous admin deletion fails closed', () => {
  const sharedAdminRow = {
    sender_id: 'admin',
    receiver_id: fc.phone,
    sender_actor_id: null,
  };
  assert(isLegacyDirectMessageVisible({ actor: fc, fcPhone: fc.phone, row: sharedAdminRow }));
  assert(isLegacyDirectMessageVisible({ actor: admin, fcPhone: fc.phone, row: sharedAdminRow }));
  assertFalse(canDeleteDirectMessage({ actor: admin, fcPhone: fc.phone, row: sharedAdminRow }));

  const developerLegacyRow = {
    sender_id: developer.phone,
    receiver_id: fc.phone,
    sender_actor_id: null,
  };
  assert(isLegacyDirectMessageVisible({
    actor: developer,
    fcPhone: fc.phone,
    row: developerLegacyRow,
  }));
  assert(canDeleteDirectMessage({
    actor: developer,
    fcPhone: fc.phone,
    row: developerLegacyRow,
  }));
  assertFalse(isLegacyDirectMessageVisible({
    actor: admin,
    fcPhone: fc.phone,
    row: developerLegacyRow,
  }));
});

Deno.test('immutable sender actor prevents spoofed delete', () => {
  const row = {
    sender_id: 'admin',
    receiver_id: fc.phone,
    sender_actor_id: DEVELOPER_ID,
  };
  assert(canDeleteDirectMessage({ actor: developer, fcPhone: fc.phone, row }));
  assertFalse(canDeleteDirectMessage({ actor: admin, fcPhone: fc.phone, row }));
});
