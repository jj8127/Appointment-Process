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
const OTHER_ADMIN_ID = '00000000-0000-4000-8000-000000000204';

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
const otherAdmin: DirectMessageActor = {
  actorId: OTHER_ADMIN_ID,
  sessionRole: 'admin',
  phone: '01099990000',
  staffType: 'admin',
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
const sharedAdminCounterparty = {
  role: 'admin' as const,
  actorId: null,
  phone: null,
};
const personalAdminCounterparty = {
  role: 'admin' as const,
  actorId: ADMIN_ID,
  phone: admin.phone,
};
const developerCounterparty = {
  role: 'developer' as const,
  actorId: DEVELOPER_ID,
  phone: developer.phone,
};
const managerCounterparty = {
  role: 'manager' as const,
  actorId: MANAGER_ID,
  phone: manager.phone,
};

Deno.test('conversation membership is bound to the selected staff target', () => {
  assert(canAccessDirectConversation(fc, {
    fcActorId: FC_ID,
    counterparty: developerCounterparty,
  }));
  assertFalse(canAccessDirectConversation(fc, {
    fcActorId: OTHER_FC_ID,
    counterparty: developerCounterparty,
  }));
  assert(canAccessDirectConversation(admin, {
    fcActorId: FC_ID,
    counterparty: sharedAdminCounterparty,
  }));
  assert(canAccessDirectConversation(admin, {
    fcActorId: FC_ID,
    counterparty: personalAdminCounterparty,
  }));
  assertFalse(canAccessDirectConversation(otherAdmin, {
    fcActorId: FC_ID,
    counterparty: personalAdminCounterparty,
  }));
  assertFalse(canAccessDirectConversation(admin, {
    fcActorId: FC_ID,
    counterparty: developerCounterparty,
  }));
  assert(canAccessDirectConversation(developer, {
    fcActorId: FC_ID,
    counterparty: developerCounterparty,
  }));
  assertFalse(canAccessDirectConversation(manager, {
    fcActorId: FC_ID,
    counterparty: developerCounterparty,
  }));
  assert(canAccessDirectConversation(manager, {
    fcActorId: FC_ID,
    counterparty: managerCounterparty,
  }));
});

Deno.test('new message identities are server-derived and actor-bound', () => {
  assertEquals(buildDirectMessageIdentity({
    actor: fc,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: personalAdminCounterparty,
  }), {
    senderId: fc.phone,
    receiverId: admin.phone,
    senderActorId: FC_ID,
    receiverActorId: ADMIN_ID,
  });
  assertEquals(buildDirectMessageIdentity({
    actor: admin,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: personalAdminCounterparty,
  }), {
    senderId: admin.phone,
    receiverId: fc.phone,
    senderActorId: ADMIN_ID,
    receiverActorId: FC_ID,
  });
  assertEquals(buildDirectMessageIdentity({
    actor: fc,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: developerCounterparty,
  }), {
    senderId: fc.phone,
    receiverId: developer.phone,
    senderActorId: FC_ID,
    receiverActorId: DEVELOPER_ID,
  });
  assertEquals(buildDirectMessageIdentity({
    actor: developer,
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: developerCounterparty,
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
    counterparty: managerCounterparty,
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
    counterparty: personalAdminCounterparty,
    row: {
      sender_id: admin.phone,
      receiver_id: fc.phone,
      sender_actor_id: ADMIN_ID,
      receiver_actor_id: FC_ID,
    },
  }));
  assertFalse(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: personalAdminCounterparty,
    row: {
      sender_id: otherAdmin.phone,
      receiver_id: fc.phone,
      sender_actor_id: OTHER_ADMIN_ID,
      receiver_actor_id: FC_ID,
    },
  }));
  assert(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: sharedAdminCounterparty,
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
    counterparty: sharedAdminCounterparty,
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
    counterparty: sharedAdminCounterparty,
    row: {
      sender_id: fc.phone,
      receiver_id: 'admin',
      sender_actor_id: OTHER_FC_ID,
      receiver_actor_id: null,
    },
  }));
  assert(isCurrentDirectMessageVisible({
    fcActorId: FC_ID,
    fcPhone: fc.phone,
    counterparty: sharedAdminCounterparty,
    row: {
      sender_id: developer.phone,
      receiver_id: fc.phone,
      sender_actor_id: DEVELOPER_ID,
      receiver_actor_id: FC_ID,
    },
  }));
});

Deno.test('legacy rows are exact-pair visible and ambiguous admin deletion fails closed', () => {
  const sharedAdminRow = {
    sender_id: 'admin',
    receiver_id: fc.phone,
    sender_actor_id: null,
  };
  assert(isLegacyDirectMessageVisible({
    actor: fc,
    fcPhone: fc.phone,
    counterpartyId: 'admin',
    row: sharedAdminRow,
  }));
  assert(isLegacyDirectMessageVisible({
    actor: admin,
    fcPhone: fc.phone,
    counterpartyId: 'admin',
    row: sharedAdminRow,
  }));
  assertFalse(canDeleteDirectMessage({
    actor: admin,
    fcPhone: fc.phone,
    counterpartyId: 'admin',
    row: sharedAdminRow,
  }));

  const developerLegacyRow = {
    sender_id: developer.phone,
    receiver_id: fc.phone,
    sender_actor_id: null,
  };
  assert(isLegacyDirectMessageVisible({
    actor: developer,
    fcPhone: fc.phone,
    counterpartyId: developer.phone,
    row: developerLegacyRow,
  }));
  assert(canDeleteDirectMessage({
    actor: developer,
    fcPhone: fc.phone,
    counterpartyId: developer.phone,
    row: developerLegacyRow,
  }));
  assertFalse(isLegacyDirectMessageVisible({
    actor: admin,
    fcPhone: fc.phone,
    counterpartyId: developer.phone,
    row: developerLegacyRow,
  }));
});

Deno.test('immutable sender actor prevents spoofed delete', () => {
  const row = {
    sender_id: 'admin',
    receiver_id: fc.phone,
    sender_actor_id: DEVELOPER_ID,
  };
  assert(canDeleteDirectMessage({
    actor: developer,
    fcPhone: fc.phone,
    counterpartyId: developer.phone,
    row,
  }));
  assertFalse(canDeleteDirectMessage({
    actor: admin,
    fcPhone: fc.phone,
    counterpartyId: developer.phone,
    row,
  }));
});
