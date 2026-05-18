import { getMessengerLoadingContent } from '@/lib/messenger-loading';

describe('getMessengerLoadingContent', () => {
  it('returns user-facing copy for messenger hub loading', () => {
    expect(getMessengerLoadingContent('hub')).toEqual({
      title: '메신저 채널을 준비하고 있어요',
      subtitle: '읽지 않은 대화와 채널 정보를 정리하는 중입니다.',
    });
  });

  it('returns user-facing copy for target picker loading', () => {
    expect(getMessengerLoadingContent('targets')).toEqual({
      title: '대화 상대를 불러오고 있어요',
      subtitle: '본부장, 총무, 개발자 목록을 불러오는 중입니다.',
    });
  });

  it('returns user-facing copy for admin messenger loading', () => {
    expect(getMessengerLoadingContent('admin-messenger')).toEqual({
      title: '가람지사 메신저를 불러오고 있어요',
      subtitle: '대화 목록과 읽지 않은 메시지를 정리하는 중입니다.',
    });
  });

  it('returns user-facing copy for notifications loading', () => {
    expect(getMessengerLoadingContent('notifications')).toEqual({
      title: '알림을 불러오고 있어요',
      subtitle: '최신 알림과 읽음 상태를 확인하는 중입니다.',
    });
  });

  it('returns user-facing copy for request board messenger loading', () => {
    expect(getMessengerLoadingContent('request-board-messenger')).toEqual({
      title: '가람Link 메신저를 준비하고 있어요',
      subtitle: '대화방과 메시지 상태를 동기화하는 중입니다.',
    });
  });

  it('returns user-facing copy for request board home loading', () => {
    expect(getMessengerLoadingContent('request-board')).toEqual({
      title: '가람Link를 불러오고 있어요',
      subtitle: '최근 알림과 요청 현황을 정리하는 중입니다.',
    });
  });

  it('returns user-facing copy for request code loading', () => {
    expect(getMessengerLoadingContent('request-board-fc-codes')).toEqual({
      title: '설계코드를 불러오고 있어요',
      subtitle: '회사별 코드와 최근 변경 내역을 정리하는 중입니다.',
    });
  });

  it('returns user-facing copy for request detail loading', () => {
    expect(getMessengerLoadingContent('request-board-review')).toEqual({
      title: '의뢰 상세를 불러오고 있어요',
      subtitle: '고객 정보와 설계 진행 현황을 확인하는 중입니다.',
    });
  });
});
