import { NextResponse } from 'next/server';

import { getAgentRoomSnapshot } from '@/lib/agent-room-server';
import { serverError } from '@/lib/api-error';
import { getVerifiedServerSession } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' };

export const runtime = 'nodejs';

export async function GET() {
  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
  });

  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error, ok: false },
      {
        headers: RESPONSE_HEADERS,
        status: sessionCheck.status,
      },
    );
  }

  // Developer tooling: staff and managers have no business need for agent runtime state.
  if (sessionCheck.session.staffType !== 'developer') {
    return NextResponse.json(
      { error: '개발자 계정만 조회할 수 있습니다.', ok: false },
      { headers: RESPONSE_HEADERS, status: 403 },
    );
  }

  try {
    const snapshot = await getAgentRoomSnapshot();
    return NextResponse.json(snapshot, {
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    return serverError(error, 'api/agent-room', RESPONSE_HEADERS);
  }
}
