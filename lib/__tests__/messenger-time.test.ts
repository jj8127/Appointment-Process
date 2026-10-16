import {
  formatMessengerDayLabel,
  formatMessengerListTime,
  formatMessengerTime,
  messengerRunPosition,
  startsMessengerDay,
} from '../messenger-time';

// Korea time written with its offset, so the tests mean the same thing on any
// machine time zone.
const kst = (y: number, m: number, d: number, h = 12, min = 0, s = 0) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}+09:00`;

describe('messenger time display', () => {
  it('labels a day with its weekday', () => {
    expect(formatMessengerDayLabel(kst(2026, 10, 15))).toBe('2026년 10월 15일 목요일');
    expect(formatMessengerDayLabel('not-a-date')).toBe('');
  });

  it('shows bubble times in Korea time without a leading zero', () => {
    expect(formatMessengerTime(kst(2026, 10, 16, 15, 5))).toBe('오후 3:05');
    expect(formatMessengerTime(kst(2026, 10, 16, 0, 7))).toBe('오전 12:07');
    expect(formatMessengerTime(kst(2026, 10, 16, 12, 0))).toBe('오후 12:00');
    // 2026-10-16 00:30 UTC is 09:30 in Korea, whatever the device zone is.
    expect(formatMessengerTime('2026-10-16T00:30:00Z')).toBe('오전 9:30');
  });

  it('puts a divider on the oldest message of each Korea day in a newest-first list', () => {
    const messages = [
      { at: kst(2026, 10, 15, 9) },
      { at: kst(2026, 10, 15, 8) },
      { at: kst(2026, 10, 14, 23) },
    ];
    const starts = messages.map((_, index) => startsMessengerDay(messages, index, (m) => m.at));
    expect(starts).toEqual([false, true, true]);
  });

  it('keeps 08:00 and 10:00 Korea time on one day (the UTC-midnight divider bug)', () => {
    const messages = [{ at: '2026-10-16T01:00:00Z' }, { at: '2026-10-15T23:00:00Z' }];
    expect(messages.map((_, index) => startsMessengerDay(messages, index, (m) => m.at))).toEqual([false, true]);
  });

  it('groups one sender inside the same minute and breaks on sender or minute change', () => {
    // newest first
    const messages = [
      { who: 'a', at: kst(2026, 10, 16, 15, 6, 1) },
      { who: 'a', at: kst(2026, 10, 16, 15, 5, 50) },
      { who: 'a', at: kst(2026, 10, 16, 15, 5, 10) },
      { who: 'b', at: kst(2026, 10, 16, 15, 5, 5) },
      { who: null, at: kst(2026, 10, 16, 15, 5, 4) },
      { who: null, at: kst(2026, 10, 16, 15, 5, 3) },
    ];
    const run = messages.map((_, index) => messengerRunPosition(messages, index, (m) => m.who, (m) => m.at));
    expect(run).toEqual([
      { first: true, last: true },
      { first: false, last: true },
      { first: true, last: false },
      { first: true, last: true },
      { first: true, last: true },
      { first: true, last: true },
    ]);
  });

  it('shows the list time relative to the Korea day', () => {
    const now = new Date(kst(2026, 10, 15, 15, 0));
    expect(formatMessengerListTime(kst(2026, 10, 15, 9, 5), now)).toBe('오전 9:05');
    expect(formatMessengerListTime(kst(2026, 10, 14, 23), now)).toBe('어제');
    expect(formatMessengerListTime(kst(2026, 3, 2), now)).toBe('3월 2일');
    expect(formatMessengerListTime(kst(2025, 12, 31), now)).toBe('2025. 12. 31.');
    expect(formatMessengerListTime(null, now)).toBe('');
  });
});
