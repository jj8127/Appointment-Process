import {
  EXAM_CANCELLATION_DEADLINE_MESSAGE,
  EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE,
  getExamCancellationDeadlineState,
  getExamSelfCancellationDeadlineMessage,
  getMillisecondsUntilNextKstDay,
} from '../exam-cancellation-policy';

describe('FC exam cancellation deadline in Asia/Seoul', () => {
  it('permits the whole deadline day and closes at the following KST midnight', () => {
    expect(getExamCancellationDeadlineState('2026-09-27', new Date('2026-09-27T14:59:59.999Z')))
      .toBe('open');
    expect(getExamCancellationDeadlineState('2026-09-27', new Date('2026-09-27T15:00:00.000Z')))
      .toBe('closed');
    expect(getExamSelfCancellationDeadlineMessage('2026-09-27', new Date('2026-10-07T04:00:00Z')))
      .toBe('마감된 시험입니다. 취소·변경은 관리자에게 문의해 주세요');
  });

  it('uses the same Korea date for clients represented in different timezones', () => {
    const inCalifornia = new Date('2026-09-27T08:00:00-07:00');
    const inKorea = new Date('2026-09-28T00:00:00+09:00');
    expect(getExamCancellationDeadlineState('2026-09-27', inCalifornia)).toBe('closed');
    expect(getExamCancellationDeadlineState('2026-09-27', inKorea)).toBe('closed');
  });

  it.each([undefined, null, '', 'bad-date', '2026-02-29', '2026-09-31', '2026-9-27', '2026-09-27T00:00:00Z'])(
    'fails closed for unavailable or invalid deadline %s without claiming the exam closed',
    (deadline) => {
      expect(getExamCancellationDeadlineState(deadline, new Date('2026-09-27T10:00:00Z')))
        .toBe('unavailable');
      expect(getExamSelfCancellationDeadlineMessage(deadline, new Date('2026-09-27T10:00:00Z')))
        .toBe(EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE);
      expect(getExamSelfCancellationDeadlineMessage(deadline))
        .not.toBe(EXAM_CANCELLATION_DEADLINE_MESSAGE);
    },
  );

  it('accepts valid leap days and fails closed if the clock is invalid', () => {
    expect(getExamCancellationDeadlineState('2028-02-29', new Date('2028-02-29T14:59:59Z')))
      .toBe('open');
    expect(getExamCancellationDeadlineState('2028-02-29', new Date(NaN))).toBe('unavailable');
  });

  it('schedules refresh on the next KST day, including month and year boundaries', () => {
    expect(getMillisecondsUntilNextKstDay(new Date('2026-09-27T14:59:59.999Z'))).toBe(1);
    expect(getMillisecondsUntilNextKstDay(new Date('2026-09-27T15:00:00.000Z'))).toBe(86_400_000);
    expect(getMillisecondsUntilNextKstDay(new Date('2026-12-31T14:59:00.000Z'))).toBe(60_000);
  });
});
