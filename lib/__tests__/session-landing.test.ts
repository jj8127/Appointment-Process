import { resolveSessionLandingRoute } from '@/lib/session-landing';

describe('resolveSessionLandingRoute', () => {
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
});
