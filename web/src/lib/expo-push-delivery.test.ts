import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import * as pushPreferencePolicy from './app-push-preference-policy.ts';
import * as expoPushDelivery from './expo-push-delivery.ts';
import {
  classifyExpoPushDelivery,
  collectUnregisteredExpoTokens,
  mergeExpoPushDeliverySummaries,
} from './expo-push-delivery.ts';
import * as pushDeliveryResult from './push-notification-delivery-result.ts';
import * as queryContract from './supabase-query-contract.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pushPreferenceServiceExports({
  malformedQuery = null,
  malformedData = null,
  rowsOverride = {},
}: {
  malformedQuery?: string | null;
  malformedData?: unknown;
  rowsOverride?: Partial<Record<string, unknown[]>>;
} = {}) {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const rows: Record<string, unknown[]> = {
    fc_profiles: [{
      id: actorId,
      phone: '01011112222',
      affiliation: null,
      signup_completed: true,
      is_manager_referral_shadow: false,
    }],
    app_push_preferences: [],
    app_push_category_preferences: [],
    ...rowsOverride,
  };
  const queryNames: Record<string, string> = {
    fc_profiles: 'actors',
    app_push_preferences: 'global',
    app_push_category_preferences: 'category',
  };
  const adminSupabase = {
    from(table: string) {
      let single = false;
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const materialize = () => rows[table].filter((row) => (
        typeof row === 'object'
        && row !== null
        && !Array.isArray(row)
        && filters.every((filter) => filter(row as Record<string, unknown>))
      ));
      const query = {
        select() { return query; },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        order() { return query; },
        range(from: number, to: number) {
          const rawData = malformedQuery === queryNames[table]
            ? malformedData
            : materialize();
          const data = Array.isArray(rawData) ? rawData.slice(from, to + 1) : rawData;
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          const sourceRows = materialize();
          const data = malformedQuery === queryNames[table]
            ? malformedData
            : single ? sourceRows[0] ?? null : sourceRows;
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const source = readFileSync(path.join(sourceRoot, 'lib/app-push-preference-service.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  vm.runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === 'server-only') return {};
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/app-push-preference-policy') return pushPreferencePolicy;
      if (id === '@/lib/supabase-query-contract') return queryContract;
      throw new Error(`Missing push preference mock: ${id}`);
    },
  });
  return exports;
}

function pushPreferenceServiceHarness(options: Parameters<typeof pushPreferenceServiceExports>[0] = {}) {
  return pushPreferenceServiceExports(options).loadActorScopedFcExpoTargets;
}

function exactPushPreferenceServiceHarness(options: Parameters<typeof pushPreferenceServiceExports>[0] = {}) {
  return pushPreferenceServiceExports(options).loadExactFcExpoPreference;
}

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

test('collects only DeviceNotRegistered destinations from a successful Expo response', () => {
  const messages = [{ to: 'ExponentPushToken[a]' }, { to: 'ExponentPushToken[b]' }, { to: 'ExponentPushToken[c]' }];
  assert.deepEqual(
    collectUnregisteredExpoTokens(messages, 200, {
      data: [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'MessageRateExceeded' } },
      ],
    }),
    ['ExponentPushToken[b]'],
  );
  const unregistered = { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] };
  assert.deepEqual(collectUnregisteredExpoTokens(messages, 503, unregistered), []);
  assert.deepEqual(collectUnregisteredExpoTokens(messages, 200, { data: null }), []);
  assert.deepEqual(collectUnregisteredExpoTokens([{}], 200, unregistered), []);
});

const RESIDENT_PHONE = '01011112222';
const RESIDENT_ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';

function residentDeliveryHarness({
  preference,
  tokens,
  expoTickets = [],
}: {
  preference: { enabled: boolean; lookupFailed: boolean };
  tokens: string[];
  expoTickets?: unknown[];
}) {
  const fetchCalls: unknown[][] = [];
  const deletedTokens: unknown[][] = [];
  const preferenceCalls: unknown[][] = [];
  const adminSupabase = {
    from(table: string) {
      let deleting = false;
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle() { return query; },
        delete() { deleting = true; return query; },
        in(_column: string, values: unknown[]) {
          if (deleting) deletedTokens.push(values);
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = deleting
            ? null
            : table === 'fc_profiles'
              ? { id: RESIDENT_ACTOR_ID, phone: RESIDENT_PHONE }
              : tokens.map((token) => ({ expo_push_token: token }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const source = readFileSync(path.join(sourceRoot, 'lib/push-notification-service.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const noop = () => undefined;
  vm.runInNewContext(code, {
    exports,
    AbortSignal,
    fetch: async (...args: unknown[]) => {
      fetchCalls.push(args);
      return { ok: true, status: 200, json: async () => ({ data: expoTickets }) };
    },
    require: (id: string) => {
      if (id === 'server-only') return {};
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/logger') return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
      if (id === '@/lib/push-notification-delivery-result') return pushDeliveryResult;
      if (id === '@/lib/expo-push-delivery') return expoPushDelivery;
      if (id === '@/lib/app-push-preference-service') {
        return {
          loadExactFcExpoPreference: async (...args: unknown[]) => {
            preferenceCalls.push(args);
            return { ...preference, category: 'operations' };
          },
        };
      }
      throw new Error(`Missing push service mock: ${id}`);
    },
  });
  const send = () => exports.sendPushNotificationToResidentDevices(
    RESIDENT_PHONE,
    {
      title: '서류 승인 안내',
      body: '서류가 승인되었습니다.',
      target: { version: 1, kind: 'onboarding_section', fcId: RESIDENT_ACTOR_ID, section: 'docs_upload' },
      category: 'app_event',
    },
    NOTIFICATION_ID,
    RESIDENT_ACTOR_ID,
  ) as Promise<{
    delivery: { notificationStored: boolean; pushStatus: string };
    failures: string[];
    expo: { attempted: number; accepted: number; rejected: number };
  }>;
  return { send, fetchCalls, deletedTokens, preferenceCalls };
}

test('resident push keeps the inbox row but skips devices when the FC turned app push off', async () => {
  const harness = residentDeliveryHarness({
    preference: { enabled: false, lookupFailed: false },
    tokens: ['ExponentPushToken[a]'],
  });
  const result = await harness.send();
  assert.equal(harness.fetchCalls.length, 0);
  assert.deepEqual(harness.preferenceCalls, [[RESIDENT_ACTOR_ID, 'app_event']]);
  assert.equal(result.delivery.notificationStored, true);
  assert.equal(result.delivery.pushStatus, 'no_registered_device');
  assert.equal(JSON.stringify(result.failures), '[]');
});

test('resident push fails closed when the app push preference cannot be read', async () => {
  const harness = residentDeliveryHarness({
    preference: { enabled: false, lookupFailed: true },
    tokens: ['ExponentPushToken[a]'],
  });
  const result = await harness.send();
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(result.delivery.notificationStored, true);
  assert.equal(result.delivery.pushStatus, 'provider_rejected');
  assert.equal(JSON.stringify(result.failures), JSON.stringify(['preference_lookup_failed']));
});

test('resident push deletes tokens Expo reports as no longer registered', async () => {
  const harness = residentDeliveryHarness({
    preference: { enabled: true, lookupFailed: false },
    tokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
    expoTickets: [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ],
  });
  const result = await harness.send();
  assert.equal(harness.fetchCalls.length, 1);
  assert.deepEqual(harness.deletedTokens, [['ExponentPushToken[b]']]);
  assert.equal(result.expo.attempted, 2);
  assert.equal(result.expo.accepted, 1);
});

test('admin notice delivery stays inside the Vercel web deployment root', () => {
  const source = readFileSync(
    path.join(sourceRoot, 'app/dashboard/notifications/actions.ts'),
    'utf8',
  );

  assert.match(source, /from '@\/lib\/expo-push-delivery'/);
  assert.doesNotMatch(source, /@shared\/supabase\/functions/);
});

test('FC Expo target lookup rejects malformed successful list query results', async () => {
  const token = {
    expo_push_token: 'ExponentPushToken[test]',
    resident_id: '01011112222',
  };
  const validLoad = pushPreferenceServiceHarness();
  const validResult = await validLoad([token], 'notice') as {
    eligibleTokens: string[];
    suppressedTokens: number;
    lookupFailed: boolean;
  };
  assert.equal(JSON.stringify(validResult), JSON.stringify({
    eligibleTokens: [token.expo_push_token],
    suppressedTokens: 0,
    lookupFailed: false,
    category: 'notices',
  }));

  for (const malformedQuery of ['actors', 'global', 'category']) {
    for (const malformedData of [null, { unexpected: true }]) {
      const load = pushPreferenceServiceHarness({ malformedQuery, malformedData });
      const result = await load([token], 'notice') as {
        eligibleTokens: string[];
        suppressedTokens: number;
        lookupFailed: boolean;
      };
      assert.equal(result.lookupFailed, true, `${malformedQuery} must reject ${JSON.stringify(malformedData)}`);
      assert.equal(JSON.stringify(result.eligibleTokens), '[]');
      assert.equal(result.suppressedTokens, 0);
    }
  }
});

test('exact FC preference lookup rejects non-null rows that do not match the requested tuple', async () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const validLoad = exactPushPreferenceServiceHarness();
  assert.equal(JSON.stringify(await validLoad(actorId, 'notice')), JSON.stringify({
    enabled: true,
    lookupFailed: false,
    category: 'notices',
  }));

  const malformedCases = [
    ['global', { actor_id: actorId, actor_role: 'admin', enabled: true }],
    ['global', { actor_id: '22222222-2222-4222-8222-222222222222', actor_role: 'fc', enabled: true }],
    ['global', { actor_id: actorId, actor_role: 'fc', enabled: 'true' }],
    ['category', { actor_id: actorId, actor_role: 'fc', category: 'messages', enabled: true }],
    ['category', { actor_id: actorId, actor_role: 'fc', category: 'notices', enabled: null }],
  ] as const;
  for (const [malformedQuery, malformedData] of malformedCases) {
    const load = exactPushPreferenceServiceHarness({ malformedQuery, malformedData });
    const result = await load(actorId, 'notice') as { enabled: boolean; lookupFailed: boolean };
    assert.equal(result.enabled, false);
    assert.equal(result.lookupFailed, true, `${malformedQuery} must reject ${JSON.stringify(malformedData)}`);
  }
});

test('broadcast FC preference lookup rejects malformed, duplicate, and unrequested rows', async () => {
  const token = {
    expo_push_token: 'ExponentPushToken[test]',
    resident_id: '01011112222',
  };
  const actorId = '11111111-1111-4111-8111-111111111111';
  const invalidResults: Array<[string, unknown]> = [
    ['actors', [{ id: actorId, phone: '01099998888', affiliation: null, signup_completed: true, is_manager_referral_shadow: false }]],
    ['actors', [{ id: actorId, phone: '010-1111-2222', affiliation: null, signup_completed: true, is_manager_referral_shadow: false }]],
    ['actors', [{ id: 'bad', phone: token.resident_id, affiliation: null, signup_completed: true, is_manager_referral_shadow: false }]],
    ['global', [{ actor_id: actorId, actor_role: 'admin', enabled: true }]],
    ['global', [
      { actor_id: actorId, actor_role: 'fc', enabled: true },
      { actor_id: actorId, actor_role: 'fc', enabled: false },
    ]],
    ['global', [{ actor_id: '22222222-2222-4222-8222-222222222222', actor_role: 'fc', enabled: true }]],
    ['category', [{ actor_id: actorId, actor_role: 'fc', category: 'messages', enabled: true }]],
  ];
  for (const [malformedQuery, malformedData] of invalidResults) {
    const load = pushPreferenceServiceHarness({ malformedQuery, malformedData });
    const result = await load([token], 'notice') as {
      eligibleTokens: string[];
      lookupFailed: boolean;
    };
    assert.equal(result.lookupFailed, true, `${malformedQuery} must reject ${JSON.stringify(malformedData)}`);
    assert.equal(JSON.stringify(result.eligibleTokens), '[]');
  }
});

test('broadcast FC target lookup rejects malformed or duplicate token identities', async () => {
  const load = pushPreferenceServiceHarness();
  const validToken = {
    expo_push_token: 'ExponentPushToken[test]',
    resident_id: '01011112222',
  };
  for (const tokens of [
    [{ ...validToken, resident_id: '010-1111-2222' }],
    [{ ...validToken, expo_push_token: '' }],
    [{ ...validToken, expo_push_token: ` ${validToken.expo_push_token}` }],
    [{ ...validToken }, { ...validToken }],
  ]) {
    const result = await load(tokens, 'notice') as {
      eligibleTokens: string[];
      lookupFailed: boolean;
    };
    assert.equal(result.lookupFailed, true);
    assert.equal(JSON.stringify(result.eligibleTokens), '[]');
  }
});

test('broadcast FC account resolution covers target sets larger than one PostgREST page', async () => {
  const targets = Array.from({ length: 501 }, (_, index) => {
    const serial = String(index + 1).padStart(8, '0');
    return {
      actor: {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        phone: `010${serial}`,
        affiliation: null,
        signup_completed: true,
        is_manager_referral_shadow: false,
      },
      token: {
        expo_push_token: `ExponentPushToken[${serial}]`,
        resident_id: `010${serial}`,
      },
    };
  });
  const load = pushPreferenceServiceHarness({
    rowsOverride: {
      fc_profiles: targets.map(({ actor }) => actor),
    },
  });
  const result = await load(targets.map(({ token }) => token), 'notice') as {
    eligibleTokens: string[];
    lookupFailed: boolean;
  };
  assert.equal(result.lookupFailed, false);
  assert.equal(result.eligibleTokens.length, targets.length);
  assert.equal(new Set(result.eligibleTokens).size, targets.length);
});

test('broadcast FC account and preference reads use stable paginated queries', () => {
  const source = readFileSync(
    path.join(sourceRoot, 'lib/app-push-preference-service.ts'),
    'utf8',
  );
  assert.equal((source.match(/collectSupabaseRows</g) ?? []).length, 3);
  assert.match(source, /\.order\('phone',[\s\S]*?\.order\('id',[\s\S]*?\.range\(from, to\)/);
  assert.equal((source.match(/\.order\('actor_id',[\s\S]*?\.range\(from, to\)/g) ?? []).length, 2);
  assert.match(source, /!hasUniqueKeys\(actors,[\s\S]*?normalizePushPreferencePhone/);
});
