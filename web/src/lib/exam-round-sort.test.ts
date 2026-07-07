import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareExamRoundsByExamDateThenDeadline,
  sortExamRoundsByExamDateThenDeadline,
} from './exam-round-sort.ts';

type DemoRound = {
  id: string;
  exam_date: string | null;
  registration_deadline: string;
};

test('sorts rows with valid exam dates in ascending order', () => {
  const rows: DemoRound[] = [
    { id: 'late', exam_date: '2026-07-01', registration_deadline: '2026-06-25' },
    { id: 'early', exam_date: '2026-06-10', registration_deadline: '2026-06-01' },
    { id: 'middle', exam_date: '2026-06-15', registration_deadline: '2026-06-02' },
  ];

  const sorted = sortExamRoundsByExamDateThenDeadline(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['early', 'middle', 'late']);
});

test('places exam-date-missing rows below dated rows', () => {
  const rows: DemoRound[] = [
    { id: 'missing-fast', exam_date: null, registration_deadline: '2026-06-01' },
    { id: 'dated', exam_date: '2026-06-10', registration_deadline: '2026-06-20' },
    { id: 'missing-slow', exam_date: null, registration_deadline: '2026-06-03' },
  ];

  const sorted = sortExamRoundsByExamDateThenDeadline(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['dated', 'missing-fast', 'missing-slow']);
});

test('sorts missing-date rows by registration_deadline ascending', () => {
  const rows: DemoRound[] = [
    { id: 'late', exam_date: null, registration_deadline: '2026-06-30' },
    { id: 'early', exam_date: null, registration_deadline: '2026-06-01' },
    { id: 'same', exam_date: null, registration_deadline: '2026-06-01' },
  ];

  const sorted = sortExamRoundsByExamDateThenDeadline(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['early', 'same', 'late']);
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

  const byDeadline = compareExamRoundsByExamDateThenDeadline(roundsA, roundsB);

  assert.equal(byDeadline > 0, true);
});
