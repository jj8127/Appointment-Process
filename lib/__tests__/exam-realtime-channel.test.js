/* global __dirname, jest, test, expect, beforeEach, afterEach */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { RealtimeClient } = require('@supabase/supabase-js');

global.IS_REACT_ACT_ENVIRONMENT = true;

function compile(source, dependencies) {
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exported = {};
  new Function('exports', ...Object.keys(dependencies), code)(exported, ...Object.values(dependencies));
  return exported;
}

const { subscribeToExamRegistrationChanges } = compile(
  fs.readFileSync(path.join(__dirname, '../exam-realtime-channel.ts'), 'utf8'), {},
);

// The installed SDK owns channels, .on/.subscribe, topic reuse and teardown.
// Only the WebSocket transport is replaced; no network connection is made.
class OfflineWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, wasClean: true });
  }
}

let client;
let finishRemovals;
let root;
let remove;
const filter = { event: '*', schema: 'public', table: 'exam_registrations' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
  client = new RealtimeClient('ws://127.0.0.1:9/realtime/v1', {
    transport: OfflineWebSocket, params: { apikey: 'synthetic-realtime-key' },
  });
  finishRemovals = [];
  const removeChannel = client.removeChannel.bind(client);
  // Explicitly hold cleanup at its async boundary to exercise overlapping
  // owners even when this installed Phoenix version removes synchronously.
  remove = jest.spyOn(client, 'removeChannel').mockImplementation(channel =>
    new Promise(resolve => { finishRemovals.push(async () => resolve(await removeChannel(channel))); }));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  await Promise.all(finishRemovals.map(finish => finish()));
  client.getChannels().forEach(channel => channel.teardown());
  void client.disconnect();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function emit(channel) {
  expect(channel.bindings.postgres_changes[0].filter).toEqual(filter);
  channel.bindings.postgres_changes[0].callback({});
}

test('the installed SDK rejects a second fixed-topic postgres listener after subscription', () => {
  const original = client.channel('exam-manage-life-registrations')
    .on('postgres_changes', filter, () => {}).subscribe();
  const reused = client.channel('exam-manage-life-registrations');
  expect(reused).toBe(original);
  expect(() => reused.on('postgres_changes', filter, () => {}).subscribe())
    .toThrow(/cannot add.*postgres_changes.*after.*subscribe/);
});

test.each(['life', 'nonlife'])('%s: re-entry works before previous cleanup settles and ignores old callbacks', async examType => {
  const oldRefresh = jest.fn();
  const nextRefresh = jest.fn();
  const cleanup = subscribeToExamRegistrationChanges(client, examType, oldRefresh);
  const oldChannel = client.getChannels()[0];
  emit(oldChannel);
  expect(oldRefresh).toHaveBeenCalledTimes(1);
  cleanup();
  const cleanupNext = subscribeToExamRegistrationChanges(client, examType, nextRefresh);
  const nextChannel = client.getChannels()[1];
  expect(nextChannel).not.toBe(oldChannel);
  expect(nextChannel.topic).not.toBe(oldChannel.topic);
  expect(nextChannel.topic).toMatch(new RegExp(`^realtime:exam-manage-${examType}-registrations-[a-z0-9]+-[a-z0-9]+$`));
  emit(oldChannel);
  emit(nextChannel);
  expect(oldRefresh).toHaveBeenCalledTimes(1);
  expect(nextRefresh).toHaveBeenCalledTimes(1);
  await finishRemovals.shift()();
  expect(client.getChannels()).toEqual([nextChannel]);
  cleanupNext();
  cleanupNext();
  expect(remove).toHaveBeenCalledTimes(2);
  emit(nextChannel);
  expect(nextRefresh).toHaveBeenCalledTimes(1);
});

test('simultaneous life/nonlife and repeated life owners preserve independent registration refreshes', () => {
  const refreshers = [jest.fn(), jest.fn(), jest.fn()];
  const cleanup = ['life', 'nonlife', 'life'].map((type, index) =>
    subscribeToExamRegistrationChanges(client, type, refreshers[index]));
  const channels = [...client.getChannels()];
  expect(new Set(channels.map(channel => channel.topic)).size).toBe(3);
  channels.forEach(emit);
  refreshers.forEach(refresh => expect(refresh).toHaveBeenCalledTimes(1));
  cleanup[0]();
  channels.forEach(emit);
  expect(refreshers[0]).toHaveBeenCalledTimes(1);
  expect(refreshers[1]).toHaveBeenCalledTimes(2);
  expect(refreshers[2]).toHaveBeenCalledTimes(2);
  cleanup[1](); cleanup[2]();
});

function loadActualScreenEffect(filename, examType) {
  const source = fs.readFileSync(path.join(__dirname, '../../app', filename), 'utf8');
  const start = source.indexOf('// Realtime:');
  const end = source.indexOf(');', source.indexOf('}, [', start)) + 2;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return compile(`
    export function Probe({hydrated, canReadApplicants, residentId, appSessionToken, refetch}) {
      ${source.slice(start, end)}
      return null;
    }
  `, { useEffect: React.useEffect, supabase: client, EXAM_TYPE: examType, subscribeToExamRegistrationChanges }).Probe;
}

test.each([['exam-manage.tsx', 'life'], ['exam-manage2.tsx', 'nonlife']])(
  '%s: actual effect gates reads and isolates token/account/logout transitions', async (filename, examType) => {
    const Probe = loadActualScreenEffect(filename, examType);
    const refresh = jest.fn();
    let props = { hydrated: false, canReadApplicants: false, residentId: '', appSessionToken: null, refetch: refresh };
    const render = async () => {
      await act(async () => {
        const element = React.createElement(Probe, props);
        if (root) root.update(element); else root = create(element);
      });
    };
    await render();
    expect(client.getChannels()).toHaveLength(0);
    props = { ...props, hydrated: true, residentId: 'fictional-fc', appSessionToken: 'fictional-token' };
    await render();
    expect(client.getChannels()).toHaveLength(0);
    props = { ...props, canReadApplicants: true };
    await render();
    const first = client.getChannels()[0];
    emit(first);
    props = { ...props, appSessionToken: 'fictional-renewed-token' };
    await render();
    const renewed = client.getChannels()[1];
    emit(first); emit(renewed);
    expect(refresh).toHaveBeenCalledTimes(2);
    props = { ...props, residentId: 'fictional-other-account' };
    await render();
    const switched = client.getChannels()[2];
    emit(first); emit(renewed); emit(switched);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(switched.topic).not.toMatch(/fictional|token|account/);
    props = { ...props, canReadApplicants: false, residentId: '', appSessionToken: null };
    await render();
    emit(switched);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
  },
);
