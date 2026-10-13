import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSupabaseMutationReceiptSelect,
  chunkSupabaseFilterValues,
  collectSupabaseRows,
  requireSupabaseRowMatching,
  requireSupabaseRows,
  requireSupabaseRowsMatching,
} from './supabase-query-contract.ts';

test('Supabase mutation receipts select only the identity and verified fields', () => {
  assert.equal(
    buildSupabaseMutationReceiptSelect({ status: 'saved', updated_at: '2026-10-13T00:00:00Z' }),
    'id,status,updated_at',
  );
  assert.equal(buildSupabaseMutationReceiptSelect({ id: 'same', status: 'saved' }), 'id,status');
  assert.throws(
    () => buildSupabaseMutationReceiptSelect({ 'status,private_column': 'saved' }),
    /supabase_mutation_receipt_select_invalid/,
  );
});

test('Supabase array query contract preserves real empty arrays', () => {
  const rows: unknown[] = [];
  assert.equal(requireSupabaseRows(rows, 'test_query'), rows);
});

test('Supabase array query contract rejects null and undefined success payloads', () => {
  for (const value of [null, undefined]) {
    assert.throws(
      () => requireSupabaseRows(value, 'test_query'),
      /test_query_query_contract_invalid/,
    );
  }
});

test('Supabase row query contract rejects a malformed member without returning a partial list', () => {
  const isRow = (value: unknown): value is { id: string } => (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string'
  );
  assert.throws(
    () => requireSupabaseRowsMatching([{ id: 'one' }, null], 'test_rows', isRow),
    /test_rows_row_contract_invalid/,
  );
  assert.deepEqual(
    requireSupabaseRowMatching({ id: 'one' }, 'test_row', isRow),
    { id: 'one' },
  );
  assert.throws(
    () => requireSupabaseRowMatching(null, 'test_row', isRow),
    /test_row_row_contract_invalid/,
  );
});

test('Supabase filter chunking preserves every value without an oversized IN clause', () => {
  assert.deepEqual(chunkSupabaseFilterValues(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunkSupabaseFilterValues([], 2), []);
  assert.throws(
    () => chunkSupabaseFilterValues(['a'], 0),
    /supabase_filter_batch_contract_invalid/,
  );
});

test('Supabase page collector reads through a full page and preserves a verified empty result', async () => {
  const calls: Array<[number, number]> = [];
  const pages = [[{ id: 'one' }, { id: 'two' }], [{ id: 'three' }]];
  const rows = await collectSupabaseRows({
    queryName: 'test_pages',
    pageSize: 2,
    isRow: (value: unknown): value is { id: string } => (
      typeof value === 'object'
      && value !== null
      && typeof (value as { id?: unknown }).id === 'string'
    ),
    rowKey: (row) => row.id,
    fetchPage: async (from, to) => {
      calls.push([from, to]);
      return { data: pages[calls.length - 1] ?? [], error: null };
    },
  });
  assert.deepEqual(rows, [{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
  assert.deepEqual(calls, [[0, 1], [2, 3]]);

  const empty = await collectSupabaseRows({
    queryName: 'test_empty',
    isRow: (_value: unknown): _value is never => false,
    fetchPage: async () => ({ data: [], error: null }),
  });
  assert.deepEqual(empty, []);
});

test('Supabase page collector rejects malformed pages, duplicate identities, and query errors', async () => {
  const isRow = (value: unknown): value is { id: string } => (
    typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
  );
  await assert.rejects(
    collectSupabaseRows({
      queryName: 'test_malformed_page',
      isRow,
      fetchPage: async () => ({ data: null, error: null }),
    }),
    /test_malformed_page_page_query_contract_invalid/,
  );
  let page = 0;
  await assert.rejects(
    collectSupabaseRows({
      queryName: 'test_duplicate_page',
      pageSize: 1,
      isRow,
      rowKey: (row) => row.id,
      fetchPage: async () => ({ data: page++ < 2 ? [{ id: 'same' }] : [], error: null }),
    }),
    /test_duplicate_page_row_identity_contract_invalid/,
  );
  const queryError = new Error('synthetic_query_error');
  await assert.rejects(
    collectSupabaseRows({
      queryName: 'test_query_error',
      isRow,
      fetchPage: async () => ({ data: [], error: queryError }),
    }),
    queryError,
  );
});
