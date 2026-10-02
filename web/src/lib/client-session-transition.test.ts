import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { clearSessionQueries, createSessionTransitionQueue } from './client-session-transition.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a delayed logout finishes clearing its cookie before a new login can set one', async () => {
  const transition = createSessionTransitionQueue();
  const response = deferred<void>();
  let cookie = 'old-session';
  let loginStarted = false;
  const logout = transition(async () => { await response.promise; cookie = ''; });
  const login = transition(async () => { loginStarted = true; cookie = 'new-session'; });
  await Promise.resolve();
  assert.equal(loginStarted, false);
  response.resolve();
  await Promise.all([logout, login]);
  assert.equal(cookie, 'new-session');
});

test('a failed transition releases the queue so recovery login can run', async () => {
  const transition = createSessionTransitionQueue();
  const failed = transition(async () => { throw new Error('network unavailable'); });
  const recovered = transition(async () => 'recovered');
  await assert.rejects(failed, /network unavailable/);
  assert.equal(await recovered, 'recovered');
});

test('the browser lock covers the entire cookie change and client session update', async () => {
  const calls: string[] = [];
  const transition = createSessionTransitionQueue(async (operation) => {
    calls.push('locked');
    try { return await operation(); } finally { calls.push('released'); }
  });
  await transition(async () => { calls.push('cookie', 'session'); });
  assert.deepEqual(calls, ['locked', 'cookie', 'session', 'released']);
});

test('account switch drops old cached data and prevents a late query from repopulating it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['documents'], ['old-account-document']);
  const delayed = deferred<string[]>();
  const pending = client.fetchQuery({ queryKey: ['appointments'], queryFn: () => delayed.promise }).catch(() => undefined);
  clearSessionQueries(client);
  assert.equal(client.getQueryData(['documents']), undefined);
  assert.equal(client.getQueryData(['appointments']), undefined);
  client.setQueryData(['documents'], ['new-account-document']);
  delayed.resolve(['old-account-appointment']);
  await pending;
  assert.deepEqual(client.getQueryData(['documents']), ['new-account-document']);
  assert.equal(client.getQueryData(['appointments']), undefined);
  client.clear();
});
