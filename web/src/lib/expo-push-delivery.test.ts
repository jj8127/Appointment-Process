import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyExpoPushDelivery,
  mergeExpoPushDeliverySummaries,
} from './expo-push-delivery.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('classifies accepted and rejected Expo tickets without trusting HTTP success alone', () => {
  assert.deepEqual(
    classifyExpoPushDelivery(3, 200, {
      data: [{ status: 'ok' }, { status: 'error' }, {}],
    }),
    { attempted: 3, accepted: 1, rejected: 2 },
  );
  assert.deepEqual(
    classifyExpoPushDelivery(2, 503, { data: [{ status: 'ok' }, { status: 'ok' }] }),
    { attempted: 2, accepted: 0, rejected: 2 },
  );
});

test('merges chunk summaries into bounded aggregate counts', () => {
  assert.deepEqual(
    mergeExpoPushDeliverySummaries([
      { attempted: 2, accepted: 2, rejected: 0 },
      { attempted: 3, accepted: 1, rejected: 2 },
    ]),
    { attempted: 5, accepted: 3, rejected: 2 },
  );
});

test('admin notice delivery stays inside the Vercel web deployment root', () => {
  const source = readFileSync(
    path.join(sourceRoot, 'app/dashboard/notifications/actions.ts'),
    'utf8',
  );

  assert.match(source, /from '@\/lib\/expo-push-delivery'/);
  assert.doesNotMatch(source, /@shared\/supabase\/functions/);
});
