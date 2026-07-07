import {
  buildExamInfo,
  buildExamPhoneCandidates,
  formatExamResidentNumber,
  formatExamYmd,
  normalizeExamSingle,
} from '../exam-display';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('exam display helpers', () => {
  it('formats resident numbers and dates consistently', () => {
    expect(formatExamResidentNumber('9001011234567')).toBe('900101-1234567');
    expect(formatExamResidentNumber(null)).toBe('-');
    expect(formatExamYmd('2026-07-03T12:34:00Z')).toBe('2026-07-03');
    expect(formatExamYmd(null)).toBe('-');
  });

  it('normalizes single relation rows and phone search candidates', () => {
    expect(normalizeExamSingle([{ value: 1 }, { value: 2 }])).toEqual({ value: 1 });
    expect(normalizeExamSingle(null)).toBeNull();
    expect(buildExamPhoneCandidates('010-1234-5678')).toEqual([
      '010-1234-5678',
      '01012345678',
    ]);
  });

  it('builds exam info from round and location rows', () => {
    expect(buildExamInfo({
      exam_rounds: {
        exam_type: 'life',
        exam_date: '2026-07-15',
        round_label: '1회',
      },
      exam_locations: { location_name: '서울' },
    })).toContain('1회');
  });

  it('keeps life and nonlife exam manage screens on shared helpers', () => {
    for (const source of [
      readRepoFile('app/exam-manage.tsx'),
      readRepoFile('app/exam-manage2.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/exam-display'");
      expect(source).toContain('formatExamResidentNumber');
      expect(source).toContain('buildExamInfo');
      expect(source).not.toContain('function formatResidentNumber');
      expect(source).not.toContain('function normalizeSingle');
      expect(source).not.toContain('function buildPhoneCandidates');
      expect(source).not.toContain('function formatYmd');
      expect(source).not.toContain('function buildExamInfo');
    }
  });
});
