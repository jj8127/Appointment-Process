import { NextResponse } from 'next/server';

import {
  createNotificationOpenToken,
  NOTIFICATION_OPEN_COOKIE,
  NOTIFICATION_OPEN_MAX_AGE_SECONDS,
} from '@/lib/notification-open-token';
import { getVerifiedServerSession } from '@/lib/server-session';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const notificationId = String(url.searchParams.get('notificationId') ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(notificationId)) {
    return NextResponse.redirect(new URL('/auth', url.origin));
  }

  const session = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager', 'fc'],
    requireActive: true,
  });
  if (session.ok) {
    return NextResponse.redirect(
      new URL(`/dashboard/notification-open/${encodeURIComponent(notificationId)}`, url.origin),
    );
  }

  const response = NextResponse.redirect(new URL('/auth?notificationOpen=1', url.origin));
  response.cookies.set(
    NOTIFICATION_OPEN_COOKIE,
    createNotificationOpenToken({ notificationId }),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: NOTIFICATION_OPEN_MAX_AGE_SECONDS,
    },
  );
  return response;
}
