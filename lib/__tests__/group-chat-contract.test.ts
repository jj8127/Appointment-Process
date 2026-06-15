import {
  buildGroupChatActor,
  buildGroupChatAppointmentLabel,
  canGroupChatActorSendMessages,
  computeGroupChatMessageUnreadCounts,
  buildGroupChatPreview,
  computeGroupChatUnreadCount,
  isEligibleGroupChatMember,
  normalizeGroupChatMessageContent,
  shouldFanoutGroupChatPush,
  summarizeGroupChatReactions,
} from '../group-chat-contract';

describe('group chat member eligibility', () => {
  test('includes completed FCs, active managers, active admins, and active developers', () => {
    expect(
      isEligibleGroupChatMember({
        kind: 'fc',
        phone: '010-1111-2222',
        signup_completed: true,
        affiliation: '1본부 서선미',
      }),
    ).toBe(true);

    expect(
      isEligibleGroupChatMember({
        kind: 'manager',
        phone: '010-3333-4444',
        active: true,
      }),
    ).toBe(true);

    expect(
      isEligibleGroupChatMember({
        kind: 'admin',
        phone: '010-5555-6666',
        active: true,
        staff_type: 'admin',
      }),
    ).toBe(true);

    expect(
      isEligibleGroupChatMember({
        kind: 'admin',
        phone: '010-1212-3434',
        active: true,
        staff_type: 'developer',
      }),
    ).toBe(true);
  });

  test('excludes incomplete FCs, inactive staff, and request-board designers', () => {
    expect(
      isEligibleGroupChatMember({
        kind: 'fc',
        phone: '010-1111-2222',
        signup_completed: false,
        affiliation: '1본부 서선미',
      }),
    ).toBe(false);

    expect(
      isEligibleGroupChatMember({
        kind: 'manager',
        phone: '010-3333-4444',
        active: false,
      }),
    ).toBe(false);

    expect(
      isEligibleGroupChatMember({
        kind: 'admin',
        phone: '010-5555-6666',
        active: false,
        staff_type: 'admin',
      }),
    ).toBe(false);

    expect(
      isEligibleGroupChatMember({
        kind: 'fc',
        phone: '010-7777-8888',
        signup_completed: true,
        affiliation: '한화생명 설계매니저',
      }),
    ).toBe(false);

    expect(
      isEligibleGroupChatMember({
        kind: 'fc',
        phone: '010-9999-0000',
        signup_completed: true,
        affiliation: '1본부 서선미',
        is_manager_referral_shadow: true,
      }),
    ).toBe(false);
  });
});

describe('group chat appointment labels', () => {
  test('uses commission completion fields instead of signup completion for FC status', () => {
    expect(
      buildGroupChatAppointmentLabel({
        kind: 'fc',
        phone: '010-1111-2222',
        signup_completed: true,
        affiliation: '1본부 서선미',
        life_commission_completed: false,
        nonlife_commission_completed: false,
      }),
    ).toBe('위촉 대기');

    expect(
      buildGroupChatAppointmentLabel({
        kind: 'fc',
        phone: '010-1111-2222',
        signup_completed: true,
        affiliation: '1본부 서선미',
        life_commission_completed: true,
        nonlife_commission_completed: false,
      }),
    ).toBe('생명 완료');

    expect(
      buildGroupChatAppointmentLabel({
        kind: 'fc',
        phone: '010-1111-2222',
        signup_completed: true,
        affiliation: '1본부 서선미',
        appointment_date_life: '2026-06-01',
        appointment_date_nonlife: '2026-06-02',
      }),
    ).toBe('위촉 완료');
  });
});

describe('group chat actor and unread contract', () => {
  test('builds stable actor ids from app-session roles', () => {
    expect(buildGroupChatActor({ role: 'fc', phone: '010-1111-2222', name: '김가람' })).toEqual({
      id: 'fc:01011112222',
      role: 'fc',
      phone: '01011112222',
      name: '김가람',
    });

    expect(buildGroupChatActor({ role: 'manager', phone: '010-3333-4444', name: '서선미' })).toEqual({
      id: 'manager:01033334444',
      role: 'manager',
      phone: '01033334444',
      name: '서선미',
    });

    expect(buildGroupChatActor({ role: 'admin', phone: '010-5555-6666', name: '송효원' })).toEqual({
      id: 'admin:01055556666',
      role: 'admin',
      phone: '01055556666',
      name: '송효원',
    });
  });

  test('defaults FC sending to denied while staff can always send', () => {
    const fcActor = buildGroupChatActor({ role: 'fc', phone: '010-1111-2222', name: 'FC' });
    const managerActor = buildGroupChatActor({ role: 'manager', phone: '010-3333-4444', name: 'Manager' });
    const adminActor = buildGroupChatActor({ role: 'admin', phone: '010-5555-6666', name: 'Admin' });

    expect(canGroupChatActorSendMessages({ actor: fcActor, permissions: [] })).toBe(false);
    expect(canGroupChatActorSendMessages({
      actor: fcActor,
      permissions: [{ actor_id: fcActor?.id, can_send_messages: false }],
    })).toBe(false);
    expect(canGroupChatActorSendMessages({
      actor: fcActor,
      permissions: [{ actor_id: fcActor?.id, can_send_messages: true }],
    })).toBe(true);
    expect(canGroupChatActorSendMessages({ actor: managerActor, permissions: [] })).toBe(true);
    expect(canGroupChatActorSendMessages({ actor: adminActor, permissions: [] })).toBe(true);
    expect(canGroupChatActorSendMessages({ actor: null, permissions: [] })).toBe(false);
  });

  test('counts unread messages after last read while excluding my own messages', () => {
    const unread = computeGroupChatUnreadCount({
      viewerActorId: 'fc:01011112222',
      lastReadAt: '2026-06-10T09:05:00.000Z',
      messages: [
        {
          sender_actor_id: 'manager:01033334444',
          created_at: '2026-06-10T09:00:00.000Z',
        },
        {
          sender_actor_id: 'manager:01033334444',
          created_at: '2026-06-10T09:06:00.000Z',
        },
        {
          sender_actor_id: 'fc:01011112222',
          created_at: '2026-06-10T09:07:00.000Z',
        },
        {
          sender_actor_id: 'admin:01055556666',
          created_at: '2026-06-10T09:08:00.000Z',
        },
      ],
    });

    expect(unread).toBe(2);
  });

  test('computes per-message unread recipient counts for KakaoTalk-style sent message badges', () => {
    const counts = computeGroupChatMessageUnreadCounts({
      members: [
        { actor_id: 'fc:01011112222' },
        { actor_id: 'manager:01033334444' },
        { actor_id: 'admin:01055556666' },
      ],
      readStates: [
        { actor_id: 'fc:01011112222', last_read_at: '2026-06-10T09:10:00.000Z' },
        { actor_id: 'manager:01033334444', last_read_at: '2026-06-10T09:05:00.000Z' },
      ],
      messages: [
        {
          id: 'message-old',
          sender_actor_id: 'fc:01011112222',
          created_at: '2026-06-10T09:00:00.000Z',
        },
        {
          id: 'message-new',
          sender_actor_id: 'fc:01011112222',
          created_at: '2026-06-10T09:06:00.000Z',
        },
      ],
    });

    expect(counts.get('message-old')).toBe(1);
    expect(counts.get('message-new')).toBe(2);
  });

  test('keeps unread for muted users but excludes them from push fanout', () => {
    expect(
      shouldFanoutGroupChatPush({
        senderActorId: 'fc:01011112222',
        recipientActorId: 'manager:01033334444',
        recipientMuted: true,
      }),
    ).toBe(false);

    expect(
      shouldFanoutGroupChatPush({
        senderActorId: 'fc:01011112222',
        recipientActorId: 'fc:01011112222',
        recipientMuted: false,
      }),
    ).toBe(false);

    expect(
      shouldFanoutGroupChatPush({
        senderActorId: 'fc:01011112222',
        recipientActorId: 'admin:01055556666',
        recipientMuted: false,
      }),
    ).toBe(true);
  });

  test('uses file and image labels for hub preview', () => {
    expect(buildGroupChatPreview({ message_type: 'text', content: '회의 일정 확인해주세요' })).toBe('회의 일정 확인해주세요');
    expect(buildGroupChatPreview({ message_type: 'image', content: '사진을 보냈습니다.' })).toBe('사진');
    expect(buildGroupChatPreview({ message_type: 'file', file_name: '가람PA.pdf', content: '가람PA.pdf' })).toBe('가람PA.pdf');
  });

  test('preserves line breaks in stored group chat message content', () => {
    expect(normalizeGroupChatMessageContent('  첫 줄\r\n둘째 줄\n\n셋째 줄  ')).toBe('첫 줄\n둘째 줄\n\n셋째 줄');
    expect(normalizeGroupChatMessageContent('   \n\t  ')).toBe('');
  });

  test('summarizes reactions with my reaction marker and stable ordering', () => {
    expect(
      summarizeGroupChatReactions({
        viewerActorId: 'fc:01011112222',
        reactions: [
          { reaction: '❤️', actor_id: 'manager:01033334444' },
          { reaction: '👍', actor_id: 'fc:01011112222' },
          { reaction: '👍', actor_id: 'admin:01055556666' },
        ],
      }),
    ).toEqual([
      { reaction: '👍', count: 2, reacted_by_me: true },
      { reaction: '❤️', count: 1, reacted_by_me: false },
    ]);
  });
});
