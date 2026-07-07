import 'server-only';

import { NextResponse } from 'next/server';

import { getVerifiedAdminSession, getVerifiedReadOnlyAdminSession } from '@/lib/server-session';

type AdminRouteAuthCheck = Awaited<ReturnType<typeof getVerifiedAdminSession>>;

export const requireAdminRoute = () => getVerifiedAdminSession();

export const requireAdminOrManagerReadRoute = () => getVerifiedReadOnlyAdminSession();

export function adminRouteAuthErrorResponse(check: Extract<AdminRouteAuthCheck, { ok: false }>) {
  return NextResponse.json({ error: check.error }, { status: check.status });
}
