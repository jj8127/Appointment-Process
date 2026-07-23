import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDeliverySummary,
  classifyExpoResponse,
} from './push-notification-delivery-result.ts';

test('counts only Expo tickets with an explicit ok status as accepted', () => {
  assert.deepStrictEqual(
    classifyExpoResponse(true, {
      data: [
        { status: 'ok', id: 'provider-id-must-not-be-propagated' },
        { status: 'error', message: 'provider detail must not be propagated' },
      ],
    }, 2),
    { accepted: 1, rejected: 1, failures: ['expo_ticket_rejected'] },
  );
});

test('treats malformed and incomplete Expo ticket envelopes as rejected', () => {
  assert.deepStrictEqual(
    classifyExpoResponse(true, { unexpected: true }, 2),
    {
      accepted: 0,
      rejected: 2,
      failures: ['expo_invalid_response', 'expo_ticket_rejected'],
    },
  );
  assert.deepStrictEqual(
    classifyExpoResponse(true, { data: [{ status: 'ok' }] }, 2),
    {
      accepted: 1,
      rejected: 1,
      failures: ['expo_invalid_response', 'expo_ticket_rejected'],
    },
  );
});

test('does not infer acceptance from a ticket with an unknown status', () => {
  assert.deepStrictEqual(
    classifyExpoResponse(true, { data: [{ status: 'queued' }] }, 1),
    { accepted: 0, rejected: 1, failures: ['expo_ticket_rejected'] },
  );
});

test('treats an Expo HTTP failure as rejection even when the body resembles success', () => {
  assert.deepStrictEqual(
    classifyExpoResponse(false, { data: [{ status: 'ok' }] }, 1),
    { accepted: 0, rejected: 1, failures: ['expo_http_failed'] },
  );
});

test('distinguishes confirmed no-target from an unknown target state', () => {
  assert.deepStrictEqual(
    classifyDeliverySummary({ failures: [], expoTargets: 0, webTargets: 0 }),
    { success: false, warning: 'no_target', noTarget: true },
  );
  assert.deepStrictEqual(
    classifyDeliverySummary({
      failures: ['token_query_failed'],
      expoTargets: 0,
      webTargets: 0,
    }),
    { success: false, warning: 'partial_failure', noTarget: false },
  );
  assert.deepStrictEqual(
    classifyDeliverySummary({ failures: [], expoTargets: 1, webTargets: 0 }),
    { success: true, warning: null, noTarget: false },
  );
});
