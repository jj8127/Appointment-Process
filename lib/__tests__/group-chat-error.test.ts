import {
  GroupChatRequestError,
  classifyGroupChatError,
} from '../group-chat-error';

describe('group chat user-facing errors', () => {
  it('explains that non-completed FC accounts cannot join yet', () => {
    const error = classifyGroupChatError(
      new GroupChatRequestError('본등록이 완료되지 않아 단톡방에 참여할 수 없습니다.', {
        code: 'not_completed',
        status: 403,
      }),
    );

    expect(error.title).toBe('본등록 완료 후 이용 가능');
    expect(error.message).toContain('참여 조건 제한');
    expect(error.message).toContain('본등록');
    expect(error.severity).toBe('warning');
  });

  it('keeps send permission failures separate from server failures', () => {
    const error = classifyGroupChatError(
      new GroupChatRequestError('채팅 권한이 꺼져 있어요. 총무 또는 본부장에게 문의해주세요.', {
        code: 'send_forbidden',
        status: 403,
      }),
    );

    expect(error.title).toBe('발언 권한 제한');
    expect(error.message).toContain('채팅 권한');
    expect(error.severity).toBe('warning');
  });

  it('labels 500-level failures as real server errors', () => {
    const error = classifyGroupChatError(
      new GroupChatRequestError('Database error', {
        code: 'db_error',
        status: 500,
      }),
    );

    expect(error.title).toBe('단톡방 서버 오류');
    expect(error.severity).toBe('error');
  });
});
