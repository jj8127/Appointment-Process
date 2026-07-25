import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  NOTIFICATION_OPEN_COOKIE,
  verifyNotificationOpenToken,
} from '@/lib/notification-open-token';
import { getVerifiedServerSession } from '@/lib/server-session';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager', 'fc'],
    requireActive: true,
  });
  const cookieStore = await cookies();
  const resume = verifyNotificationOpenToken({
    token: cookieStore.get(NOTIFICATION_OPEN_COOKIE)?.value,
  });

  const destination = session.ok && resume
    ? `/dashboard/notification-open/${encodeURIComponent(resume.notificationId)}`
    : '/auth';
  const response = NextResponse.redirect(new URL(destination, url.origin));
  response.cookies.set(NOTIFICATION_OPEN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
