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

  assert.equal(source.match(/chunkReferralEventFcIds\(fcIds\)\.map/g)?.length, 2);
  assert.match(
    source,
    /async function fetchReferralCodes[\s\S]*?chunkReferralEventFcIds\(fcIds\)\.map[\s\S]*?\.in\('fc_id', chunk\)[\s\S]*?mergeReferralEventChunks\(codeChunks\)/,
  );
  assert.match(source, /mergeReferralEventChunks\(eventChunks\)/);
  assert.doesNotMatch(
    source,
    /async function fetchReferralCodes[\s\S]*?\.in\('fc_id', fcIds\)[\s\S]*?async function fetchReferralEvents/,
  );
  assert.doesNotMatch(source, /fcIds\.join\(','\)/);
});

test('large referral-code reads reuse bounded chunks and merge duplicate rows newest-first', () => {
  const fcIds = [
    ...Array.from({ length: 444 }, (_, index) => `fc-${index}`),
    'fc-0',
    ' ',
  ];
  const chunks = chunkReferralEventFcIds(fcIds);

  assert.equal(chunks.length, Math.ceil(444 / REFERRAL_EVENT_FC_ID_CHUNK_SIZE));
  assert.ok(chunks.every((chunk) => chunk.length <= REFERRAL_EVENT_FC_ID_CHUNK_SIZE));
  assert.equal(chunks.flat().length, 444);

  const duplicate = { id: 'code-2', created_at: '2026-07-30T02:00:00.000Z' };
  const merged = mergeReferralEventChunks([
    [
      { id: 'code-1', created_at: '2026-07-30T01:00:00.000Z' },
      duplicate,
    ],
    [
      { id: 'code-3', created_at: '2026-07-30T03:00:00.000Z' },
      duplicate,
    ],
  ]);

  assert.deepEqual(merged.map((row) => row.id), ['code-3', 'code-2', 'code-1']);
});
