import {
  formatDday,
  formatHomeMonthDay,
  formatHomeRelativeTime,
  getFcHomeShortcutIcon,
  getFcHomeShortcutLabel,
  getHomeAllowanceDisplay,
  getHomeCategoryTone,
  getKstDaysUntil,
  getNewlyCompletedSteps,
  isFcHomeNextActionWaiting,
  isRecentHomePost,
  isUnreadHomePost,
  rankHomeBoardPosts,
  pickHomeExamRounds,
} from '@/lib/fc-home-sections';

// 2026-10-16 10:00 KST
const NOW = new Date('2026-10-16T01:00:00Z');

describe('FC home progress', () => {
  it('celebrates only steps finished since the last visit, never on a first visit', () => {
    expect(getNewlyCompletedSteps(null, 3)).toEqual([]);
    expect(getNewlyCompletedSteps(3, 3)).toEqual([]);
    expect(getNewlyCompletedSteps(4, 2)).toEqual([]);
    expect(getNewlyCompletedSteps(1, 2)).toEqual([1]);
    expect(getNewlyCompletedSteps(2, 5)).toEqual([2, 3, 4]);
  });

  it('distinguishes waiting on staff from an action the FC can take', () => {
    expect(isFcHomeNextActionWaiting('관리자가 임시사번을 발급중입니다. 기다려주세요.')).toBe(true);
    expect(isFcHomeNextActionWaiting('관리자가 사전 심사를 준비 중입니다.')).toBe(true);
    expect(isFcHomeNextActionWaiting('터치하여 바로 진행하세요')).toBe(false);
  });
});

describe('FC home exam rounds', () => {
  it('counts deadline days in Asia/Seoul with the deadline day open', () => {
    expect(getKstDaysUntil('2026-10-16', NOW)).toBe(0);
    expect(getKstDaysUntil('2026-10-19', NOW)).toBe(3);
    expect(getKstDaysUntil('2026-10-15', NOW)).toBe(-1);
    expect(getKstDaysUntil('not-a-date', NOW)).toBeNull();
    expect(formatDday(0)).toBe('D-DAY');
    expect(formatDday(3)).toBe('D-3');
    // Production rounds can have no exam_date; this crashed the whole home on a device.
    expect(formatHomeMonthDay('2026-10-19')).toBe('10.19');
    expect(formatHomeMonthDay(null)).toBeNull();
    expect(formatHomeMonthDay('')).toBeNull();
  });

  it('picks the nearest open round per type and reports closed types as null', () => {
    const rounds = [
      { examType: 'life' as const, examDate: '2026-11-08', registrationDeadline: '2026-10-25', roundLabel: null },
      { examType: 'life' as const, examDate: '2026-10-30', registrationDeadline: '2026-10-19', roundLabel: '1차' },
      { examType: 'nonlife' as const, examDate: '2026-10-20', registrationDeadline: '2026-10-15', roundLabel: null },
    ];
    expect(pickHomeExamRounds(rounds, NOW)).toEqual([
      { examType: 'life', round: rounds[1] },
      { examType: 'nonlife', round: null },
    ]);
  });
});

describe('FC home lists and shortcuts', () => {
  it('formats short relative times for home rows', () => {
    expect(formatHomeRelativeTime('2026-10-16T00:58:00Z', NOW)).toBe('2분 전');
    expect(formatHomeRelativeTime('2026-10-15T22:00:00Z', NOW)).toBe('3시간 전');
    expect(formatHomeRelativeTime('2026-10-15T10:00:00Z', NOW)).toBe('어제');
    expect(formatHomeRelativeTime('2026-10-01T10:00:00Z', NOW)).toBe('10.1');
    expect(formatHomeRelativeTime(null, NOW)).toBe('');
  });

  it('maps every FC quick link to a 3D icon and a label that fits the grid', () => {
    for (const href of ['/exam-apply', '/exam-apply2', '/fc/new', '/signup', '/consent', '/docs-upload', '/hanwha-commission', '/appointment', '/referral', '/referral-allowance']) {
      expect(getFcHomeShortcutIcon(href)).not.toBeNull();
    }
    expect(getFcHomeShortcutIcon('/unknown')).toBeNull();
    // Life and non-life exams share the pictures used on the exam cards.
    expect(getFcHomeShortcutIcon('/exam-apply')).toBe('life');
    expect(getFcHomeShortcutIcon('/exam-apply2')).toBe('nonlife');
    expect(getFcHomeShortcutLabel('/appointment', '생명/손해 위촉')).toBe('위촉');
    expect(getFcHomeShortcutLabel('/fc/new', '기본 정보')).toBe('기본 정보');
  });
});

describe('FC home news tags', () => {
  it('gives each kind of post its own stable tint and keeps general posts neutral', () => {
    const education = getHomeCategoryTone('교육 일정');
    const product = getHomeCategoryTone('상품추천');
    const notice = getHomeCategoryTone('공지');
    expect(new Set([education.background, product.background, notice.background]).size).toBe(3);
    expect(getHomeCategoryTone('일반')).toEqual({ background: '#eceef1', color: '#374151' });
    expect(getHomeCategoryTone('새 분류')).toEqual(getHomeCategoryTone('새 분류'));
    expect(getHomeCategoryTone('')).toEqual(getHomeCategoryTone('일반'));
  });

  it('marks posts from the last seven days as new', () => {
    expect(isRecentHomePost('2026-10-10T01:00:00Z', NOW)).toBe(true);
    expect(isRecentHomePost('2026-10-08T00:00:00Z', NOW)).toBe(false);
    expect(isRecentHomePost(null, NOW)).toBe(false);
  });

  it('leads with unread must-read, then other unread posts, then already-read ones', () => {
    const post = (id: string, isPinned: boolean, isRead?: boolean) => ({ id, isPinned, isRead, createdAt: '2026-10-10T01:00:00Z' });
    const ranked = rankHomeBoardPosts([
      post('read-pin', true, true),
      post('unread-pin', true, false),
      post('new', false, false),
      post('old', false, true),
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['unread-pin', 'new', 'read-pin', 'old']);
    expect(rankHomeBoardPosts([post('legacy-pin', true), post('legacy', false)]).map((item) => item.id))
      .toEqual(['legacy-pin', 'legacy']);
  });

  it('treats read state as unread when reported and falls back to recency when it is not', () => {
    expect(isUnreadHomePost({ isPinned: false, isRead: false, createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBe(true);
    expect(isUnreadHomePost({ isPinned: false, isRead: true, createdAt: '2026-10-10T01:00:00Z' }, NOW)).toBe(false);
    expect(isUnreadHomePost({ isPinned: false, createdAt: '2026-10-10T01:00:00Z' }, NOW)).toBe(true);
    expect(isUnreadHomePost({ isPinned: false, createdAt: '2026-10-08T00:00:00Z' }, NOW)).toBe(false);
  });
});

describe('FC home allowance card', () => {
  it('always shows an amount with its month, and 0원 when nothing was paid', () => {
    expect(getHomeAllowanceDisplay({ statement: { performanceMonth: '2026-08', summary: { newPaymentKrw: 1234500 } }, loading: false, error: null }))
      .toEqual({ value: '1,234,500원', caption: '2026년 8월 실적' });
    expect(getHomeAllowanceDisplay({ statement: null, loading: false, error: null })).toEqual({ value: '0원', caption: '지급 내역 없음' });
    // An FC outside the allowance pilot gets 403 forbidden: nothing paid, not a broken read.
    expect(getHomeAllowanceDisplay({ statement: null, loading: false, error: { status: 403, code: 'forbidden' } }).value).toBe('0원');
    expect(getHomeAllowanceDisplay({ statement: null, loading: false, error: { status: 503, code: 'unavailable' } }).value).toBe('확인 필요');
  });
});
