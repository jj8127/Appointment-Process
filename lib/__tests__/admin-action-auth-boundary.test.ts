import fs from 'fs';
import path from 'path';

import {
  invokeAdminActionWithDeps,
  MissingAdminActionSessionError,
} from '../admin-action-api';

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

describe('admin-action privileged authentication boundary', () => {
  it('fails before network I/O when the signed app session is unavailable', async () => {
    const invoke = jest.fn();

    await expect(invokeAdminActionWithDeps(
      '01000000000',
      'updateProfile',
      { fcId: 'fc-id', data: {} },
      {
        getStoredAppSessionToken: async () => null,
        invoke,
      },
    )).rejects.toMatchObject({
      name: 'MissingAdminActionSessionError',
      code: 'missing_app_session',
    } satisfies Partial<MissingAdminActionSessionError>);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('attaches the stored signed session to every mobile admin-action request', async () => {
    const invoke = jest.fn(async () => ({
      data: { ok: true, updated: true },
      error: null,
    }));

    const result = await invokeAdminActionWithDeps(
      '01000000000',
      'updateProfile',
      { fcId: 'fc-id', data: {} },
      {
        getStoredAppSessionToken: async () => '  signed-app-session  ',
        invoke,
      },
    );

    expect(result).toMatchObject({ ok: true, updated: true });
    expect(invoke).toHaveBeenCalledWith('admin-action', {
      body: {
        adminPhone: '01000000000',
        appSessionToken: 'signed-app-session',
        action: 'updateProfile',
        payload: { fcId: 'fc-id', data: {} },
      },
    });
  });

  it('requires a signed session for every non-service action and binds authority to it', () => {
    const edgeSource = readRepoFile('supabase/functions/admin-action/index.ts');
    const dashboardSource = readRepoFile('app/dashboard.tsx');
    const lifeExamSource = readRepoFile('app/exam-register.tsx');
    const nonlifeExamSource = readRepoFile('app/exam-register2.tsx');
    const examAdminApiSource = readRepoFile('lib/exam-admin-api.ts');

    expect(edgeSource).toContain('const isServiceCaller = authHeader === `Bearer ${serviceKey}`;');
    expect(edgeSource).not.toContain('authHeader === serviceKey');
    expect(edgeSource).toContain('if (!isServiceCaller) {');
    expect(edgeSource).toContain('parseAppSessionTokenDetailed(appSessionToken.trim())');
    expect(edgeSource).toContain("trustedRole = parsedSession.payload.role");
    expect(edgeSource).toContain('trustedPhone !== normalizedBodyPhone');
    expect(edgeSource).toContain("trustedRole === 'admin'");
    expect(edgeSource).toContain('await verifyAdmin(trustedPhone, trustedStaffType)');
    expect(edgeSource).toContain("trustedRole === 'manager'");
    expect(edgeSource).toContain('allowManagerRead');

    expect(dashboardSource).not.toContain("supabase.functions.invoke('admin-action'");
    expect(dashboardSource).not.toMatch(/\badminAction\(/);
    expect(dashboardSource).toContain('invokeAdminAction(');
    for (const mutationCaller of [lifeExamSource, nonlifeExamSource, examAdminApiSource]) {
      expect(mutationCaller).not.toContain("functions.invoke('admin-action'");
      expect(mutationCaller).toContain('invokeAdminAction');
    }
  });
});
