import assert from 'node:assert/strict';
import test from 'node:test';
import { NextResponse } from 'next/server.js';
import { setAdminWebSessionCookies } from './admin-web-session-cookies.ts';

test('server login hints round-trip Korean display text through browser cookie decoding', () => {
  const response = NextResponse.json({ ok: true });
  setAdminWebSessionCookies(response, { role: 'admin', residentId: '01000000001', displayName: '가상 계정', staffType: 'developer' });
  const displayCookie = response.headers.getSetCookie().find(c => c.startsWith('session_display='));
  assert.ok(displayCookie);
  const value = displayCookie.split(';')[0].slice('session_display='.length);
  assert.equal(decodeURIComponent(value), '가상 계정');
  assert.ok(response.headers.getSetCookie().every(c => c.includes('SameSite=strict') && c.includes('Path=/')));
});

test('logout expires every browser session hint', () => {
  const response = NextResponse.json({ ok: true });
  setAdminWebSessionCookies(response, null);
  assert.equal(response.headers.getSetCookie().length, 4);
  assert.ok(response.headers.getSetCookie().every(c => c.includes('Max-Age=0')));
});
