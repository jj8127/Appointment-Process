import { NextResponse } from 'next/server';

import { FC_GRAPH_SESSION_COOKIE } from '@/lib/fc-graph-session';
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session';
import { WEB_APP_SESSION_COOKIE } from '@/lib/request-board-app-session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(FC_GRAPH_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(STAFF_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(WEB_APP_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
