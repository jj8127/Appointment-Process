/* global describe, it, expect */
const { readFileSync } = require('node:fs');

const read = (path) => readFileSync(path, 'utf8');

describe('login session read contract', () => {
  it('requires a complete role-specific success response before storing a mobile session', () => {
    const source = read('hooks/use-login.ts');

    expect(source).toContain('parseLoginSuccessResponse(data, expectedResidentId)');
    expect(source).toContain('acceptLoginResponse(data, digits)');
    expect(source).not.toContain("data?.role === 'admin' ? 'admin' : data?.role === 'manager' ? 'manager' : 'fc'");
    expect(source).not.toContain('data?.residentId ?? digits');
    expect(source).not.toContain('data?.appSessionToken ?? null');
  });

  it('does not report Edge login success without a usable app session receipt', () => {
    const source = read('supabase/functions/login-with-password/index.ts');

    expect(source).toContain('sessionUnavailable(origin)');
    expect(source).toContain('if (!appSessionToken?.trim() || !displayName)');
    expect(source).not.toContain('...(appSessionToken ? { appSessionToken } : {})');
  });
});
