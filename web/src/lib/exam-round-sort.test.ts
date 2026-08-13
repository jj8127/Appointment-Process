import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareExamRoundsNewestFirst,
  sortExamRoundsNewestFirst,
} from './exam-round-sort.ts';

type DemoRound = {
  id: string;
  exam_date: string | null;
  registration_deadline: string;
  created_at?: string;
};

test('sorts rows with valid exam dates newest first', () => {
  const rows: DemoRound[] = [
    { id: 'late', exam_date: '2026-07-01', registration_deadline: '2026-06-25' },
    { id: 'early', exam_date: '2026-06-10', registration_deadline: '2026-06-01' },
    { id: 'middle', exam_date: '2026-06-15', registration_deadline: '2026-06-02' },
  ];

  const sorted = sortExamRoundsNewestFirst(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['late', 'middle', 'early']);
});

test('places exam-date-missing rows below dated rows', () => {
  const rows: DemoRound[] = [
    { id: 'missing-fast', exam_date: null, registration_deadline: '2026-06-01' },
    { id: 'dated', exam_date: '2026-06-10', registration_deadline: '2026-06-20' },
    { id: 'missing-slow', exam_date: null, registration_deadline: '2026-06-03' },
  ];

  const sorted = sortExamRoundsNewestFirst(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['dated', 'missing-slow', 'missing-fast']);
});

test('sorts missing-date rows by registration deadline newest first', () => {
  const rows: DemoRound[] = [
    { id: 'late', exam_date: null, registration_deadline: '2026-06-30' },
    { id: 'early', exam_date: null, registration_deadline: '2026-06-01' },
    { id: 'same', exam_date: null, registration_deadline: '2026-06-01' },
  ];

  const sorted = sortExamRoundsNewestFirst(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['late', 'early', 'same']);
});

test('applies deadline tie-breaker for same exam-date rows', () => {
  const roundsA: DemoRound = {
    id: 'b',
    exam_date: '2026-06-10',
    registration_deadline: '2026-06-18',
  };
  const roundsB: DemoRound = {
    id: 'a',
    exam_date: '2026-06-10',
    registration_deadline: '2026-06-05',
  };

  const byDeadline = compareExamRoundsNewestFirst(roundsA, roundsB);

  assert.equal(byDeadline < 0, true);
});

test('uses creation time as the final newest-first tie breaker', () => {
  const rows: DemoRound[] = [
    {
      id: 'older-created',
      exam_date: '2026-06-10',
      registration_deadline: '2026-06-01',
      created_at: '2026-05-01T00:00:00Z',
    },
    {
      id: 'newer-created',
      exam_date: '2026-06-10',
      registration_deadline: '2026-06-01',
      created_at: '2026-05-02T00:00:00Z',
    },
  ];

  assert.deepEqual(sortExamRoundsNewestFirst(rows).map((row) => row.id), [
    'newer-created',
    'older-created',
  ]);
});
