import { resolveLegacyAuthRoute, resolvePlatformAuthRoute, resolveSessionLandingRoute } from '@/lib/session-landing';

describe('resolveSessionLandingRoute', () => {
  it.each(['insurance', 'care', 'telecom', 'rental', 'car'])('preserves the %s service intent through signup, login and completion', service => {
    expect(resolvePlatformAuthRoute(service, 'signup')).toEqual({ pathname: '/services/signup', params: { service } });
    expect(resolvePlatformAuthRoute(service, 'login')).toEqual({ pathname: '/services/login', params: { service } });
    expect(resolvePlatformAuthRoute(service)).toEqual({ pathname: '/services/[service]', params: { service } });
  });

  it.each([undefined, 'hospital', 'help', 'https://example.invalid/', '__proto__', ['care']])('unknown service intents do not become redirect destinations (%j)', service => {
    expect(resolvePlatformAuthRoute(service)).toBe('/services/account');
    expect(resolvePlatformAuthRoute(service, 'login')).toBe('/services/login');
  });
  it('routes admins to the admin home by default', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'admin',
        residentId: '01000000000',
        isRequestBoardDesigner: false,
      }),
    ).toBe('/');
  });

  it('routes request-board designers to request-board first', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '01000000000',
        isRequestBoardDesigner: true,
      }),
    ).toBe('/request-board');
  });

  it('routes FC users with a resident id to the service home first', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '01000000000',
        isRequestBoardDesigner: false,
      }),
    ).toBe('/');
  });

  it('waits when an FC session is still missing its resident id', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '',
        isRequestBoardDesigner: false,
      }),
    ).toBeNull();
    expect(resolveSessionLandingRoute({
      role: 'fc', residentId: '', isRequestBoardDesigner: false, requestedService: 'insurance',
    })).toBeNull();
  });
  it('keeps common-only insurance onboarding distinct from guest entry and existing FC routes', () => {
    const session = { role: null, residentId: '', isRequestBoardDesigner: false } as const;
    expect(resolveSessionLandingRoute(session)).toBeNull();
    expect(resolveSessionLandingRoute({ ...session, isPlatformSignedIn: true })).toBe('/services/account');
    expect(resolveSessionLandingRoute({ ...session, isPlatformSignedIn: true, requestedService: 'insurance' })).toEqual({
      pathname: '/apply-gate', params: { next: '/?mode=insurance' },
    });
  });
  it.each(['login', 'signup'] as const)('legacy %s preserves insurance intent and skips stale automatic login', destination => {
    expect(resolveLegacyAuthRoute({ skipAuto: '1', referralNonce: '2' }, destination)).toEqual({
      pathname: `/services/${destination}`, params: { service: 'insurance', skipAuto: '1', referralNonce: '2' },
    });
    expect(resolveLegacyAuthRoute({ service: 'care', skipAuto: '1' }, destination)).toEqual({
      pathname: `/services/${destination}`, params: { service: 'care', skipAuto: '1' },
    });
    expect(resolveLegacyAuthRoute({ service: ['insurance'], skipAuto: ['1'] }, destination)).toEqual({
      pathname: `/services/${destination}`, params: {},
    });
  });
});
