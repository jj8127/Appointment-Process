import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { parseExamRoundDeleteInput } from '../../web/src/lib/privileged-action-input-policy';

const root = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('priority security hardening source contracts', () => {
  it('routes mobile device token writes through the trusted Edge Function', () => {
    const source = readRepoFile('lib/notifications.ts');
    const dashboardSource = readRepoFile('app/dashboard.tsx');
    const migration = readRepoFile('supabase/migrations/20260706131220_harden_device_tokens_trusted_path.sql');
    const managerRoleMigration = readRepoFile(
      'supabase/migrations/20260721052837_allow_manager_device_tokens.sql',
    );
    const managerRoleMigrationSql = managerRoleMigration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    const schema = readRepoFile('supabase/schema.sql');

    expect(source).toMatch(/functions\.invoke[\s\S]*'device-token-register'/);
    expect(source).not.toContain(".from('device_tokens')");
    expect(dashboardSource).not.toContain(".from('device_tokens')");
    expect(dashboardSource).toMatch(
      /invokeAdminAction[\s\S]*'sendNotification'[\s\S]*\{\s*fcId,/,
    );
    expect(dashboardSource).not.toContain("functions.invoke('fc-notify'");
    expect(migration).toContain('revoke all on table public.device_tokens from anon');
    expect(migration).toContain('revoke all on table public.device_tokens from authenticated');
    expect(managerRoleMigration).toContain('drop constraint if exists device_tokens_role_check');
    expect(managerRoleMigration).toMatch(
      /add constraint device_tokens_role_check\s+check \(role in \('admin', 'fc', 'manager'\)\)/,
    );
    expect(managerRoleMigrationSql).not.toMatch(
      /\bgrant\b|\bpolicy\b|\binsert\b|\bupdate\b|\bdelete\b/i,
    );
    expect(schema).toContain('20260721052837_allow_manager_device_tokens.sql');
  });

  it('retires web push subscriptions only for the verified server-session actor', () => {
    const source = readRepoFile('web/src/app/api/web-push/subscribe/route.ts');

    expect(source).toContain('getVerifiedReadOnlyAdminSession');
    expect(source).not.toContain('payload.residentId');
    expect(source).not.toContain('payload.role');
    expect(source).not.toContain('.upsert(');
    expect(source).toContain('export async function DELETE');
    expect(source).toContain(".eq('resident_id', sessionCheck.session.residentDigits)");
    expect(source).toContain(".eq('role', sessionCheck.session.role)");
    expect(source).toContain("mode: 'in_app_only'");
  });

  it('keeps privileged admin web routes behind signed-session helpers', () => {
    const checkedFiles = [
      'web/src/app/api/admin/list/route.ts',
      'web/src/app/api/admin/fc/route.ts',
      'web/src/app/api/admin/notices/route.ts',
      'web/src/app/api/admin/exam-applicants/route.ts',
      'web/src/app/api/admin/chat-list/route.ts',
      'web/src/app/api/presence/route.ts',
      'web/src/app/api/fc-delete/route.ts',
      'web/src/app/actions.ts',
      'web/src/app/dashboard/notifications/actions.ts',
      'web/src/app/dashboard/exam/schedule/actions.ts',
      'web/src/app/dashboard/appointment/actions.ts',
      'web/src/app/dashboard/docs/actions.ts',
    ];

    for (const file of checkedFiles) {
      const source = readRepoFile(file);
      expect(`${file}\n${source}`).toMatch(
        /getVerified(?:ReadOnly)?AdminSession|getVerifiedServerSession|requireAdmin(?:OrManagerRead)?Route/,
      );
      expect(`${file}\n${source}`).not.toContain("cookieStore.get('session_role')");
      expect(`${file}\n${source}`).not.toContain("cookieStore.get('session_resident')");
    }
  });

  it('authorizes every exam schedule server action before service-role database access', () => {
    const source = readRepoFile('web/src/app/dashboard/exam/schedule/actions.ts');
    const actionSource = (name: string) => {
      const start = source.indexOf(`export async function ${name}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.indexOf('export async function ', start + 1);
      return source.slice(start, next === -1 ? undefined : next);
    };

    for (const action of ['saveExamRoundAction', 'deleteExamRoundAction']) {
      const body = actionSource(action);
      const authIndex = body.indexOf('await getVerifiedAdminSession()');
      expect(authIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeLessThan(body.indexOf('adminSupabase'));
    }

    const fetchBody = actionSource('fetchExamRoundsAction');
    const readAuthIndex = fetchBody.indexOf('await getVerifiedReadOnlyAdminSession()');
    expect(readAuthIndex).toBeGreaterThanOrEqual(0);
    expect(readAuthIndex).toBeLessThan(fetchBody.indexOf('adminSupabase'));

    const deleteBody = actionSource('deleteExamRoundAction');
    expect(deleteBody).not.toContain(".from('exam_registrations')");
    expect(deleteBody).not.toContain(".from('exam_locations')");
    expect(deleteBody).not.toContain(".from('exam_rounds')");
    expect(deleteBody).toContain("adminSupabase.rpc('delete_exam_round_atomic_v1'");
    expect(deleteBody).toContain('p_actor_phone: sessionCheck.session.residentDigits');
    expect(deleteBody).toContain('p_actor_role: sessionCheck.session.role');
    expect(deleteBody).toContain('parseExamRoundDeleteInput(payload)');
    const receiptIndex = deleteBody.indexOf('data.deleted !== true');
    expect(receiptIndex).toBeGreaterThan(deleteBody.indexOf('await adminSupabase.rpc('));
    expect(deleteBody.indexOf('return { success: true')).toBeGreaterThan(receiptIndex);
    const schema = readRepoFile('supabase/schema.sql');
    expect(schema).toMatch(
      /create table if not exists public\.exam_locations[\s\S]{0,500}round_id uuid not null references public\.exam_rounds \(id\) on delete cascade/,
    );
    expect(schema).toMatch(
      /create table if not exists public\.exam_registrations[\s\S]{0,1200}round_id uuid not null references public\.exam_rounds \(id\) on delete cascade/,
    );
  });

  it('uses a server-only push service below the authenticated server action wrapper', () => {
    const actionSource = readRepoFile('web/src/app/actions.ts');
    const serviceSource = readRepoFile('web/src/lib/push-notification-service.ts');
    const resultSource = readRepoFile('web/src/lib/push-notification-delivery-result.ts');
    const adminFcRouteSource = readRepoFile('web/src/app/api/admin/fc/route.ts');

    expect(serviceSource).toContain("import 'server-only'");
    expect(serviceSource).toContain(".from('device_tokens')");
    expect(serviceSource).not.toContain(".from('web_push_subscriptions')");
    expect(serviceSource).not.toContain('sendWebPush');
    expect(serviceSource).not.toContain("{ userId, title, body }");
    expect(serviceSource).not.toContain('tokens: tokens?.map');
    expect(serviceSource).not.toContain('const respBody = await resp.text()');
    expect(serviceSource).not.toContain('body: respBody');
    expect(serviceSource).not.toContain('Expo push notification failed: ${respBody}');
    expect(serviceSource).not.toContain("logger.error('[push-notification-service] Push notification error:', error)");
    expect(serviceSource).toContain("category: 'push_delivery'");
    expect(serviceSource).toContain('expoAccepted: result.expo.accepted');
    expect(serviceSource).toContain('expoRejected: result.expo.rejected');
    expect(resultSource).toContain("failures: ['expo_http_failed']");
    expect(resultSource).toContain("failures.push('expo_ticket_rejected')");
    expect(actionSource).toContain('getVerifiedAdminSession');
    expect(actionSource).toContain('sendPushNotificationToResident');
    expect(actionSource).not.toContain(".from('device_tokens')");
    expect(actionSource).not.toContain("fetch(EXPO_PUSH_URL");
    expect(adminFcRouteSource).toContain('sendPushNotificationToResident,');
    expect(adminFcRouteSource).toContain("from '@/lib/push-notification-service'");
    expect(adminFcRouteSource).not.toContain("import { sendPushNotification } from '@/app/actions'");
  });

  it('centralizes common admin route auth response handling', () => {
    const helperSource = readRepoFile('web/src/lib/admin-route-auth.ts');
    const listRouteSource = readRepoFile('web/src/app/api/admin/list/route.ts');
    const deleteRouteSource = readRepoFile('web/src/app/api/fc-delete/route.ts');

    expect(helperSource).toContain("import 'server-only'");
    expect(helperSource).toContain('requireAdminRoute');
    expect(helperSource).toContain('requireAdminOrManagerReadRoute');
    expect(helperSource).toContain('NextResponse.json');
    expect(listRouteSource).toContain('requireAdminOrManagerReadRoute');
    expect(deleteRouteSource).toContain('requireAdminRoute');
  });

  it('centralizes mobile push registration in the session lifecycle', () => {
    const sessionSource = readRepoFile('hooks/use-session.tsx');
    const indexSource = readRepoFile('app/index.tsx');

    expect(sessionSource).toContain(
      'registerPushToken(pushRole, state.residentId, state.displayName)',
    );
    expect(sessionSource).toContain('pushRegistrationPromiseRef.current');
    expect(sessionSource).toContain('requestBoardRole: state.requestBoardRole');
    expect(indexSource).not.toContain('registerPushToken(');
  });

  it('splits request-board bridge tokens from fc app session tokens', () => {
    const source = readRepoFile('supabase/functions/_shared/request-board-auth.ts');
    const webSource = readRepoFile('web/src/lib/request-board-app-session.ts');
    const appSecretSection = source.slice(
      source.indexOf('function getAppSessionSigningSecret()'),
      source.indexOf('function toBase64('),
    );

    expect(source).toContain('REQUEST_BOARD_BRIDGE_TOKEN_SECRET');
    expect(source).toContain('REQUEST_BOARD_BRIDGE_TOKEN_PREVIOUS_SECRET');
    expect(source).toContain('FC_APP_SESSION_TOKEN_SECRET');
    expect(source).toContain('FC_APP_SESSION_TOKEN_PREVIOUS_SECRET');
    expect(source).toContain('REQUEST_BOARD_AUTH_BRIDGE_SECRET');
    expect(appSecretSection).not.toContain('LEGACY_SHARED_BRIDGE_SECRET');
    expect(appSecretSection).not.toContain('REQUEST_BOARD_AUTH_BRIDGE_SECRET');
    expect(webSource).not.toContain('REQUEST_BOARD_AUTH_BRIDGE_SECRET');
    expect(source).toMatch(/payload\.kind !== 'request_board_bridge'/);
    expect(source).toMatch(/payload\.kind !== 'fc_onboarding_session'/);
  });
});

describe('actual atomic exam delete server action', () => {
  const roundId = '10000000-0000-4000-8000-000000000001';
  const trustedSession = { ok: true, session: { residentDigits: '01000000000', role: 'admin' } };

  function loadAction(session: unknown = trustedSession, rpcResult: unknown = { data: { deleted: true }, error: null }) {
    const source = readRepoFile('web/src/app/dashboard/exam/schedule/actions.ts');
    const file = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
    const action = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'deleteExamRoundAction');
    const readCode = file.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(file) === 'readErrorCode'));
    if (!action || !readCode) throw new Error('Missing actual atomic exam delete action');
    const rpc = jest.fn().mockResolvedValue(rpcResult);
    const from = jest.fn(() => { throw new Error('Direct table mutation is forbidden'); });
    const auth = jest.fn().mockResolvedValue(session);
    const parse = jest.fn(parseExamRoundDeleteInput);
    const dependencies = { adminSupabase: { rpc, from }, getVerifiedAdminSession: auth, parseExamRoundDeleteInput: parse, logger: { warn: jest.fn() } };
    const output = ts.transpileModule(`${readCode.getText(file)}\n${action.getText(file)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const exports: { deleteExamRoundAction?: (previous: unknown, input: unknown) => Promise<{ success: boolean }> } = {};
    new Function('exports', ...Object.keys(dependencies), output)(exports, ...Object.values(dependencies));
    if (!exports.deleteExamRoundAction) throw new Error('Actual action did not export');
    return { run: exports.deleteExamRoundAction, rpc, from, auth, parse };
  }

  it.each([401, 403])('rejects unverified or read-only actors before parsing or service-role IO (%s)', async (status) => {
    const action = loadAction({ ok: false, status, error: 'synthetic-denied' });
    expect(await action.run({}, { roundId })).toMatchObject({ success: false });
    expect(action.parse).not.toHaveBeenCalled();
    expect(action.rpc).not.toHaveBeenCalled();
    expect(action.from).not.toHaveBeenCalled();
  });

  it.each([null, {}, { roundId: 'invalid' }])('rejects invalid deletion input before service-role IO: %j', async (input) => {
    const action = loadAction();
    expect(await action.run({}, input)).toMatchObject({ success: false });
    expect(action.rpc).not.toHaveBeenCalled();
    expect(action.from).not.toHaveBeenCalled();
  });

  it('passes only the verified actor to one atomic RPC and confirms its deletion receipt', async () => {
    const action = loadAction();
    expect(await action.run({}, { roundId, role: 'developer', residentId: 'spoofed', p_actor_phone: 'spoofed' })).toMatchObject({ success: true });
    expect(action.rpc).toHaveBeenCalledTimes(1);
    expect(action.rpc).toHaveBeenCalledWith('delete_exam_round_atomic_v1', {
      p_actor_phone: trustedSession.session.residentDigits, p_actor_role: 'admin', p_round_id: roundId,
    });
    expect(action.from).not.toHaveBeenCalled();
    expect(action.auth.mock.invocationCallOrder[0]).toBeLessThan(action.rpc.mock.invocationCallOrder[0]);
  });

  it.each([
    { data: null, error: null },
    { data: {}, error: null },
    { data: { deleted: false }, error: null },
    { data: { deleted: 'true' }, error: null },
    { data: { deleted: true }, error: { code: 'PGRST202' } },
    { data: null, error: { code: '23503' } },
  ])('never reports success or falls back to split deletion without a confirmed RPC: %j', async (result) => {
    const action = loadAction(trustedSession, result);
    expect(await action.run({}, { roundId })).toMatchObject({ success: false });
    expect(action.rpc).toHaveBeenCalledTimes(1);
    expect(action.from).not.toHaveBeenCalled();
  });
});
