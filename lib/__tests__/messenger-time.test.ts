import {
  formatMessengerDayLabel,
  formatMessengerListTime,
  startsMessengerDay,
} from '../messenger-time';

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe('messenger time display', () => {
  it('labels a day with its weekday', () => {
    expect(formatMessengerDayLabel(local(2026, 10, 15))).toBe('2026년 10월 15일 목요일');
    expect(formatMessengerDayLabel('not-a-date')).toBe('');
  });

  it('puts a divider on the oldest message of each day in a newest-first list', () => {
    const messages = [
      { at: local(2026, 10, 15, 9) },
      { at: local(2026, 10, 15, 8) },
      { at: local(2026, 10, 14, 23) },
    ];
    const starts = messages.map((_, index) => startsMessengerDay(messages, index, (m) => m.at));
    expect(starts).toEqual([false, true, true]);
  });

  it('shows the list time relative to today', () => {
    const now = new Date(2026, 9, 15, 15, 0);
    expect(formatMessengerListTime(local(2026, 10, 15, 9, 5), now)).toMatch(/9:05/);
    expect(formatMessengerListTime(local(2026, 10, 14, 23), now)).toBe('어제');
    expect(formatMessengerListTime(local(2026, 3, 2), now)).toBe('3월 2일');
    expect(formatMessengerListTime(local(2025, 12, 31), now)).toBe('2025. 12. 31.');
    expect(formatMessengerListTime(null, now)).toBe('');
  });
});
