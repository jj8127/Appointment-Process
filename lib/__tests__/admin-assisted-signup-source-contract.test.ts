import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('administrator-assisted signup trusted boundaries', () => {
  it('derives administrator authority from the signed web session', () => {
    const route = read('web/src/app/api/admin/assisted-signup/route.ts');
    const server = read('web/src/lib/admin-assisted-signup-server.ts');
    expect(route).toContain('requireAdminRoute()');
    expect(route).toContain('hasAssistedSignupPermission(sessionCheck.session)');
    expect(route).toContain('await verifyOrigin()');
    expect(route).toContain('checkRateLimit(');
    expect(server).toContain("session.role !== 'admin'");
    expect(server).toContain("session.staffType !== 'admin'");
    expect(server).toContain("session.staffType !== 'developer'");
    expect(server).toContain('p_actor_phone: session.residentDigits');
    expect(server).not.toContain('input.actor');
  });

  it('never sends a normal session when a temporary password is accepted', () => {
    const login = read('supabase/functions/login-with-password/index.ts');
    const start = login.indexOf('if (creds.must_change_password === true)');
    const end = login.indexOf('const designerCompanyName', start);
    const temporaryBranch = login.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(temporaryBranch).toContain("'password_change_required'");
    expect(temporaryBranch).toContain('passwordChangeToken: challenge.token');
    expect(temporaryBranch).not.toContain('createAppSessionToken');
    expect(temporaryBranch).not.toContain('createRequestBoardBridgeToken');
    expect(temporaryBranch).not.toContain('syncRequestBoardPassword');
  });

  it('keeps ordinary OTP signup classified separately from written consent', () => {
    const verifyOtp = read('supabase/functions/verify-signup-otp/index.ts');
    const setPassword = read('supabase/functions/set-password/index.ts');
    expect(verifyOtp).toContain("signup_verification_method: 'phone_otp'");
    expect(setPassword).toContain("signup_verification_method: 'phone_otp'");
    expect(setPassword).not.toContain("signup_verification_method: 'admin_written_consent'");
  });

  it('keeps the web password-change token in an HttpOnly cookie', () => {
    const loginRoute = read('web/src/app/api/auth/login/route.ts');
    const completionRoute = read('web/src/app/api/auth/complete-assisted-password/route.ts');
    expect(loginRoute).toContain('ASSISTED_PASSWORD_CHANGE_COOKIE');
    expect(loginRoute).toContain('httpOnly: true');
    expect(loginRoute).toContain('const rawPasswordChangeToken = loginData.passwordChangeToken');
    expect(loginRoute).toContain('delete publicLoginData.passwordChangeToken');
    expect(completionRoute).toContain("cookieStore.get(ASSISTED_PASSWORD_CHANGE_COOKIE)");
    expect(completionRoute).toContain("'complete-assisted-password'");
  });

  it('uses an in-memory-only mobile challenge handoff', () => {
    const pending = read('lib/pending-assisted-password-change.ts');
    expect(pending).toContain('let pendingChallenge');
    expect(pending).not.toContain('safeStorage');
    expect(pending).not.toContain('SecureStore');
    expect(pending).not.toContain('localStorage');
  });

  it('keeps the administrator-web validation contract inside the deployed web root', () => {
    const contract = read('web/src/lib/admin-assisted-signup-contract.ts');
    const validation = read('web/src/lib/admin-assisted-signup-validation.ts');
    const profileOptions = read('web/src/lib/signup-profile-options.ts');

    expect(contract).toContain("export * from './admin-assisted-signup-validation'");
    expect(contract).not.toContain('@shared');
    expect(validation).toContain("from './signup-profile-options'");
    expect(validation).not.toContain('@shared');
    expect(profileOptions).toContain('SIGNUP_AFFILIATION_OPTIONS');
    expect(profileOptions).toContain('SIGNUP_CARRIER_OPTIONS');
  });
});
