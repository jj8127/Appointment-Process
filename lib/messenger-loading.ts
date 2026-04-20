export type MessengerLoadingVariant =
  | 'hub'
  | 'targets'
  | 'admin-messenger'
  | 'notifications'
  | 'request-board-messenger'
  | 'request-board'
  | 'request-board-fc-codes'
  | 'request-board-review'
  | 'request-board-requests'
  | 'dashboard'
  | 'detail'
  | 'home'
  | 'appointment'
  | 'hanwha-commission'
  | 'exam'
  | 'exam-applicants';

const LOADING_COPY: Record<
  MessengerLoadingVariant,
  { title: string; subtitle: string }
> = {
  hub: {
    title: '메신저 채널을 준비하고 있어요',
    subtitle: '읽지 않은 대화와 채널 정보를 정리하는 중입니다.',
  },
  targets: {
    title: '대화 상대를 불러오고 있어요',
    subtitle: '본부장, 총무, 개발자 목록을 불러오는 중입니다.',
  },
  'admin-messenger': {
    title: '가람지사 메신저를 불러오고 있어요',
    subtitle: '대화 목록과 읽지 않은 메시지를 정리하는 중입니다.',
  },
  notifications: {
    title: '알림을 불러오고 있어요',
    subtitle: '최신 알림과 읽음 상태를 확인하는 중입니다.',
  },
  'request-board-messenger': {
    title: '가람Link 메신저를 준비하고 있어요',
    subtitle: '대화방과 메시지 상태를 동기화하는 중입니다.',
  },
  'request-board': {
    title: '가람Link를 불러오고 있어요',
    subtitle: '최근 알림과 요청 현황을 정리하는 중입니다.',
  },
  'request-board-fc-codes': {
    title: '설계코드를 불러오고 있어요',
    subtitle: '회사별 코드와 최근 변경 내역을 정리하는 중입니다.',
  },
  'request-board-review': {
    title: '의뢰 상세를 불러오고 있어요',
    subtitle: '고객 정보와 설계 진행 현황을 확인하는 중입니다.',
  },
  'request-board-requests': {
    title: '설계요청 목록을 불러오고 있어요',
    subtitle: '상태별 의뢰와 최신 변경 내용을 정리하는 중입니다.',
  },
  dashboard: {
    title: '대시보드를 준비하고 있어요',
    subtitle: '신청 현황과 관리 화면을 정리하는 중입니다.',
  },
  detail: {
    title: '상세 내용을 불러오고 있어요',
    subtitle: '본문과 첨부 정보를 정리하는 중입니다.',
  },
  home: {
    title: '홈 화면을 준비하고 있어요',
    subtitle: '계정 상태와 운영 정보를 확인하는 중입니다.',
  },
  appointment: {
    title: '위촉 정보를 불러오고 있어요',
    subtitle: '생명·손해 위촉 진행 상태를 확인하는 중입니다.',
  },
  'hanwha-commission': {
    title: '한화 위촉 정보를 불러오고 있어요',
    subtitle: 'URL 상태와 제출 자료를 정리하는 중입니다.',
  },
  exam: {
    title: '시험 정보를 불러오고 있어요',
    subtitle: '일정과 신청 상태를 확인하는 중입니다.',
  },
  'exam-applicants': {
    title: '신청자 목록을 불러오고 있어요',
    subtitle: '최신 시험 신청 현황을 정리하는 중입니다.',
  },
};

export function getMessengerLoadingContent(variant: MessengerLoadingVariant) {
  return LOADING_COPY[variant];
}
