import { NextResponse } from 'next/server';

import { getReferralGraphData } from '@/lib/admin-referrals';
import { logger } from '@/lib/logger';
import { getVerifiedServerSession } from '@/lib/server-session';

export async function GET() {
  const sessionCheck = await getVerifiedServerSession({ allowedRoles: ['admin', 'manager'], requireActive: true });
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  try {
    const data = await getReferralGraphData(sessionCheck.session);
    return NextResponse.json(data);
  } catch (error) {
    logger.error('[api/admin/referrals/graph] GET failed', error);
    return NextResponse.json({ error: '추천인 그래프 조회에 실패했습니다.' }, { status: 500 });
  }
}
