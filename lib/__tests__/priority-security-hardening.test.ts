import fs from 'fs';
import path from 'path';

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
    expect(dashboardSource).toContain('invokeFcNotify({');
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

  it('binds web push subscriptions to a verified server session instead of request body identity', () => {
    const source = readRepoFile('web/src/app/api/web-push/subscribe/route.ts');

    expect(source).toContain('getVerifiedReadOnlyAdminSession');
    expect(source).not.toContain('payload.residentId');
    expect(source).not.toContain('payload.role');
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
    expect(deleteBody).toContain(".from('exam_rounds')");
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
    const adminFcRouteSource = readRepoFile('web/src/app/api/admin/fc/route.ts');

    expect(serviceSource).toContain("import 'server-only'");
    expect(serviceSource).toContain(".from('device_tokens')");
    expect(serviceSource).toContain(".from('web_push_subscriptions')");
    expect(serviceSource).not.toContain("{ userId, title, body }");
    expect(serviceSource).not.toContain('tokens: tokens?.map');
    expect(serviceSource).not.toContain('const respBody = await resp.text()');
    expect(serviceSource).not.toContain('body: respBody');
    expect(serviceSource).not.toContain('Expo push notification failed: ${respBody}');
    expect(serviceSource).not.toContain("logger.error('[push-notification-service] Push notification error:', error)");
    expect(serviceSource).toContain("category: 'expo_push'");
    expect(serviceSource).toContain("reason: 'provider_rejected'");
    expect(serviceSource).toContain("return { success: false, error: 'Expo push notification failed' }");
    expect(actionSource).toContain('getVerifiedAdminSession');
    expect(actionSource).toContain('sendPushNotificationToResident');
    expect(actionSource).not.toContain(".from('device_tokens')");
    expect(actionSource).not.toContain("fetch(EXPO_PUSH_URL");
    expect(adminFcRouteSource).toContain("import { sendPushNotificationToResident } from '@/lib/push-notification-service'");
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

  it('reuses the Expo push token already fetched by the mobile dashboard registration effect', () => {
    const notificationsSource = readRepoFile('lib/notifications.ts');
    const indexSource = readRepoFile('app/index.tsx');

    expect(notificationsSource).toContain('providedExpoPushToken');
    expect(indexSource).toContain('registerPushToken(pushRole, residentId, displayName, token)');
    expect(indexSource).toMatch(/\[hydrated, role, residentId, requestBoardRole, displayName\]/);
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
