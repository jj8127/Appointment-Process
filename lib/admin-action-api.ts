import { FC_DOCUMENT_STAGE_STATUSES, isFcStatus } from './fc-status';
import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';
import {
  requireCreationReceipt,
  requireDocumentReceipt,
  requireExamDeletionReceipt,
  requireMutationRowReceipt,
} from '../supabase/functions/_shared/ux-mutation-contract';

export class MissingAdminActionSessionError extends Error {
  readonly code = 'missing_app_session';

  constructor() {
    super('관리자 기능을 사용하려면 다시 로그인해주세요.');
    this.name = 'MissingAdminActionSessionError';
  }
}

type AdminActionInvokeResult = {
  data: Record<string, unknown> | null;
  error: unknown;
};

type AdminActionClientDeps = {
  getStoredAppSessionToken: () => Promise<string | null>;
  invoke: (
    functionName: string,
    options: { body: Record<string, unknown> },
  ) => Promise<AdminActionInvokeResult>;
};

export async function invokeAdminActionWithDeps<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  actorPhone: string,
  action: string,
  payload: Record<string, unknown>,
  deps: AdminActionClientDeps,
): Promise<{ ok: true } & T> {
  const appSessionToken = String(await deps.getStoredAppSessionToken() ?? '').trim();
  if (!appSessionToken) {
    throw new MissingAdminActionSessionError();
  }

  const { data, error } = await deps.invoke('admin-action', {
    body: {
      adminPhone: actorPhone,
      appSessionToken,
      action,
      payload,
    },
  });

  if (error) {
    throw new Error(error instanceof Error ? error.message : '관리자 기능 호출에 실패했습니다.');
  }
  if (data?.ok !== true) {
    throw new Error(
      typeof data?.message === 'string'
        ? data.message
        : '처리 중 오류가 발생했습니다.',
    );
  }
  if (action === 'updateDocReqs') requireDocumentReceipt(data, 'updated');
  if (action === 'deleteDocFile' || action === 'removeOwnDocument') requireDocumentReceipt(data, 'deleted');
  if (action === 'deleteExamRound') requireExamDeletionReceipt(data);
  if (action === 'createNotice') requireCreationReceipt(data.notice);
  if (action === 'markDawichokUrlSent') {
    requireMutationRowReceipt(data, {
      id: payload.fcId,
      dawichok_url_sent_by: actorPhone,
    });
    if (
      typeof data.dawichok_url_sent_at !== 'string'
      || !Number.isFinite(Date.parse(data.dawichok_url_sent_at))
    ) throw new Error('mutation_receipt_unverified');
  }
  if (['retryDocumentCleanup', 'retryOwnDocumentCleanup', 'getDocumentCleanupStatus', 'getOwnDocumentCleanupStatus'].includes(action)
    && typeof data.cleanupPending !== 'boolean') throw new Error('cleanup_state_unverified');
  if ((action === 'signOwnDocument' || action === 'signFcDocument')
    && (typeof data.signedUrl !== 'string' || !data.signedUrl)) throw new Error('signed_url_unverified');
  if (action === 'prepareOwnDocumentUpload') {
    const upload = data.upload as Record<string, unknown> | null | undefined;
    if (!upload || typeof upload !== 'object'
      || [upload.path, upload.token, upload.signedUrl].some((value) => typeof value !== 'string' || !value)) {
      throw new Error('signed_url_unverified');
    }
  }
  if (action === 'submitOwnDocument') {
    const document = requireMutationRowReceipt(data.document, {
      doc_type: payload.docType,
      storage_path: payload.storagePath,
      file_name: payload.fileName,
      status: 'pending',
      reviewer_note: null,
    });
    if (typeof document.fc_id !== 'string' || !document.fc_id) throw new Error('mutation_receipt_unverified');
    // A documents-stage profile must now be docs-pending; earlier and later stages keep their status.
    const { status } = requireMutationRowReceipt(data.profile, { id: document.fc_id });
    if (!isFcStatus(status) || (status !== 'docs-pending' && FC_DOCUMENT_STAGE_STATUSES.includes(status))) {
      throw new Error('mutation_receipt_unverified');
    }
  }

  return data as { ok: true } & T;
}

export async function invokeAdminAction<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  actorPhone: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } & T> {
  return invokeAdminActionWithDeps<T>(actorPhone, action, payload, {
    getStoredAppSessionToken,
    invoke: (functionName, options) => supabase.functions.invoke(functionName, options),
  });
}

export async function invokeAdminActionRaw(
  actorPhone: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<AdminActionInvokeResult> {
  const appSessionToken = String(await getStoredAppSessionToken() ?? '').trim();
  if (!appSessionToken) {
    throw new MissingAdminActionSessionError();
  }
  return supabase.functions.invoke<Record<string, unknown>>('admin-action', {
    body: {
      adminPhone: actorPhone,
      appSessionToken,
      action,
      payload,
    },
  });
}
