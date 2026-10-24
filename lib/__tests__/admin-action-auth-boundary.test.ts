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

  it.each(['deleteExamRound','updateDocReqs','deleteDocFile','removeOwnDocument','createNotice','getOwnDocumentCleanupStatus',
    'signOwnDocument','signFcDocument','prepareOwnDocumentUpload','submitOwnDocument'])(
    'rejects malformed %s receipts even when the HTTP result says ok', async action => {
      await expect(invokeAdminActionWithDeps('00000000002', action, {}, {
        getStoredAppSessionToken: async () => 'synthetic-signed-session',
        invoke: async () => ({data:{ok:true},error:null}),
      })).rejects.toThrow(/unverified/);
    },
  );

  it('requires the exact FC, actor, and persisted timestamp before confirming a Dawichok signal', async () => {
    const actorPhone = '01000000002';
    const fcId = 'fc-1';
    const invoke = jest.fn(async () => ({
      data: {
        ok: true,
        id: fcId,
        dawichok_url_sent_by: actorPhone,
        dawichok_url_sent_at: '2026-10-13T00:00:00.000Z',
      },
      error: null,
    }));

    await expect(invokeAdminActionWithDeps(actorPhone, 'markDawichokUrlSent', { fcId }, {
      getStoredAppSessionToken: async () => 'synthetic-signed-session',
      invoke,
    })).resolves.toMatchObject({ id: fcId });

    for (const data of [
      { ok: true, id: 'other', dawichok_url_sent_by: actorPhone, dawichok_url_sent_at: '2026-10-13T00:00:00.000Z' },
      { ok: true, id: fcId, dawichok_url_sent_by: '01099999999', dawichok_url_sent_at: '2026-10-13T00:00:00.000Z' },
      { ok: true, id: fcId, dawichok_url_sent_by: actorPhone, dawichok_url_sent_at: 'not-a-time' },
    ]) {
      await expect(invokeAdminActionWithDeps(actorPhone, 'markDawichokUrlSent', { fcId }, {
        getStoredAppSessionToken: async () => 'synthetic-signed-session',
        invoke: async () => ({ data, error: null }),
      })).rejects.toThrow(/unverified/);
    }

    expect(readRepoFile('app/dashboard.tsx')).not.toContain(
      'result.dawichok_url_sent_at ?? new Date().toISOString()',
    );
  });

  it('confirms an FC document submission only with the submitted row and that FC docs-pending or kept status', async () => {
    const payload = { docType: 'synthetic-doc', storagePath: 'fc-1/synthetic.pdf', fileName: 'synthetic.pdf' };
    const document = {
      fc_id: 'fc-1', doc_type: 'synthetic-doc', storage_path: 'fc-1/synthetic.pdf',
      file_name: 'synthetic.pdf', status: 'pending', reviewer_note: null,
    };
    const profile = { id: 'fc-1', status: 'docs-pending' };
    const submit = (data: Record<string, unknown>) => invokeAdminActionWithDeps('00000000002', 'submitOwnDocument', payload, {
      getStoredAppSessionToken: async () => 'synthetic-signed-session',
      invoke: async () => ({ data, error: null }),
    });

    await expect(submit({ ok: true, document, profile })).resolves.toMatchObject({ document, profile });
    // Members outside the documents stage keep their status.
    const kept = { id: 'fc-1', status: 'hanwha-commission-review' };
    await expect(submit({ ok: true, document, profile: kept })).resolves.toMatchObject({ document, profile: kept });
    for (const data of [
      { ok: true, document: { ...document, storage_path: 'fc-1/other.pdf' }, profile },
      { ok: true, document: { ...document, status: 'approved' }, profile },
      { ok: true, document, profile: { ...profile, id: 'fc-2' } },
      { ok: true, document, profile: { ...profile, status: 'docs-requested' } },
      { ok: true, document, profile: { ...profile, status: 'synthetic-unknown' } },
      { ok: true, document: { ...document, fc_id: undefined }, profile: { status: 'docs-pending' } },
    ]) {
      await expect(submit(data)).rejects.toThrow(/unverified/);
    }
  });
});
