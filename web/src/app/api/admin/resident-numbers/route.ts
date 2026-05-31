import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { handleResidentNumberRoutePost } from '@/lib/resident-number-route-handler';
import { normalizeResidentNumberRouteFcIds } from '@/lib/resident-number-route-request';
import { readResidentNumbersWithFallback } from '@/lib/server-resident-numbers';
import { getVerifiedServerSession } from '@/lib/server-session';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const response = await handleResidentNumberRoutePost({
    getSession: () => getVerifiedServerSession({
      allowedRoles: ['admin', 'manager'],
      requireActive: true,
    }),
    checkRateLimit,
    readJson: async () => req.json(),
    normalizeFcIds: normalizeResidentNumberRouteFcIds,
    readResidentNumbers: readResidentNumbersWithFallback,
    logInvalidJson: (error) => {
      logger.error('[api/admin/resident-numbers] invalid json', error);
    },
    logReadFailure: (error) => {
      logger.error('[api/admin/resident-numbers] failed', error);
    },
  });

  return NextResponse.json(response.body, {
    status: response.status,
    headers: SECURITY_HEADERS,
  });
}
