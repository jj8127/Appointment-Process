import { logger } from '@/lib/logger';
import { QueryReadError } from '@/lib/query-read-error';
import { collectPresenceSnapshotBatches } from '@shared/lib/presence-read-response.ts';

import type { WebPresenceSnapshot } from './presence';

type PresenceResponse = {
  ok?: boolean;
  data?: WebPresenceSnapshot[] | null;
};

export async function fetchPresence(
  phones: Array<string | null | undefined>,
): Promise<WebPresenceSnapshot[]> {
  try {
    return await collectPresenceSnapshotBatches(phones, async (phoneBatch) => {
      let response: Response;
      try {
        response = await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ phones: phoneBatch }),
        });
      } catch (error) {
        logger.warn('[web-presence] request error', error);
        throw new QueryReadError();
      }

      const payload = (await response.json().catch(() => null)) as PresenceResponse | null;
      if (!response.ok) {
        logger.warn('[web-presence] fetch failed', {
          status: response.status,
        });
        throw new QueryReadError(response.status);
      }
      if (payload?.ok !== true || !Array.isArray(payload.data)) {
        logger.warn('[web-presence] invalid response', { status: response.status });
        throw new QueryReadError();
      }

      return payload.data;
    });
  } catch (error) {
    if (error instanceof QueryReadError) throw error;
    logger.warn('[web-presence] invalid response', error);
    throw new QueryReadError();
  }
}
