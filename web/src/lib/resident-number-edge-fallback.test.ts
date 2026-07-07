import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResidentNumberEdgeFallbackRequest } from './resident-number-edge-fallback.ts';

test('builds the admin-action resident-number fallback POST request', () => {
  const request = buildResidentNumberEdgeFallbackRequest({
    supabaseUrl: 'https://project.supabase.co',
    serviceKey: 'service-role-key',
    staffPhone: '01012345678',
    fcIds: ['fc-1', 'fc-2'],
  });

  assert.equal(request.url, 'https://project.supabase.co/functions/v1/admin-action');
  assert.equal(request.init.method, 'POST');
  assert.deepStrictEqual(request.init.headers, {
    'Content-Type': 'application/json',
    apikey: 'service-role-key',
    Authorization: 'Bearer service-role-key',
  });
  assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
    adminPhone: '01012345678',
    action: 'getResidentNumbers',
    payload: { fcIds: ['fc-1', 'fc-2'] },
  });
});

test('preserves the provided URL and payload values without normalization or mutation', () => {
  const fcIds = ['fc-a'];
  const request = buildResidentNumberEdgeFallbackRequest({
    supabaseUrl: 'https://project.supabase.co/',
    serviceKey: ' key-with-spaces ',
    staffPhone: '010-1234-5678',
    fcIds,
  });

  assert.equal(request.url, 'https://project.supabase.co//functions/v1/admin-action');
  assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
    adminPhone: '010-1234-5678',
    action: 'getResidentNumbers',
    payload: { fcIds: ['fc-a'] },
  });
  assert.deepStrictEqual(fcIds, ['fc-a']);
});
