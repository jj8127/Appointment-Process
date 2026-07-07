import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_FC_LIST_COLUMN_COUNT,
  formatDashboardSignupDate,
  normalizeDashboardFcListRow,
} from './dashboard-table-display.ts';

test('dashboard FC list has a signup-date column in the table contract', () => {
  assert.equal(DASHBOARD_FC_LIST_COLUMN_COUNT, 8);
});

test('uses FC password setup time as the signup date when credentials are joined', () => {
  const row = normalizeDashboardFcListRow({
    id: 'fc-1',
    created_at: '2026-06-01T00:00:00.000Z',
    fc_credentials: [{ password_set_at: '2026-06-08T02:30:00.000Z' }],
  });

  assert.equal(row.signup_completed_at, '2026-06-08T02:30:00.000Z');
  assert.equal(formatDashboardSignupDate(row.signup_completed_at), '2026-06-08');
});

test('falls back to FC profile creation time when password setup time is unavailable', () => {
  const row = normalizeDashboardFcListRow({
    id: 'fc-2',
    created_at: '2026-05-21T10:15:00.000Z',
    fc_credentials: [],
  });

  assert.equal(row.signup_completed_at, '2026-05-21T10:15:00.000Z');
  assert.equal(formatDashboardSignupDate(row.signup_completed_at), '2026-05-21');
});

test('formats missing or invalid signup dates as an empty-cell dash', () => {
  assert.equal(formatDashboardSignupDate(null), '-');
  assert.equal(formatDashboardSignupDate('not-a-date'), '-');
});
