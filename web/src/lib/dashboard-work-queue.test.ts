import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countDashboardWork,
  getDashboardWorkOccurredAt,
  getDashboardWorkQueueKey,
  isDashboardMetricFilter,
  type DashboardWorkSignals,
} from './dashboard-work-queue.ts';

const idle: DashboardWorkSignals = {
  step: 0,
  allowanceKey: 'missing',
  docProgressKey: 'no-request',
  hanwhaKey: 'ready',
  lifeKey: 'not-set',
  nonlifeKey: 'not-set',
};

test('allowance and document queues keep the original metric-card conditions', () => {
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 1, allowanceKey: 'entered' }), 'pendingAllowance');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 1, allowanceKey: 'prescreen' }), 'pendingAllowance');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 1, allowanceKey: 'missing' }), null);
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 2, allowanceKey: 'entered' }), null);
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 2, docProgressKey: 'in-progress' }), 'pendingDocs');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 2, docProgressKey: 'requested' }), null);
});

test('commission queues wait only on FC submissions the admin has not decided', () => {
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 3, hanwhaKey: 'review' }), 'pendingHanwha');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 3, hanwhaKey: 'rejected' }), null);
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 4, lifeKey: 'fc-done' }), 'pendingAppointment');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 4, lifeKey: 'approved', nonlifeKey: 'fc-done' }), 'pendingAppointment');
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 4, lifeKey: 'approved', nonlifeKey: 'in-progress' }), null);
  assert.equal(getDashboardWorkQueueKey({ ...idle, step: 5, lifeKey: 'fc-done' }), null);
});

test('queue counts add up to the pending total and ignore FCs outside every queue', () => {
  const { counts, pending } = countDashboardWork(['pendingDocs', null, 'pendingDocs', 'pendingHanwha', null]);
  assert.deepEqual(counts, { pendingAllowance: 0, pendingDocs: 2, pendingHanwha: 1, pendingAppointment: 0 });
  assert.equal(pending, 3);
});

test('URL metric filters accept every queue key and reject unknown values', () => {
  for (const value of ['all', 'pendingAllowance', 'pendingDocs', 'pendingHanwha', 'pendingAppointment']) {
    assert.equal(isDashboardMetricFilter(value), true);
  }
  assert.equal(isDashboardMetricFilter('pendingExam'), false);
  assert.equal(isDashboardMetricFilter(null), false);
});

test('queue items carry the time the FC submission started waiting', () => {
  assert.equal(
    getDashboardWorkOccurredAt('pendingAllowance', { allowance_date: '2026-10-10', allowance_prescreen_requested_at: '2026-10-12T03:00:00Z' }),
    '2026-10-12T03:00:00Z',
  );
  assert.equal(getDashboardWorkOccurredAt('pendingAllowance', { allowance_date: '2026-10-10' }), '2026-10-10');
  assert.equal(getDashboardWorkOccurredAt('pendingHanwha', { hanwha_commission_date_sub: '2026-10-05' }), '2026-10-05');
  assert.equal(
    getDashboardWorkOccurredAt('pendingAppointment', { appointment_date_life_sub: '2026-10-01', appointment_date_nonlife_sub: '2026-10-08' }),
    '2026-10-08',
  );
  assert.equal(
    getDashboardWorkOccurredAt('pendingDocs', {
      fc_documents: [
        { storage_path: 'a.pdf', status: 'pending', created_at: '2026-10-03T00:00:00Z' },
        { storage_path: 'b.pdf', status: 'approved', created_at: '2026-10-09T00:00:00Z' },
        { storage_path: null, status: 'pending', created_at: '2026-10-11T00:00:00Z' },
      ],
    }),
    '2026-10-03T00:00:00Z',
  );
  assert.equal(getDashboardWorkOccurredAt('pendingHanwha', {}), null);
});
