export type DirectMessageActor = {
  actorId: string;
  sessionRole: 'admin' | 'manager' | 'fc';
  phone: string;
  staffType: 'admin' | 'developer' | null;
  fcId: string | null;
  isRequestBoardDesigner: boolean;
};

export type DirectMessageIdentity = {
  senderId: string;
  receiverId: string;
  senderActorId: string;
  receiverActorId: string | null;
};

export type DirectConversationCounterparty = {
  role: 'admin' | 'manager' | 'developer';
  actorId: string | null;
  phone: string | null;
};

export type DirectMessageRowIdentity = {
  sender_id?: string | null;
  receiver_id?: string | null;
  sender_actor_id?: string | null;
  receiver_actor_id?: string | null;
};

const ADMIN_CHAT_ID = 'admin';

const digits = (value: unknown) =>
  typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';

export function isDirectMessageActorEligible(actor: DirectMessageActor): boolean {
  return (
    !actor.isRequestBoardDesigner
    && (
      (actor.sessionRole === 'fc' && Boolean(actor.fcId))
      || actor.sessionRole === 'manager'
      || (
        actor.sessionRole === 'admin'
        && (actor.staffType === 'admin' || actor.staffType === 'developer')
      )
    )
  );
}

export function canAccessDirectConversation(
  actor: DirectMessageActor,
  input: {
    fcActorId: string;
    counterparty: DirectConversationCounterparty;
  },
): boolean {
  if (!isDirectMessageActorEligible(actor)) return false;
  if (actor.sessionRole === 'fc') {
    return actor.fcId === input.fcActorId;
  }
  if (input.counterparty.role === 'admin') {
    return (
      actor.sessionRole === 'admin'
      && actor.staffType === 'admin'
      && input.counterparty.actorId === null
    );
  }
  if (input.counterparty.role === 'developer') {
    return (
      actor.sessionRole === 'admin'
      && actor.staffType === 'developer'
      && input.counterparty.actorId === actor.actorId
    );
  }
  return (
    actor.sessionRole === 'manager'
    && input.counterparty.actorId === actor.actorId
  );
}

export function getLegacyDirectMessageActorId(actor: DirectMessageActor): string | null {
  if (!isDirectMessageActorEligible(actor)) return null;
  if (actor.sessionRole === 'fc') {
    const phone = digits(actor.phone);
    return phone.length === 11 ? phone : null;
  }
  if (actor.sessionRole === 'manager') {
    return digits(actor.phone) || null;
  }
  return actor.staffType === 'developer'
    ? digits(actor.phone) || null
    : ADMIN_CHAT_ID;
}

export function buildDirectMessageIdentity(input: {
  actor: DirectMessageActor;
  fcActorId: string;
  fcPhone: string;
  counterparty: DirectConversationCounterparty;
}): DirectMessageIdentity | null {
  if (!canAccessDirectConversation(input.actor, {
    fcActorId: input.fcActorId,
    counterparty: input.counterparty,
  })) return null;
  const fcPhone = digits(input.fcPhone);
  if (fcPhone.length !== 11) return null;

  if (input.actor.sessionRole === 'fc') {
    const receiverId = input.counterparty.role === 'admin'
      ? ADMIN_CHAT_ID
      : digits(input.counterparty.phone);
    if (
      !receiverId
      || (
        input.counterparty.role !== 'admin'
        && !input.counterparty.actorId
      )
    ) return null;
    return {
      senderId: fcPhone,
      receiverId,
      senderActorId: input.actor.actorId,
      receiverActorId: input.counterparty.actorId,
    };
  }

  const personalStaffSenderId =
    input.actor.sessionRole === 'manager' || input.actor.staffType === 'developer'
      ? digits(input.actor.phone)
      : ADMIN_CHAT_ID;
  if (!personalStaffSenderId) return null;
  return {
    senderId: personalStaffSenderId,
    receiverId: fcPhone,
    senderActorId: input.actor.actorId,
    receiverActorId: input.fcActorId,
  };
}

export function isLegacyDirectMessageVisible(input: {
  actor: DirectMessageActor;
  fcPhone: string;
  counterpartyId: string;
  row: DirectMessageRowIdentity;
}): boolean {
  const actorId = getLegacyDirectMessageActorId(input.actor);
  const fcPhone = digits(input.fcPhone);
  const counterpartyId = input.counterpartyId === ADMIN_CHAT_ID
    ? ADMIN_CHAT_ID
    : digits(input.counterpartyId);
  const senderId = String(input.row.sender_id ?? '').trim();
  const receiverId = String(input.row.receiver_id ?? '').trim();
  if (!actorId || !counterpartyId || fcPhone.length !== 11) return false;

  const counterpartId =
    input.actor.sessionRole === 'fc' ? counterpartyId : fcPhone;
  return (
    (senderId === actorId && receiverId === counterpartId)
    || (senderId === counterpartId && receiverId === actorId)
  );
}

export function isCurrentDirectMessageVisible(input: {
  fcActorId: string;
  fcPhone: string;
  counterparty: DirectConversationCounterparty;
  row: DirectMessageRowIdentity;
}): boolean {
  const fcPhone = digits(input.fcPhone);
  const counterpartyId = input.counterparty.role === 'admin'
    ? ADMIN_CHAT_ID
    : digits(input.counterparty.phone);
  const senderId = String(input.row.sender_id ?? '').trim();
  const receiverId = String(input.row.receiver_id ?? '').trim();
  const senderActorId = String(input.row.sender_actor_id ?? '').trim();
  const receiverActorId = String(input.row.receiver_actor_id ?? '').trim();
  if (
    fcPhone.length !== 11
    || !input.fcActorId
    || !counterpartyId
    || !senderActorId
  ) return false;

  if (senderId === fcPhone && receiverId === counterpartyId) {
    return (
      senderActorId === input.fcActorId
      && receiverActorId === (input.counterparty.actorId ?? '')
    );
  }
  if (receiverId === fcPhone) {
    const isCounterpartySender =
      input.counterparty.role === 'admin'
        ? senderId === ADMIN_CHAT_ID || digits(senderId).length === 11
        : senderId === counterpartyId;
    return (
      receiverActorId === input.fcActorId
      && isCounterpartySender
      && (
        input.counterparty.role === 'admin'
          ? Boolean(senderActorId)
          : senderActorId === input.counterparty.actorId
      )
    );
  }
  return false;
}

export function canDeleteDirectMessage(input: {
  actor: DirectMessageActor;
  fcPhone: string;
  counterpartyId: string;
  row: DirectMessageRowIdentity;
}): boolean {
  const senderActorId = String(input.row.sender_actor_id ?? '').trim();
  if (senderActorId) return senderActorId === input.actor.actorId;
  if (!isLegacyDirectMessageVisible(input)) return false;

  // The shared legacy "admin" sentinel cannot identify which administrator
  // authored the row. It is readable as a shared conversation but not
  // deletable by any one staff actor.
  if (input.actor.sessionRole === 'admin' && input.actor.staffType === 'admin') {
    return false;
  }
  return String(input.row.sender_id ?? '').trim() === getLegacyDirectMessageActorId(input.actor);
}
