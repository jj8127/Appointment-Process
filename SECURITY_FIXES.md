# Security Fixes Applied

This document outlines the security improvements made to the FC Onboarding App.

## Summary

**Date**: 2026-01-09
**Fixes Applied**: 4 critical security vulnerabilities
**Files Modified**: 16 files

---

## 1. CORS Policy Hardening ✅ COMPLETED

### Issue
All Edge Functions allowed requests from any origin (`Access-Control-Allow-Origin: *`), making the API vulnerable to CSRF attacks.

### Fix Applied
- **Files Modified**: All 11 Edge Functions in `supabase/functions/`
  - `login-with-password/index.ts`
  - `request-signup-otp/index.ts`
  - `verify-signup-otp/index.ts`
  - `store-identity/index.ts`
  - `set-password/index.ts`
  - `reset-password/index.ts`
  - `request-password-reset/index.ts`
  - `delete-account/index.ts`
  - `set-admin-password/index.ts`
  - `fc-notify/index.ts`
  - `docs-deadline-reminder/index.ts`

### Changes
```typescript
// Before
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// After
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};
```

### Configuration Required
Set the `ALLOWED_ORIGINS` environment variable in Supabase:
```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

---

## 2. OTP Code Exposure Removed ✅ COMPLETED

### Issue
In test mode, the `request-signup-otp` function returned the actual OTP code in the API response, which could be exploited if test mode accidentally leaked to production.

### Fix Applied
- **File Modified**: `supabase/functions/request-signup-otp/index.ts:228-231`

### Changes
```typescript
// Before
if (testSmsMode) {
  return json({ ok: true, sent: true, test_mode: true, test_code: code });
}

// After
if (testSmsMode) {
  // Security: Never expose OTP code in response, even in test mode
  // Log server-side only for debugging
  console.log('[TEST MODE] OTP code for', phone, ':', code);
  return json({ ok: true, sent: true, test_mode: true });
}
```

### Impact
- OTP codes are now only logged server-side in test mode
- API response no longer exposes sensitive authentication codes

---

## 3. Web Session Storage Hardened ✅ COMPLETED

### Issue
Session data (role, residentId, displayName) was stored in plain text in localStorage and cookies lacked security flags.

### Fix Applied
- **File Modified**: `web/src/hooks/use-session.tsx`

### Changes Made

#### A. Added Cookie Security Flags
```typescript
// Security: Cookie configuration with security flags
const getCookieString = (name: string, value: string, maxAge: number = COOKIE_MAX_AGE) => {
    const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureFlag = isSecure ? 'Secure;' : '';
    // Note: HttpOnly cannot be set via document.cookie (requires server-side Set-Cookie header)
    return `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Strict; ${secureFlag}`;
};
```

**Flags Added:**
- `Secure`: Cookies only sent over HTTPS (in production)
- `SameSite=Strict`: Prevents CSRF attacks
- **Note**: `HttpOnly` flag requires server-side implementation (TODO for future)

#### B. Added localStorage Obfuscation
```typescript
// Security: Simple obfuscation for localStorage
const obfuscate = (text: string): string => {
    if (typeof window === 'undefined') return text;
    return btoa(encodeURIComponent(text));
};

const deobfuscate = (encoded: string): string => {
    if (typeof window === 'undefined') return encoded;
    try {
        return decodeURIComponent(atob(encoded));
    } catch {
        return '';
    }
};
```

**Note**: This is basic obfuscation (not cryptographically secure). For production, consider:
- Server-side session tokens with HttpOnly cookies
- Web Crypto API for client-side encryption
- JWT tokens stored in httpOnly cookies only

---

## 4. Environment Variable Validation ✅ COMPLETED

### Issue
Edge Functions silently continued with empty strings when critical environment variables were missing, leading to runtime failures.

### Fix Applied
- **Files Modified**: All 11 Edge Functions

### Changes
```typescript
// Before
const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// After
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}
```

### Additional Validations
- **store-identity**: Validates encryption key length (>= 32 chars)
- **request-signup-otp**: Validates NCP SMS credentials (unless test mode)
- **set-admin-password**: Validates admin secret presence

### Impact
- Functions now fail fast with clear error messages
- Prevents silent failures in production
- Easier debugging during deployment

---

## Required Environment Variables

After these fixes, ensure the following environment variables are set in Supabase:

### Required for All Functions
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

### For Identity Encryption (store-identity)
```bash
FC_IDENTITY_KEY=your-32-character-or-longer-encryption-key
FC_IDENTITY_HASH_SALT=your-16-character-or-longer-salt
```

### For SMS Functions (request-signup-otp, request-password-reset)
```bash
NCP_SENS_ACCESS_KEY=your-ncp-access-key
NCP_SENS_SECRET_KEY=your-ncp-secret-key
NCP_SENS_SERVICE_ID=your-ncp-service-id
NCP_SENS_SMS_FROM=your-sender-phone-number
# Optional: For development/testing
TEST_SMS_MODE=true
TEST_SMS_CODE=123456
```

### For Admin Functions (set-admin-password)
```bash
ADMIN_CONFIG_SECRET=your-admin-secret
```

---

## Testing Checklist

Before deploying to production:

- [ ] Set all required environment variables in Supabase dashboard
- [ ] Test login flow with new CORS restrictions
- [ ] Verify OTP codes are not exposed in API responses
- [ ] Confirm cookies have Secure flag on HTTPS
- [ ] Test session persistence with obfuscated localStorage
- [ ] Verify Edge Functions fail with clear errors when env vars missing
- [ ] Test from allowed origins only (should work)
- [ ] Test from disallowed origins (should be blocked by CORS)

---

## Future Improvements (Recommended)

### High Priority
1. **Server-Side Sessions**: Replace client-side session storage with server-side session tokens
   - Implement JWT tokens in httpOnly cookies
   - Store sensitive data server-side only
   - Add session expiration and rotation

2. **Input Validation**: Add comprehensive input validation to all Edge Functions
   - Consider Zod or similar validation library
   - Validate request body schemas
   - Add rate limiting per IP/user

3. **Rate Limiting**: Implement rate limiting on sensitive endpoints
   - Login: 5 attempts per 15 minutes
   - OTP request: 3 attempts per hour
   - Password reset: 3 attempts per 24 hours

### Medium Priority
4. **Password Policy Enforcement**: Strengthen password requirements
5. **2FA/MFA**: Add multi-factor authentication option
6. **Audit Logging**: Log all authentication events for security monitoring
7. **HTTPS Redirect**: Ensure all traffic uses HTTPS in production

### Low Priority
8. **Security Headers**: Add additional security headers (CSP, X-Frame-Options, etc.)
9. **Dependency Scanning**: Regular security audits of dependencies
10. **Penetration Testing**: Professional security audit before production

---

## Deployment Instructions

1. **Backup Current Configuration**
   ```bash
   # Backup current Supabase functions
   supabase functions list > backup_functions.txt
   ```

2. **Set Environment Variables**
   - Navigate to Supabase Dashboard → Settings → Edge Functions
   - Add all required environment variables listed above

3. **Deploy Updated Functions**
   ```bash
   # Deploy all functions
   supabase functions deploy login-with-password
   supabase functions deploy request-signup-otp
   supabase functions deploy verify-signup-otp
   supabase functions deploy store-identity
   supabase functions deploy set-password
   supabase functions deploy reset-password
   supabase functions deploy request-password-reset
   supabase functions deploy delete-account
   supabase functions deploy set-admin-password
   supabase functions deploy fc-notify
   supabase functions deploy docs-deadline-reminder
   ```

4. **Deploy Web Application**
   ```bash
   cd web
   npm run build
   vercel deploy --prod
   ```

5. **Verify Deployment**
   - Test login flow
   - Check browser console for CORS errors
   - Verify cookies have security flags (use DevTools → Application → Cookies)
   - Test OTP flow (ensure codes not in response)

---

## Rollback Plan

If issues occur after deployment:

1. **Revert Environment Variables** (if needed)
2. **Redeploy Previous Function Versions**:
   ```bash
   supabase functions list --versions
   supabase functions deploy login-with-password --version <previous-version>
   ```
3. **Check Logs**:
   ```bash
   supabase functions logs login-with-password
   ```

---

## Contact

For questions or issues related to these security fixes, please:
- Review this document first
- Check Supabase function logs for detailed error messages
- Ensure all environment variables are properly set
