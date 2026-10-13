/* global describe, it, expect */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  isExamRegistrationHistoryQueryRow,
  isExamRoundQueryRow,
} = require('../exam-read-query-contract');

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

describe('mobile exam read pagination contract', () => {
  it('paginates round and application-history reads with a stable row identity', () => {
    for (const path of ['app/exam-register.tsx', 'app/exam-register2.tsx']) {
      const source = read(path);

      expect(source).toContain('collectSupabaseRows({');
      expect(source).toContain(".order('id', { ascending: true })");
      expect(source).toContain('.range(from, to)');
      expect(source).toContain('isExamRoundQueryRow');
      expect(source).not.toContain('data?.map');
    }

    for (const path of ['app/exam-apply.tsx', 'app/exam-apply2.tsx']) {
      const source = read(path);

      expect(source).toContain('collectSupabaseRows<ExamRoundQueryRow>');
      expect(source).toContain('collectSupabaseRows<ExamRegistrationHistoryQueryRow>');
      expect(source.match(/\.range\(from, to\)/g)).toHaveLength(2);
      expect(source).toContain(".order('id', { ascending: true })");
      expect(source).toContain(".order('id', { ascending: false })");
      expect(source).toContain('isExamRegistrationHistoryQueryRow');
      expect(source).not.toContain('result.data ?? []');
      expect(source).not.toContain('return (data ?? [])');
    }
  });

  it('rejects incomplete round and registration relationship rows', () => {
    const round = {
      id: 'round-1',
      exam_type: 'life',
      exam_month: '2026-10-01',
      exam_date: null,
      registration_deadline: '2026-10-31',
      round_label: '10월 시험',
      notes: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      exam_locations: [{
        id: 'location-1',
        round_id: 'round-1',
        location_name: '서울',
        sort_order: 0,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      }],
    };
    const roundOptions = { includeExamMonth: true, includeExamType: true };

    expect(isExamRoundQueryRow(round, roundOptions)).toBe(true);
    expect(isExamRoundQueryRow({ ...round, exam_locations: null }, roundOptions)).toBe(false);
    expect(isExamRoundQueryRow({
      ...round,
      exam_locations: [{ ...round.exam_locations[0], round_id: 'another-round' }],
    }, roundOptions)).toBe(false);

    const history = {
      id: 'registration-1',
      round_id: 'round-1',
      location_id: 'location-1',
      status: 'applied',
      is_confirmed: false,
      includes_primary_exam: true,
      is_third_exam: false,
      fee_paid_date: null,
      payment_proof_attached: false,
      rejection_reason: null,
      rejected_at: null,
      created_at: '2026-10-01T00:00:00Z',
      exam_month: '2026-10-01',
      exam_rounds: {
        exam_date: null,
        registration_deadline: '2026-10-31',
        round_label: '10월 시험',
        exam_type: 'life',
        exam_month: '2026-10-01',
      },
      exam_locations: { location_name: '서울' },
    };
    const historyOptions = { includeExamMonth: true, includeNestedExamType: true };

    expect(isExamRegistrationHistoryQueryRow(history, historyOptions)).toBe(true);
    expect(isExamRegistrationHistoryQueryRow(
      { ...history, exam_rounds: null },
      historyOptions,
    )).toBe(false);
    expect(isExamRegistrationHistoryQueryRow(
      { ...history, exam_locations: [] },
      historyOptions,
    )).toBe(false);
  });
});
