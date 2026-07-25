import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createStaffSessionValue,
  verifyStaffSessionValue,
} from './staff-session.ts';

const SESSION_ENV_KEYS = [
  'STAFF_SESSION_SECRET',
  'STAFF_SESSION_PREVIOUS_SECRET',
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

function withSessionEnv(
  values: Partial<Record<(typeof SESSION_ENV_KEYS)[number], string>>,
  callback: () => void,
) {
  const previous = Object.fromEntries(
    SESSION_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  for (const key of SESSION_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const key of SESSION_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('staff session secret boundary', () => {
  it('rejects service-role and other authentication-domain keys without a dedicated staff secret', () => {
    withSessionEnv({
      AUTH_SECRET: 'auth-domain-secret-that-must-not-sign-staff-sessions',
      NEXTAUTH_SECRET: 'nextauth-domain-secret-that-must-not-sign-staff-sessions',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-that-must-not-sign-staff-sessions',
    }, () => {
      assert.throws(
        () => createStaffSessionValue({
          role: 'admin',
          residentDigits: 'opaque-admin-id',
        }),
        /Staff session secret is not configured/,
      );
      assert.throws(
        () => verifyStaffSessionValue('payload.signature'),
        /Staff session secret is not configured/,
      );
    });
  });

  it('creates and verifies sessions with the dedicated current secret', () => {
    withSessionEnv({
      STAFF_SESSION_SECRET: 'current-dedicated-staff-session-secret',
    }, () => {
      const value = createStaffSessionValue({
        role: 'manager',
        residentDigits: 'opaque-manager-id',
        nowMs: 1_000,
      });

      assert.deepEqual(
        verifyStaffSessionValue(value, { nowMs: 2_000 }),
        {
          v: 1,
          role: 'manager',
          residentDigits: 'opaque-manager-id',
          iat: 1,
          exp: 28_801,
        },
      );
    });
  });

  it('accepts a previous dedicated secret only for verification during rotation', () => {
    const previousSecret = 'previous-dedicated-staff-session-secret';
    const oldValue = createStaffSessionValue({
      role: 'admin',
      residentDigits: 'opaque-admin-id',
      nowMs: 1_000,
      secret: previousSecret,
    });

    withSessionEnv({
      STAFF_SESSION_SECRET: 'current-dedicated-staff-session-secret',
      STAFF_SESSION_PREVIOUS_SECRET: previousSecret,
    }, () => {
      assert.equal(
        verifyStaffSessionValue(oldValue, { nowMs: 2_000 })?.residentDigits,
        'opaque-admin-id',
      );

      const newValue = createStaffSessionValue({
        role: 'admin',
        residentDigits: 'opaque-admin-id',
        nowMs: 1_000,
      });
      assert.equal(
        verifyStaffSessionValue(newValue, {
          nowMs: 2_000,
          secret: previousSecret,
        }),
        null,
      );
    });
  });
});
