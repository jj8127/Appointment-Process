import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  authorizeDeleteAccountRequest,
} from '../../supabase/functions/_shared/delete-account-auth';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), 'utf8');

const fcId = '11111111-1111-4111-8111-111111111111';
const foreignFcId = '22222222-2222-4222-8222-222222222222';
const serviceRoleKey = 'service-role-secret';
const internalSecret = 'delete-account-internal-secret';

const authorize = ({
  body = { role: 'fc' as const, residentId: '01012345678' },
  session = { role: 'fc' as const, phone: '010-1234-5678', fcId },
  authorizationHeader = 'Bearer anon-key',
  internalSecretHeader = '',
}: Partial<Parameters<typeof authorizeDeleteAccountRequest>[0]> = {}) =>
  authorizeDeleteAccountRequest({
    body,
    session,
    authorizationHeader,
    internalSecretHeader,
    serviceRoleKey,
    internalSecret,
  });

describe('delete-account actor-target authorization matrix', () => {
  it('allows only the immutable FC identity and normalized phone from the signed session', () => {
    expect(authorize()).toEqual({
      ok: true,
      mode: 'fc_self',
      targetRole: 'fc',
      targetId: fcId,
    });
    expect(authorize({
      body: {
        role: 'fc',
        residentId: '010-1234-5678',
        residentMask: '010-1234-5678',
        fcId,
      },
    })).toMatchObject({ ok: true, targetId: fcId });
  });

  it.each([
    [{ role: 'fc' as const, residentId: '01099999999' }, 'foreign phone'],
    [{ role: 'fc' as const, residentId: '01012345678', fcId: foreignFcId }, 'foreign FC id'],
    [{ role: 'admin' as const, residentId: '01012345678' }, 'role spoof'],
    [{ role: 'fc' as const, roleHint: 'manager' as const, residentId: '01012345678' }, 'role hint selector'],
    [{ role: 'fc' as const, targetId: foreignFcId, residentId: '01012345678' }, 'internal target selector'],
    [{ role: 'fc' as const, residentId: '01012345678', residentMask: '010-9999-9999' }, 'mask spoof'],
  ])('rejects body selector %#', (body, _label) => {
    expect(authorize({ body })).toMatchObject({
      ok: false,
      status: 403,
      code: 'self_delete_target_mismatch',
    });
  });

  it.each(['admin', 'manager'] as const)(
    'rejects %s app sessions from the FC self-delete endpoint',
    (role) => {
      expect(authorize({
        session: { role, phone: '01012345678' },
      })).toMatchObject({
        ok: false,
        status: 403,
        code: 'self_delete_role_forbidden',
      });
    },
  );

  it('rejects missing sessions and FC sessions without an immutable FC id', () => {
    expect(authorize({ session: null })).toMatchObject({
      ok: false,
      status: 401,
      code: 'missing_app_session',
    });
    expect(authorize({
      session: { role: 'fc', phone: '01012345678' },
    })).toMatchObject({
      ok: false,
      status: 403,
      code: 'self_delete_identity_missing',
    });
  });

  it('requires both exact service authorization and the dedicated internal secret', () => {
    const internalBody = {
      role: 'manager' as const,
      targetId: foreignFcId,
    };
    expect(authorize({
      body: internalBody,
      session: null,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
    })).toMatchObject({
      ok: false,
      code: 'invalid_internal_authorization',
    });
    expect(authorize({
      body: internalBody,
      session: null,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
      internalSecretHeader: 'wrong-secret',
    })).toMatchObject({
      ok: false,
      code: 'invalid_internal_authorization',
    });
    expect(authorize({
      body: internalBody,
      session: null,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
      internalSecretHeader: internalSecret,
    })).toEqual({
      ok: true,
      mode: 'internal',
      targetRole: 'manager',
      targetId: foreignFcId,
    });
  });

  it.each([
    undefined,
    '',
    'superadmin',
    'FC',
    0,
    false,
    {},
    [],
  ])('rejects malformed internal runtime role %p before RPC', (role) => {
    expect(authorize({
      body: {
        role: role as never,
        targetId: foreignFcId,
      },
      session: null,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
      internalSecretHeader: internalSecret,
    })).toMatchObject({
      ok: false,
      status: 403,
      code: 'invalid_internal_authorization',
    });
  });
});

describe('delete-account caller source boundary', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  const settings = read('app/settings.tsx');
  const mobileDashboard = read('app/dashboard.tsx');
  const webSettings = read('web/src/app/dashboard/settings/page.tsx');
  const webSelfDeleteRoute = read('web/src/app/api/account-delete/route.ts');

  it('parses a signed app session and resolves the RPC target from its immutable FC id', () => {
    expect(edge).toContain('parseAppSessionTokenDetailed(appSessionToken)');
    expect(edge).toContain('authorizeDeleteAccountRequest');
    expect(edge).toContain("getEnv('DELETE_ACCOUNT_INTERNAL_SECRET')");
    expect(edge).toContain("req.headers.get('x-delete-account-internal-secret')");
    expect(edge.indexOf('authorizeDeleteAccountRequest({'))
      .toBeLessThan(edge.indexOf("'delete_account_core_transaction_v1'"));
    expect(edge).toContain(".eq('id', authorization.targetId)");
    expect(edge).toContain("p_target_id: authorization.targetId");
    expect(edge).not.toContain("findFcBy('phone'");
    expect(edge).not.toContain('searchOrder');
  });

  it('sends only FC self identity from settings and keeps admin deletion on admin-action', () => {
    expect(settings).toContain('appSessionToken,');
    expect(settings).toContain("role: 'fc'");
    expect(settings).not.toContain('body: { residentId, residentMask');
    expect(mobileDashboard).not.toContain("'delete-account'");
    expect(mobileDashboard).toContain(
      "invokeAdminAction(residentId, 'deleteFc'",
    );
    expect(webSettings).toContain("fetch('/api/account-delete'");
    expect(webSettings).not.toContain("functions.invoke<");
    expect(webSelfDeleteRoute).toContain("allowedRoles: ['fc']");
    expect(webSelfDeleteRoute).toContain('WEB_APP_SESSION_COOKIE');
    expect(webSelfDeleteRoute).toContain("'x-app-session-token': appSessionToken");
    expect(webSelfDeleteRoute).toContain('Authorization: `Bearer ${anonKey}`');
    expect(webSelfDeleteRoute).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
