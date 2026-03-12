import { logger } from '@/lib/logger';

import type { WebPresenceSnapshot } from './presence';

type PresenceResponse = {
  ok?: boolean;
  message?: string;
  data?: WebPresenceSnapshot[] | null;
};

export async function fetchPresence(
  phones: Array<string | null | undefined>,
): Promise<WebPresenceSnapshot[]> {
  const normalizedPhones = Array.from(
    new Set(
      phones
        .map((phone) => String(phone ?? '').replace(/[^0-9]/g, ''))
        .filter((phone) => phone.length === 11),
    ),
  ).slice(0, 100);

  if (normalizedPhones.length === 0) {
    return [];
  }

  try {
    const response = await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ phones: normalizedPhones }),
    });

    const payload = (await response.json().catch(() => null)) as PresenceResponse | null;
    if (!response.ok || !payload?.ok) {
      logger.warn('[web-presence] fetch failed', {
        status: response.status,
        message: payload?.message,
      });
      return [];
    }

    return payload.data ?? [];
  } catch (error) {
    logger.warn('[web-presence] request error', error);
    return [];
  }
}
