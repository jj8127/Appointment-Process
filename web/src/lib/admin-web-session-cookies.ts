import type { NextResponse } from 'next/server';

type LoginSession = {
  role: 'admin' | 'manager' | 'fc';
  residentId: string;
  displayName?: string;
  staffType?: string | null;
};

// UI hints travel in the same response as the signed HttpOnly session.
// They never replace signature verification at the server boundary.
export function setAdminWebSessionCookies(response: NextResponse, session: LoginSession | null) {
  const values = {
    session_role: session?.role ?? '',
    session_resident: session?.residentId ?? '',
    session_display: session?.displayName ?? '',
    session_staff_type: session?.staffType ?? '',
  };
  for (const [name, value] of Object.entries(values)) {
    response.cookies.set(name, value, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: session ? 60 * 60 * 8 : 0,
    });
  }
}
