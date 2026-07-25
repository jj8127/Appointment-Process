import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_FC_LIST_COLUMNS,
  DASHBOARD_FC_LIST_COLUMN_COUNT,
  formatDashboardResidentNumberCell,
  formatDashboardSignupDate,
  normalizeDashboardFcListRow,
} from './dashboard-table-display.ts';

test('dashboard FC list places the resident-number column immediately after FC information', () => {
  assert.equal(DASHBOARD_FC_LIST_COLUMN_COUNT, 9);
  assert.deepEqual(
    DASHBOARD_FC_LIST_COLUMNS.slice(0, 3).map(({ key, label }) => ({ key, label })),
    [
      { key: 'fc', label: 'FC 정보' },
      { key: 'residentNumber', label: '주민등록번호' },
      { key: 'phone', label: '연락처' },
    ],
  );
});

test('resident-number list cells fail closed for every non-ready state', () => {
  assert.equal(formatDashboardResidentNumberCell({ status: 'loading' }), '조회 중');
  assert.equal(formatDashboardResidentNumberCell({ status: 'unavailable' }), '조회 불가');
  assert.equal(formatDashboardResidentNumberCell({ status: 'error' }), '조회 실패');
  assert.equal(formatDashboardResidentNumberCell(undefined), '조회 실패');
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
