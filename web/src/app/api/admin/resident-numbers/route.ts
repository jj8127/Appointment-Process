import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import {
  canReadResidentNumbersForStaffSession,
  handleResidentNumberRoutePost,
} from '@/lib/resident-number-route-handler';
import { normalizeResidentNumberRouteFcIds } from '@/lib/resident-number-route-request';
import { readResidentNumbersWithFallbackDetailed } from '@/lib/server-resident-numbers';
import { getVerifiedServerSession, type VerifiedServerSession } from '@/lib/server-session';
import { recordAdminAuditEvent } from '@/lib/admin-audit-server';
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
  let viewer: VerifiedServerSession | null = null;
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
      viewer = sessionCheck.session;
      return sessionCheck;
    },
    checkRateLimit,
    readJson: async () => req.json(),
    normalizeFcIds: normalizeResidentNumberRouteFcIds,
    readResidentNumbers: ({ fcIds, staffPhone, logPrefix }) =>
      readResidentNumbersWithFallbackDetailed({ fcIds, staffPhone, logPrefix }),
    logInvalidJson: () => {
      logger.warn('[api/admin/resident-numbers] invalid json');
    },
    logReadFailure: () => {
      logger.error('[api/admin/resident-numbers] failed');
    },
    recordView: async (fcIds) => {
      if (!viewer) return false;
      return recordAdminAuditEvent(
        { role: viewer.role === 'manager' ? 'manager' : 'admin', staffType: viewer.staffType, residentDigits: viewer.residentDigits },
        {
          category: 'personal_info_view',
          action: 'resident_number_view',
          targetFcId: fcIds.length === 1 ? fcIds[0] : null,
          targetCount: fcIds.length,
          detail: { source: 'dashboard', fcIds },
        },
      );
    },
  });

  return NextResponse.json(response.body, {
    status: response.status,
    headers: RESIDENT_NUMBER_RESPONSE_HEADERS,
  });
}
