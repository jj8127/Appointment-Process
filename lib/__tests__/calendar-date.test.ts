import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { formatCalendarDate, formatExamCalendarDate, parseCalendarDate } from '../calendar-date';

describe('calendar date roundtrip', () => {
  for (const zone of ['Asia/Seoul', 'America/Los_Angeles', 'Pacific/Honolulu']) {
    it(`preserves a stored date in ${zone}`, () => {
      const previous = process.env.TZ;
      process.env.TZ = zone;
      try {
        const date = parseCalendarDate('2026-10-09');
        expect(date).not.toBeNull();
        expect([date!.getFullYear(), date!.getMonth() + 1, date!.getDate()]).toEqual([2026, 10, 9]);
        expect(formatCalendarDate('2026-10-09')).toBe('2026-10-09');
      } finally { process.env.TZ = previous; }
    });
  }
  it('rejects invalid calendars without rolling the day into another month', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('2026-10-09T00:00:00Z')).toBeNull();
    expect(parseCalendarDate('2028-02-29')?.getDate()).toBe(29);
  });
  it('keeps a saved exam month visible when its day is undecided', () => {
    expect(formatExamCalendarDate(null, '2026-11-01')).toBe('2026년 11월 · 시험일 미정');
    expect(formatExamCalendarDate('2026-11-07', '2026-11-01')).toBe('2026-11-07');
  });

  it.each([
    ['Asia/Seoul', -540], ['America/Los_Angeles', 420], ['Pacific/Honolulu', 600], ['Pacific/Kiritimati', -840],
  ])('executes a date selection and reload in an independent %s process', (zone, offset) => {
    const module = ts.transpileModule(readFileSync(join(__dirname, '../calendar-date.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const result = execFileSync(process.execPath, ['-e', `${module}
      const selected = new Date(2026, 9, 9, 23, 30);
      const saved = [selected.getFullYear(), String(selected.getMonth() + 1).padStart(2, '0'), String(selected.getDate()).padStart(2, '0')].join('-');
      const reloaded = exports.parseCalendarDate(saved);
      process.stdout.write(JSON.stringify({ saved, day: reloaded.getDate(), offset: reloaded.getTimezoneOffset() }));
    `], { encoding: 'utf8', env: { ...process.env, TZ: String(zone) } });
    expect(JSON.parse(result)).toEqual({ saved: '2026-10-09', day: 9, offset });
  });
});
