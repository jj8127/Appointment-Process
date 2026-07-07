import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAdminWebPublicPath } from './admin-web-public-paths.ts';

describe('isAdminWebPublicPath', () => {
  it('keeps password reset accessible without an admin session', () => {
    assert.equal(isAdminWebPublicPath('/reset-password'), true);
    assert.equal(isAdminWebPublicPath('/reset-password/confirm'), true);
  });

  it('preserves the existing public admin web paths', () => {
    assert.equal(isAdminWebPublicPath('/auth'), true);
    assert.equal(isAdminWebPublicPath('/auth/callback'), true);
    assert.equal(isAdminWebPublicPath('/invite'), true);
    assert.equal(isAdminWebPublicPath('/invite/abc'), true);
    assert.equal(isAdminWebPublicPath('/favicon.ico'), true);
    assert.equal(isAdminWebPublicPath('/manifest.json'), true);
  });

  it('keeps dashboard and admin operation routes protected', () => {
    assert.equal(isAdminWebPublicPath('/dashboard'), false);
    assert.equal(isAdminWebPublicPath('/dashboard/profile/1'), false);
    assert.equal(isAdminWebPublicPath('/admin'), false);
    assert.equal(isAdminWebPublicPath('/admin/exams/new'), false);
  });
});
