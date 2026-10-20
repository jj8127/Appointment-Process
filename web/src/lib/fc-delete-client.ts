import { logger } from '@/lib/logger';
import { requireMutationSuccess } from '@/lib/user-intent-policy';

/** Deletes one FC through /api/fc-delete and returns the confirmed response, or throws a user-facing message. */
export async function requestFcDelete(fcId: string) {
  logger.debug('[Web][deleteFc] start', { requestCount: 1 });
  const resp = await fetch('/api/fc-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcId }),
  });

  const data = await resp.json().catch(() => null);
  logger.debug('[Web][deleteFc] response', { status: resp.status, ok: resp.ok });

  if (!resp.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: string }).error || '')
        : '';
    throw new Error(message || '삭제 실패');
  }

  if (!data || typeof data !== 'object') {
    logger.error('[Web][deleteFc] invalid response', { status: resp.status, errorCode: 'invalid_response' });
    throw new Error('서버 응답이 올바르지 않습니다.');
  }

  if (data.ok !== true || data.deleted !== true) {
    logger.warn('[Web][deleteFc] delete returned false', { status: resp.status, errorCode: 'delete_not_confirmed' });
    throw new Error(typeof data.message === 'string' ? data.message : 'FC 정보를 삭제할 수 없습니다.');
  }

  logger.info('[Web][deleteFc] success', { status: resp.status, deletedCount: 1 });
  requireMutationSuccess(data);
  return data;
}

export const FC_DELETE_CLEANUP_WARNING = 'FC 삭제는 완료됐습니다. 일부 파일 정리가 남아 있습니다. 삭제 요청을 반복하지 마세요.';
