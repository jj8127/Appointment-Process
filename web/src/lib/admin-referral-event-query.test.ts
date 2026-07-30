import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  chunkReferralEventFcIds,
  mergeReferralEventChunks,
  REFERRAL_EVENT_FC_ID_CHUNK_SIZE,
} from './admin-referral-event-query.ts';

test('chunks large FC collections so referral-event filters stay bounded', () => {
  const fcIds = Array.from({ length: 447 }, (_, index) => `fc-${index}`);
  const chunks = chunkReferralEventFcIds(fcIds);

  assert.equal(chunks.length, Math.ceil(447 / REFERRAL_EVENT_FC_ID_CHUNK_SIZE));
  assert.ok(chunks.every((chunk) => chunk.length <= REFERRAL_EVENT_FC_ID_CHUNK_SIZE));
  assert.deepEqual(chunks.flat(), fcIds);
});

test('deduplicates repeated FC ids before creating query chunks', () => {
  assert.deepEqual(chunkReferralEventFcIds(['fc-1', 'fc-1', ' ', 'fc-2'], 1), [
    ['fc-1'],
    ['fc-2'],
  ]);
});

test('deduplicates cross-chunk events and restores global newest-first order', () => {
  const duplicate = { id: 'event-2', created_at: '2026-07-25T02:00:00.000Z' };
  const merged = mergeReferralEventChunks([
    [
      { id: 'event-1', created_at: '2026-07-25T01:00:00.000Z' },
      duplicate,
    ],
    [
      duplicate,
      { id: 'event-3', created_at: '2026-07-25T03:00:00.000Z' },
    ],
  ]);

  assert.deepEqual(merged.map((event) => event.id), ['event-3', 'event-2', 'event-1']);
});

test('admin referral loading uses bounded chunks instead of one unbounded FC-id filter', () => {
  const source = readFileSync(new URL('./admin-referrals.ts', import.meta.url), 'utf8');

  assert.match(source, /chunkReferralEventFcIds\(fcIds\)\.map/);
  assert.match(source, /mergeReferralEventChunks\(eventChunks\)/);
  assert.doesNotMatch(source, /fcIds\.join\(','\)/);
});
