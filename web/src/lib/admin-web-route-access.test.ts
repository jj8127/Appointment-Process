import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FC_GRAPH_DASHBOARD_PATH,
  resolveAdminWebRouteAccess,
} from './admin-web-route-access.ts';

describe('resolveAdminWebRouteAccess', () => {
  it('allows FC sessions only on the referral graph dashboard', () => {
    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: FC_GRAPH_DASHBOARD_PATH,
        role: 'fc',
        hasSession: true,
      }),
      { type: 'allow' },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard',
        role: 'fc',
        hasSession: true,
      }),
      { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard/referrals',
        role: 'fc',
        hasSession: true,
      }),
      { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard/docs',
        role: 'fc',
        hasSession: true,
      }),
      { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH },
    );
  });

  it('routes signed-in FC users from public entry points to the graph page', () => {
    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/',
        role: 'fc',
        hasSession: true,
      }),
      { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/auth',
        role: 'fc',
        hasSession: true,
      }),
      { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH },
    );
  });

  it('requires FC graph session cookie for FC routes', () => {
    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/',
        role: 'fc',
        hasSession: true,
        hasFcGraphSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/auth',
        role: 'fc',
        hasSession: true,
        hasFcGraphSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard/referrals',
        role: 'fc',
        hasSession: true,
        hasFcGraphSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: FC_GRAPH_DASHBOARD_PATH,
        role: 'fc',
        hasSession: true,
        hasFcGraphSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );
  });

  it('keeps staff dashboard behavior unchanged', () => {
    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard/docs',
        role: 'manager',
        hasSession: true,
        hasStaffSession: true,
      }),
      { type: 'allow' },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/admin/tools',
        role: 'manager',
        hasSession: true,
        hasStaffSession: true,
      }),
      { type: 'redirect', pathname: '/auth' },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/admin/tools',
        role: 'admin',
        hasSession: true,
        hasStaffSession: true,
      }),
      { type: 'allow' },
    );
  });

  it('requires the server-issued staff session cookie for staff routes', () => {
    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/dashboard',
        role: 'manager',
        hasSession: true,
        hasStaffSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );

    assert.deepEqual(
      resolveAdminWebRouteAccess({
        pathname: '/auth',
        role: 'admin',
        hasSession: true,
        hasStaffSession: false,
      }),
      { type: 'redirect', pathname: '/auth', clearSession: true },
    );
  });
});
