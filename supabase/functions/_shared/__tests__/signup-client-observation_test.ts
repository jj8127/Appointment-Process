import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EdgeDiagnosticInput } from '../edge-diagnostic.ts';
import {
  reportSignupClientObservation,
  SIGNUP_AUTH_PROTOCOL,
  SIGNUP_CLIENT_HEADERS,
} from '../signup-client-observation.ts';

test('classifies a current client with bounded release metadata', () => {
  const records: EdgeDiagnosticInput[] = [];
  reportSignupClientObservation(new Request('https://local.invalid', { headers: {
    [SIGNUP_CLIENT_HEADERS.platform]: 'ios',
    [SIGNUP_CLIENT_HEADERS.appVersion]: '4.2.19',
    [SIGNUP_CLIENT_HEADERS.buildNumber]: '4219',
    [SIGNUP_CLIENT_HEADERS.protocol]: SIGNUP_AUTH_PROTOCOL,
  } }), (record) => records.push(record));
  assert.deepEqual(records, [{
    event: 'signup.client_protocol',
    reason: 'capability_v1',
    platform: 'ios',
    appVersion: '4.2.19',
    buildNumber: '4219',
  }]);
});

test('classifies a request without headers as legacy', () => {
  const records: EdgeDiagnosticInput[] = [];
  reportSignupClientObservation(new Request('https://local.invalid'), (record) => records.push(record));
  assert.deepEqual(records, [{
    event: 'signup.client_protocol',
    reason: 'legacy',
    platform: 'unknown',
    appVersion: undefined,
    buildNumber: undefined,
  }]);
});

test('drops arbitrary header values and marks an unknown protocol invalid', () => {
  const records: EdgeDiagnosticInput[] = [];
  reportSignupClientObservation(new Request('https://local.invalid', { headers: {
    [SIGNUP_CLIENT_HEADERS.platform]: 'private-device',
    [SIGNUP_CLIENT_HEADERS.appVersion]: '4.2.19 private',
    [SIGNUP_CLIENT_HEADERS.buildNumber]: 'x'.repeat(33),
    [SIGNUP_CLIENT_HEADERS.protocol]: 'private-protocol',
  } }), (record) => records.push(record));
  assert.deepEqual(records, [{
    event: 'signup.client_protocol',
    reason: 'invalid',
    platform: 'unknown',
    appVersion: undefined,
    buildNumber: undefined,
  }]);
});
