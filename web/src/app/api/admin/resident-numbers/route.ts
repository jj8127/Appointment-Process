import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import {
  canReadResidentNumbersForStaffSession,
  handleResidentNumberRoutePost,
} from '@/lib/resident-number-route-handler';
import { normalizeResidentNumberRouteFcIds } from '@/lib/resident-number-route-request';
import { readResidentNumbersWithFallback } from '@/lib/server-resident-numbers';
import { getVerifiedServerSession } from '@/lib/server-session';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RESIDENT_NUMBER_RESPONSE_HEADERS = {
  ...SECURITY_HEADERS,
  'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
  Expires: '0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
};

export async function POST(req: Request) {
  const response = await handleResidentNumberRoutePost({
    getSession: async () => {
      const sessionCheck = await getVerifiedServerSession({
        allowedRoles: ['admin', 'manager'],
        requireActive: true,
      });
      if (!sessionCheck.ok) return sessionCheck;
      if (!canReadResidentNumbersForStaffSession(sessionCheck.session)) {
        return { ok: false, status: 403, error: 'Forbidden' };
      }
      return sessionCheck;
    },
    checkRateLimit,
    readJson: async () => req.json(),
    normalizeFcIds: normalizeResidentNumberRouteFcIds,
    readResidentNumbers: ({ fcIds, staffPhone, logPrefix }) =>
      readResidentNumbersWithFallback({ fcIds, staffPhone, logPrefix }),
    logInvalidJson: () => {
      logger.warn('[api/admin/resident-numbers] invalid json');
    },
    logReadFailure: () => {
      logger.error('[api/admin/resident-numbers] failed');
    },
  });

  return NextResponse.json(response.body, {
    status: response.status,
    headers: RESIDENT_NUMBER_RESPONSE_HEADERS,
  });
}
