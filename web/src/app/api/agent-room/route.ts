import { NextResponse } from 'next/server';

import { getAgentRoomSnapshot } from '@/lib/agent-room-server';
import { getVerifiedServerSession } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function GET() {
  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
  });

  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error, ok: false },
      {
        headers: { 'Cache-Control': 'no-store' },
        status: sessionCheck.status,
      },
    );
  }

  try {
    const snapshot = await getAgentRoomSnapshot();
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Agent room snapshot failed.',
        ok: false,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
        status: 500,
      },
    );
  }
}
