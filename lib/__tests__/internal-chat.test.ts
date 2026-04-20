import { ADMIN_CHAT_ID } from '../messenger-participants';
import { buildInternalChatViewerPayload } from '../internal-chat-api';
import {
  attachUnreadCountsToContacts,
  buildInternalChatList,
  countUnreadBySender,
  isInternalAffiliation,
} from '../../supabase/functions/_shared/internal-chat';

describe('isInternalAffiliation', () => {
  test('treats 본부, 팀, 직할 affiliations as internal', () => {
    expect(isInternalAffiliation('1본부 서선미')).toBe(true);
    expect(isInternalAffiliation('7팀 김동훈')).toBe(true);
    expect(isInternalAffiliation('직할 조직')).toBe(true);
  });

  test('excludes empty and non-internal affiliations', () => {
    expect(isInternalAffiliation('')).toBe(false);
    expect(isInternalAffiliation('외부 조직')).toBe(false);
  });
});

describe('buildInternalChatList', () => {
  test('builds last-message previews and unread counts only for internal FC participants', () => {
    const result = buildInternalChatList({
      viewerId: ADMIN_CHAT_ID,
      participants: [
        { fc_id: 'fc-1', name: '문주화', phone: '010-1111-2222', affiliation: '1본부 서선미' },
        { fc_id: 'fc-2', name: '외부 FC', phone: '010-3333-4444', affiliation: '외부 조직' },
        { fc_id: 'fc-3', name: '박충희', phone: '010-5555-6666', affiliation: '2팀 가람' },
      ],
      messages: [
        {
          sender_id: '01011112222',
          receiver_id: ADMIN_CHAT_ID,
          content: '안녕하세요',
          created_at: '2026-04-20T10:00:00.000Z',
          is_read: false,
        },
        {
          sender_id: ADMIN_CHAT_ID,
          receiver_id: '01011112222',
          content: '답변드립니다',
          created_at: '2026-04-20T10:05:00.000Z',
          is_read: true,
        },
        {
          sender_id: '01033334444',
          receiver_id: ADMIN_CHAT_ID,
          content: '외부 메시지',
          created_at: '2026-04-20T10:10:00.000Z',
          is_read: false,
        },
      ],
    });

    expect(result.totalUnread).toBe(1);
    expect(result.items).toEqual([
      {
        fc_id: 'fc-1',
        name: '문주화',
        phone: '01011112222',
        affiliation: '1본부 서선미',
        last_message: '답변드립니다',
        last_time: '2026-04-20T10:05:00.000Z',
        unread_count: 1,
      },
      {
        fc_id: 'fc-3',
        name: '박충희',
        phone: '01055556666',
        affiliation: '2팀 가람',
        last_message: null,
        last_time: null,
        unread_count: 0,
      },
    ]);
  });
});

describe('countUnreadBySender', () => {
  test('aggregates unread rows by sender id', () => {
    expect(
      countUnreadBySender([
        { sender_id: '01011112222' },
        { sender_id: '01011112222' },
        { sender_id: ADMIN_CHAT_ID },
      ]),
    ).toEqual({
      '01011112222': 2,
      [ADMIN_CHAT_ID]: 1,
    });
  });
});

describe('attachUnreadCountsToContacts', () => {
  test('adds unread_count per sanitized contact phone', () => {
    expect(
      attachUnreadCountsToContacts(
        [
          { name: '서선미', phone: '010-1111-2222' },
          { name: '개발자', phone: '010-3333-4444' },
        ],
        {
          '01011112222': 4,
        },
      ),
    ).toEqual([
      { name: '서선미', phone: '010-1111-2222', unread_count: 4 },
      { name: '개발자', phone: '010-3333-4444', unread_count: 0 },
    ]);
  });
});

describe('buildInternalChatViewerPayload', () => {
  test('uses the shared admin actor id for writable admin sessions', () => {
    expect(
      buildInternalChatViewerPayload({
        role: 'admin',
        residentId: '010-1234-5678',
        readOnly: false,
        staffType: 'admin',
        isRequestBoardDesigner: false,
      }),
    ).toEqual({
      viewer_id: ADMIN_CHAT_ID,
      viewer_role: 'admin',
      viewer_staff_type: 'admin',
      viewer_read_only: false,
      viewer_is_request_board_designer: false,
    });
  });

  test('uses the resident phone for read-only managers and request-board designers', () => {
    expect(
      buildInternalChatViewerPayload({
        role: 'admin',
        residentId: '010-2222-3333',
        readOnly: true,
        staffType: null,
        isRequestBoardDesigner: false,
      }),
    ).toEqual({
      viewer_id: '01022223333',
      viewer_role: 'admin',
      viewer_staff_type: null,
      viewer_read_only: true,
      viewer_is_request_board_designer: false,
    });

    expect(
      buildInternalChatViewerPayload({
        role: 'admin',
        residentId: '010-4444-5555',
        readOnly: false,
        staffType: null,
        isRequestBoardDesigner: true,
      }),
    ).toEqual({
      viewer_id: '01044445555',
      viewer_role: 'admin',
      viewer_staff_type: null,
      viewer_read_only: false,
      viewer_is_request_board_designer: true,
    });
  });

  test('uses the resident phone for fc sessions and returns null when the phone is missing', () => {
    expect(
      buildInternalChatViewerPayload({
        role: 'fc',
        residentId: '010-7777-8888',
        readOnly: false,
        staffType: null,
        isRequestBoardDesigner: false,
      }),
    ).toEqual({
      viewer_id: '01077778888',
      viewer_role: 'fc',
      viewer_staff_type: null,
      viewer_read_only: false,
      viewer_is_request_board_designer: false,
    });

    expect(
      buildInternalChatViewerPayload({
        role: 'fc',
        residentId: '',
        readOnly: false,
        staffType: null,
        isRequestBoardDesigner: false,
      }),
    ).toBeNull();
  });
});
